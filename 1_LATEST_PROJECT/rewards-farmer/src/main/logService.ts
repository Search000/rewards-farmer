import { writeFile } from 'node:fs/promises'
import { filterLines, formatLine, normalizeLevel, parseFilter } from '../shared/logs-rules'
import type { ActionResult } from '../shared/farmer-types'
import type { LogConnection, LogLine, LogsState } from '../shared/logs-types'
import { AppError } from './engine/apiClient'
import type { EngineApi, LogEntry } from './engine/apiClient'
import { SseParser } from './engine/sse'
import type { JsonlLog, LogLevel as FileLevel } from './jsonlLog'
import { localIso } from './jsonlLog'

// Phase 11: reads the REAL engine logs (GET /events live stream; GET /logs as fallback and for "Refresh"), redacts every
// line in this process, keeps a bounded in-memory buffer, mirrors lines to engine.log / errors.log, and serves the UI.
// It never invents a line. If the engine is not reachable it says so (connection) instead of guessing.

export interface LogServiceDeps {
    // The live engine API client, or null while the engine is not ready.
    readonly api: () => EngineApi | null
    readonly redact: (text: string) => string
    readonly engineLog: JsonlLog
    readonly errorsLog: JsonlLog
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    // Opens the OS save dialog. Returns null when the user cancels.
    readonly pickSavePath: (defaultName: string) => Promise<string | null>
    readonly writeFileImpl?: (path: string, data: string) => Promise<void>
    readonly maxLines?: number
    readonly viewMax?: number
    // How many recent engine lines to ask for on a fresh connection (the engine clamps it to its own buffer size). Default = maxLines.
    readonly replay?: number
    // How long to wait between reads while only polling, and the reconnect backoff bounds.
    readonly pollMs?: number
    readonly backoffMinMs?: number
    readonly backoffMaxMs?: number
    // No bytes at all (not even the 15 s keep-alive) for this long = the stream is dead; reconnect.
    readonly silenceMs?: number
    readonly now?: () => Date
}

const FILE_LEVEL: Record<string, FileLevel> = { debug: 'debug', info: 'info', warn: 'warn', error: 'error' }

export class LogService {
    private lines: LogLine[] = []
    private seq = 0
    private session = 0
    private lastId: number | null = null
    private dropped = 0
    private missed = 0
    private connection: LogConnection = 'idle'
    private currentApi: EngineApi | null = null
    private running = false
    private stopped = false
    private abort: AbortController | null = null
    private wake: (() => void) | null = null
    private loopDone: Promise<void> = Promise.resolve()
    private readonly maxLines: number
    private readonly viewMax: number

    constructor(private readonly deps: LogServiceDeps) {
        this.maxLines = deps.maxLines ?? 5000
        this.viewMax = deps.viewMax ?? 2000
    }

    start(): void {
        if (this.running) return
        this.running = true
        this.stopped = false
        this.loopDone = this.loop()
    }

    async stop(): Promise<void> {
        this.stopped = true
        this.abort?.abort()
        this.wake?.()
        await this.loopDone
        this.running = false
        await Promise.all([this.deps.engineLog.flush(), this.deps.errorsLog.flush()])
    }

    // ---- state for the UI ---------------------------------------------------------------------------------------

    getState(): LogsState {
        const fileError = this.deps.engineLog.lastError ?? this.deps.errorsLog.lastError
        const reason = this.unavailableReason()
        return {
            status: this.lines.length > 0 || reason === null ? 'ok' : 'unavailable',
            reason: this.lines.length > 0 ? null : reason,
            connection: this.connection,
            lines: this.lines.slice(-this.viewMax),
            bufferedTotal: this.lines.length,
            dropped: this.dropped,
            missed: this.missed,
            fileError,
            updatedAt: localIso((this.deps.now ?? (() => new Date()))())
        }
    }

    private unavailableReason(): string | null {
        if (this.connection === 'idle') return 'The engine is not running, so there are no logs to show.'
        if (this.connection === 'disconnected') return 'The engine log stream cannot be reached right now.'
        return null
    }

    // ---- actions --------------------------------------------------------------------------------------------------

    async refresh(): Promise<ActionResult> {
        const api = this.deps.api()
        if (api === null)
            return {
                ok: false,
                code: 'ENGINE_DOWN',
                message: 'The engine is not running, so there is nothing to refresh.'
            }
        this.adopt(api)
        try {
            const count = await this.pollOnce(api)
            return {
                ok: true,
                message:
                    count === 0
                        ? 'Logs are up to date.'
                        : `Read ${String(count)} new log line(s) from the engine.`
            }
        } catch (error) {
            const e = error instanceof AppError ? error : null
            return {
                ok: false,
                code: e?.code ?? 'ENGINE_DOWN',
                message: e?.message ?? 'Could not read the engine logs.'
            }
        }
    }

    async exportLogs(filterInput: unknown): Promise<ActionResult> {
        const filter = parseFilter(filterInput)
        if (filter === null) return { ok: false, code: 'BAD_REQUEST', message: 'Invalid log filter.' }
        const picked = filterLines(this.lines, filter)
        if (picked.length === 0)
            return { ok: false, message: 'No log lines match the filter, so nothing was exported.' }
        const date = (this.deps.now ?? (() => new Date()))()
        const stamp = localIso(date).slice(0, 19).replace(/[:T]/g, '-')
        const path = await this.deps.pickSavePath(`rewards-farmer-logs-${stamp}.txt`)
        if (path === null) return { ok: false, message: 'Export cancelled.' }
        // Redaction is applied again on the way out (architecture section 13: "redaction re-applied").
        const header = `# Microsoft Rewards Farmer log export - ${String(picked.length)} line(s) - ${localIso(date)} - secrets redacted`
        const body = this.deps.redact([header, ...picked.map(formatLine)].join('\n')) + '\n'
        try {
            await (this.deps.writeFileImpl ?? ((p, d) => writeFile(p, d, 'utf8')))(path, body)
        } catch (error) {
            const why = error instanceof Error ? error.message : String(error)
            this.deps.audit.write({
                level: 'warn',
                component: 'LogService',
                action: 'export-logs',
                result: 'failed',
                message: 'Log export failed.'
            })
            return {
                ok: false,
                code: 'WRITE_FAILED',
                message: `Could not write the export file (${this.deps.redact(why)}).`
            }
        }
        this.deps.audit.write({
            level: 'info',
            component: 'LogService',
            action: 'export-logs',
            result: 'ok',
            message: `Exported ${String(picked.length)} log line(s).`
        })
        return { ok: true, message: `Exported ${String(picked.length)} log line(s).` }
    }

    // ---- reading from the engine --------------------------------------------------------------------------------

    private async loop(): Promise<void> {
        const min = this.deps.backoffMinMs ?? 500
        const max = this.deps.backoffMaxMs ?? 10000
        let backoff = min
        while (!this.stopped) {
            const api = this.deps.api()
            if (api === null) {
                this.setConnection('idle')
                await this.sleep(300)
                continue
            }
            this.adopt(api)
            try {
                await this.consumeStream(api)
                backoff = min
            } catch (error) {
                if (this.stopped) break
                if (!(error instanceof AppError) || error.code !== 'ENGINE_DOWN')
                    this.deps.appLog.write({
                        level: 'warn',
                        component: 'LogService',
                        message: `Live log stream ended: ${this.deps.redact(error instanceof Error ? error.message : String(error))}`
                    })
            }
            if (this.stopped) break
            // Stream is not open. Try the plain GET /logs so the screen keeps filling, then reconnect.
            try {
                await this.pollOnce(api)
                this.setConnection('polling')
                await this.sleep(this.deps.pollMs ?? 2000)
            } catch {
                this.setConnection(this.deps.api() === null ? 'idle' : 'disconnected')
                await this.sleep(backoff)
                backoff = Math.min(backoff * 2, max)
            }
        }
    }

    // A new EngineApi object = the engine was (re)launched: its ids start again, old lines stay visible.
    private adopt(api: EngineApi): void {
        if (this.currentApi === api) return
        this.currentApi = api
        this.session += 1
        this.lastId = null
    }

    private async consumeStream(api: EngineApi): Promise<void> {
        const controller = new AbortController()
        this.abort = controller
        const silenceMs = this.deps.silenceMs ?? 45000
        let timer: NodeJS.Timeout | null = null
        const arm = (): void => {
            if (timer !== null) clearTimeout(timer)
            timer = setTimeout(() => controller.abort(), silenceMs)
        }
        try {
            arm()
            const res = await api.openEvents({
                signal: controller.signal,
                ...(this.lastId === null
                    ? { replay: this.deps.replay ?? this.maxLines }
                    : { lastEventId: this.lastId })
            })
            if (res.body === null) throw new AppError('ENGINE_ERROR', 'The engine log stream has no body.')
            this.setConnection('live')
            const parser = new SseParser()
            const decoder = new TextDecoder()
            const reader = res.body.getReader()
            for (;;) {
                const { done, value } = await reader.read()
                if (done) return
                arm()
                for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
                    if (ev.event !== 'log') continue
                    let entry: unknown
                    try {
                        entry = JSON.parse(ev.data) as unknown
                    } catch {
                        continue // a broken frame is skipped, never guessed
                    }
                    this.ingest(entry)
                }
            }
        } catch (error) {
            if (error instanceof AppError) throw error
            throw new AppError('ENGINE_DOWN', 'The engine log stream was interrupted.', undefined, true)
        } finally {
            if (timer !== null) clearTimeout(timer)
            controller.abort()
            if (this.abort === controller) this.abort = null
        }
    }

    // Returns how many new lines were added.
    private async pollOnce(api: EngineApi): Promise<number> {
        const res = this.lastId === null ? await api.logs(500) : await api.logsAfter(this.lastId, 500)
        let added = 0
        for (const entry of res.logs ?? []) if (this.ingest(entry)) added += 1
        return added
    }

    // Adds one engine entry. Returns false for a duplicate or an unusable entry.
    private ingest(raw: unknown): boolean {
        if (typeof raw !== 'object' || raw === null) return false
        const e = raw as LogEntry
        const id = typeof e.id === 'number' && Number.isFinite(e.id) ? e.id : null
        if (id !== null && this.lastId !== null) {
            if (id <= this.lastId) return false // already have it (reconnect replay)
            if (id > this.lastId + 1) this.missed += id - this.lastId - 1
        }
        if (id !== null) this.lastId = id
        const red = this.deps.redact
        const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? red(v) : null)
        const line: LogLine = {
            seq: ++this.seq,
            session: this.session,
            id,
            at: typeof e.receivedAt === 'string' ? e.receivedAt : null,
            level: normalizeLevel(e.level),
            title: text(e.title),
            message: red(typeof e.message === 'string' ? e.message : ''),
            user: text(e.user)
        }
        this.lines.push(line)
        if (this.lines.length > this.maxLines) {
            const extra = this.lines.length - this.maxLines
            this.lines.splice(0, extra)
            this.dropped += extra
        }
        this.mirrorToFiles(line)
        return true
    }

    private mirrorToFiles(line: LogLine): void {
        const level = FILE_LEVEL[line.level] ?? 'info'
        const record = {
            level,
            component: 'engine',
            message: line.message,
            ...(line.title === null ? {} : { action: line.title }),
            ...(line.user === null ? {} : { account: line.user })
        }
        this.deps.engineLog.write(record)
        if (level === 'warn' || level === 'error') this.deps.errorsLog.write(record)
    }

    private setConnection(next: LogConnection): void {
        if (this.connection === next) return
        this.connection = next
        this.deps.appLog.write({
            level: 'info',
            component: 'LogService',
            message: `engine log connection: ${next}`
        })
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => {
            const t = setTimeout(() => {
                this.wake = null
                resolve()
            }, ms)
            this.wake = () => {
                clearTimeout(t)
                this.wake = null
                resolve()
            }
        })
    }
}
