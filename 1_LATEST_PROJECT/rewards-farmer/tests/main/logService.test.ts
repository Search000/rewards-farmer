// @vitest-environment node
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EngineApi } from '../../src/main/engine/apiClient'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { LogService } from '../../src/main/logService'
import type { LogServiceDeps } from '../../src/main/logService'
import { waitFor } from './helpers'

// The engine here is a small HTTP stand-in that speaks the documented /events and /logs shapes. It exists only in this
// test file (rule 18). Behavior against the REAL engine API is covered in logs.integration.test.ts.

interface Entry {
    id: number
    receivedAt: string
    level: string
    title: string
    message: string
    user?: string
}
const entry = (id: number, over: Partial<Entry> = {}): Entry => ({
    id,
    receivedAt: `2026-10-12T10:00:${String(id % 60).padStart(2, '0')}.000Z`,
    level: 'info',
    title: 'FLOW',
    message: `line ${String(id)}`,
    user: 'alpha',
    ...over
})

class FakeEngine {
    readonly token = 'tok-test-1234567890'
    logs: Entry[] = []
    mode: 'stream' | 'fail' | 'silent' = 'stream'
    eventConnections = 0
    lastEventIds: (string | undefined)[] = []
    private streams = new Set<ServerResponse>()
    private server: Server
    baseUrl = ''

    constructor() {
        this.server = createServer((req, res) => this.handle(req, res))
    }

    async listen(): Promise<void> {
        await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
        this.baseUrl = `http://127.0.0.1:${String((this.server.address() as AddressInfo).port)}`
    }

    api(): EngineApi {
        return new EngineApi({ baseUrl: this.baseUrl, token: this.token, timeoutMs: 2000 })
    }

    push(e: Entry): void {
        this.logs.push(e)
        for (const s of this.streams)
            s.write(`id: ${String(e.id)}\nevent: log\ndata: ${JSON.stringify(e)}\n\n`)
    }

    pushRaw(text: string): void {
        for (const s of this.streams) s.write(text)
    }

    dropStreams(): void {
        for (const s of this.streams) s.destroy()
        this.streams.clear()
    }

    async close(): Promise<void> {
        this.dropStreams()
        await new Promise<void>((r) => this.server.close(() => r()))
    }

    private handle(req: IncomingMessage, res: ServerResponse): void {
        if (req.headers.authorization !== `Bearer ${this.token}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"nope"}')
            return
        }
        const url = new URL(req.url ?? '/', 'http://x')
        if (url.pathname === '/logs') {
            const after = Number(url.searchParams.get('afterId') ?? '-1')
            const limit = Number(url.searchParams.get('limit') ?? '200')
            const picked = after >= 0 ? this.logs.filter((l) => l.id > after) : this.logs.slice(-limit)
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(
                JSON.stringify({ logs: picked, count: picked.length })
            )
            return
        }
        if (url.pathname === '/events') {
            this.eventConnections += 1
            this.lastEventIds.push(req.headers['last-event-id'] as string | undefined)
            if (this.mode === 'fail') {
                res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"busy"}')
                return
            }
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            res.write('event: hello\ndata: {"state":"idle"}\n\n')
            if (this.mode === 'silent') return
            const after =
                req.headers['last-event-id'] === undefined ? -1 : Number(req.headers['last-event-id'])
            const replay = Number(url.searchParams.get('replay') ?? '100')
            const replayed = after >= 0 ? this.logs.filter((l) => l.id > after) : this.logs.slice(-replay)
            for (const e of replayed)
                res.write(`id: ${String(e.id)}\nevent: log\ndata: ${JSON.stringify(e)}\n\n`)
            this.streams.add(res)
            res.on('close', () => this.streams.delete(res))
            return
        }
        res.writeHead(404).end()
    }
}

interface Ctx {
    dir: string
    redactor: Redactor
    engine: FakeEngine
    svc: LogService
    current: { api: EngineApi | null }
    engineLog: JsonlLog
    errorsLog: JsonlLog
    saved: { path: string | null }
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setup(over: Partial<LogServiceDeps> = {}, logDirOverride?: string): Promise<Ctx> {
    const dir = mkdtempSync(join(tmpdir(), 'rf-logsvc-'))
    const redactor = new Redactor()
    const redact = (t: string): string => redactor.redact(t)
    const logsDir = logDirOverride ?? join(dir, 'logs')
    const engineLog = new JsonlLog(logsDir, 'engine.log', 'engine', redact)
    const errorsLog = new JsonlLog(logsDir, 'errors.log', 'engine', redact)
    const audit = new JsonlLog(logsDir, 'audit.log', 'audit', redact)
    const appLog = new JsonlLog(logsDir, 'app.log', 'app', redact)
    const engine = new FakeEngine()
    await engine.listen()
    const current: { api: EngineApi | null } = { api: engine.api() }
    const saved: { path: string | null } = { path: join(dir, 'export.txt') }
    const svc = new LogService({
        api: () => current.api,
        redact,
        engineLog,
        errorsLog,
        audit,
        appLog,
        pickSavePath: () => Promise.resolve(saved.path),
        pollMs: 60,
        backoffMinMs: 30,
        backoffMaxMs: 120,
        ...over
    })
    cleanups.push(async () => {
        await svc.stop()
        await engine.close()
        rmSync(dir, { recursive: true, force: true })
    })
    return { dir, redactor, engine, svc, current, engineLog, errorsLog, saved }
}

const lines = (c: Ctx) => c.svc.getState().lines
const conn = (c: Ctx) => c.svc.getState().connection

describe('LogService: live stream', () => {
    it('shows real engine lines with their fields, marks an unreported level as unknown, and writes engine.log / errors.log', async () => {
        const c = await setup()
        c.engine.logs = [entry(1), entry(2, { level: 'warn', message: 'careful' })]
        c.svc.start()
        await waitFor(
            () => lines(c).length,
            (n) => n === 2,
            'two replayed lines'
        )
        expect(conn(c)).toBe('live')
        c.engine.push(entry(3, { level: 'weird', title: 'X', message: 'odd level' }))
        c.engine.push(entry(4, { level: 'error', message: 'broke' }))
        await waitFor(
            () => lines(c).length,
            (n) => n === 4,
            'live lines'
        )
        const got = lines(c)
        expect(got.map((l) => l.id)).toEqual([1, 2, 3, 4])
        expect(got[0]).toMatchObject({
            level: 'info',
            title: 'FLOW',
            user: 'alpha',
            message: 'line 1',
            at: '2026-10-12T10:00:01.000Z'
        })
        expect(got[2]?.level).toBe('unknown') // never guessed as "info"
        expect(new Set(got.map((l) => l.seq)).size).toBe(4)

        await c.engineLog.flush()
        await c.errorsLog.flush()
        const engineFile = readFileSync(join(c.dir, 'logs', 'engine.log'), 'utf8')
            .trim()
            .split('\n')
        const errorsFile = readFileSync(join(c.dir, 'logs', 'errors.log'), 'utf8')
            .trim()
            .split('\n')
        expect(engineFile).toHaveLength(4)
        expect(errorsFile.map((l) => (JSON.parse(l) as { level: string }).level)).toEqual(['warn', 'error'])
        expect(JSON.parse(engineFile[0] ?? '{}')).toMatchObject({
            source: 'engine',
            component: 'engine',
            action: 'FLOW',
            account: 'alpha'
        })
    })

    it('redacts secrets in every shown line and in both files', async () => {
        const c = await setup()
        c.redactor.add('hunter2-fake-secret')
        c.engine.logs = [
            entry(1, { message: 'password hunter2-fake-secret leaked' }),
            entry(2, {
                title: 'Bearer abcdefgh1234567890',
                message: 'webhook https://discord.com/api/webhooks/123/ABCdef-fake'
            }),
            entry(3, { message: 'ACCOUNT_1_PASSWORD=hunter2-fake-secret' })
        ]
        c.svc.start()
        await waitFor(
            () => lines(c).length,
            (n) => n === 3,
            'lines'
        )
        const shown = JSON.stringify(lines(c))
        for (const secret of ['hunter2-fake-secret', 'abcdefgh1234567890', 'ABCdef-fake'])
            expect(shown).not.toContain(secret)
        expect(shown).toContain('***')
        await c.engineLog.flush()
        const file = readFileSync(join(c.dir, 'logs', 'engine.log'), 'utf8')
        for (const secret of ['hunter2-fake-secret', 'abcdefgh1234567890', 'ABCdef-fake'])
            expect(file).not.toContain(secret)
    })

    it('skips unusable frames instead of guessing', async () => {
        const c = await setup()
        c.svc.start()
        await waitFor(
            () => conn(c),
            (v) => v === 'live',
            'live'
        )
        c.engine.pushRaw('event: log\ndata: {not json\n\n')
        c.engine.pushRaw('event: log\ndata: 42\n\n')
        c.engine.pushRaw('event: log\ndata: null\n\n')
        c.engine.push(entry(1))
        await waitFor(
            () => lines(c).length,
            (n) => n === 1,
            'only the real line'
        )
        expect(lines(c)[0]?.id).toBe(1)
    })

    it('reconnects after the stream is cut, resumes with Last-Event-ID, adds no duplicates, and counts lines it never received', async () => {
        const c = await setup()
        c.engine.logs = [entry(1), entry(2)]
        c.svc.start()
        await waitFor(
            () => lines(c).length,
            (n) => n === 2,
            'first lines'
        )
        c.engine.mode = 'fail' // the new connection attempt fails, so a line can be missed between reads
        c.engine.dropStreams()
        await waitFor(
            () => conn(c),
            (v) => v !== 'live',
            'stream seen as cut'
        )
        c.engine.logs.push(entry(3), entry(4)) // arrived while cut
        c.engine.mode = 'stream'
        await waitFor(
            () => lines(c).length,
            (n) => n === 4,
            'caught up'
        )
        expect(lines(c).map((l) => l.id)).toEqual([1, 2, 3, 4])
        await waitFor(
            () => conn(c),
            (v) => v === 'live',
            'live again'
        )
        // The new connection resumed from the last id it had (not a fresh replay): 2 if it reconnected before the poll, 4 after.
        expect(c.engine.lastEventIds.at(-1)).toMatch(/^[24]$/)
        expect(c.svc.getState().missed).toBe(0)
        // The engine buffer moved on: ids 5-7 were lost before this app could read them.
        c.engine.push(entry(8))
        await waitFor(
            () => lines(c).length,
            (n) => n === 5,
            'line 8'
        )
        expect(c.svc.getState().missed).toBe(3)
    })

    it('falls back to polling GET /logs when the stream cannot be opened, and goes live again when it can', async () => {
        const c = await setup()
        c.engine.mode = 'fail'
        c.engine.logs = [entry(1)]
        c.svc.start()
        await waitFor(
            () => conn(c),
            (v) => v === 'polling',
            'polling mode'
        )
        expect(lines(c).map((l) => l.id)).toEqual([1])
        c.engine.logs.push(entry(2))
        await waitFor(
            () => lines(c).length,
            (n) => n === 2,
            'polled line'
        )
        c.engine.mode = 'stream'
        await waitFor(
            () => conn(c),
            (v) => v === 'live',
            'live again'
        )
        expect(lines(c).map((l) => l.id)).toEqual([1, 2])
    })

    it('treats a silent stream (no keep-alive) as dead and reconnects', async () => {
        const c = await setup({ silenceMs: 150 })
        c.engine.mode = 'silent'
        c.svc.start()
        await waitFor(
            () => c.engine.eventConnections,
            (n) => n >= 2,
            'a second connection'
        )
    })
})

describe('LogService: engine not running, restart, limits', () => {
    it('says so when the engine is not running, keeps old lines after it stops, and starts a new session after a restart', async () => {
        const c = await setup()
        c.svc.start()
        c.engine.logs = [entry(1), entry(2)]
        await waitFor(
            () => lines(c).length,
            (n) => n === 2,
            'lines'
        )
        c.current.api = null
        c.engine.dropStreams()
        await waitFor(
            () => conn(c),
            (v) => v === 'idle',
            'idle'
        )
        expect(lines(c)).toHaveLength(2) // history stays visible
        expect(c.svc.getState().status).toBe('ok')

        c.engine.logs = [entry(1, { message: 'new engine, ids start again' })]
        c.current.api = c.engine.api() // a new EngineApi object = a new engine launch
        await waitFor(
            () => lines(c).length,
            (n) => n === 3,
            'line from the restarted engine'
        )
        const got = lines(c)
        expect(got[2]).toMatchObject({ id: 1, message: 'new engine, ids start again' })
        expect(got[2]?.session).toBeGreaterThan(got[1]?.session ?? 99)
        expect(c.svc.getState().missed).toBe(0)
    })

    it('is "unavailable" with a reason (not an empty success) when the engine never ran', async () => {
        const c = await setup()
        c.current.api = null
        c.svc.start()
        await waitFor(
            () => conn(c),
            (v) => v === 'idle',
            'idle'
        )
        expect(c.svc.getState()).toMatchObject({ status: 'unavailable', lines: [] })
        expect(c.svc.getState().reason).toMatch(/not running/)
    })

    it('keeps a bounded buffer and reports how many lines were dropped', async () => {
        const c = await setup({ maxLines: 5, viewMax: 3, replay: 100 })
        c.engine.logs = Array.from({ length: 12 }, (_, i) => entry(i + 1))
        c.svc.start()
        await waitFor(
            () => c.svc.getState().dropped,
            (n) => n === 7,
            'dropped lines'
        )
        const s = c.svc.getState()
        expect(s.bufferedTotal).toBe(5)
        expect(s.lines.map((l) => l.id)).toEqual([10, 11, 12])
        await c.engineLog.flush()
        // Nothing is lost on disk: all 12 lines are in engine.log.
        expect(
            readFileSync(join(c.dir, 'logs', 'engine.log'), 'utf8')
                .trim()
                .split('\n')
        ).toHaveLength(12)
    })

    it('handles high volume', async () => {
        const c = await setup({ maxLines: 5000 })
        c.engine.logs = Array.from({ length: 3000 }, (_, i) => entry(i + 1, { message: `bulk ${String(i)}` }))
        c.svc.start()
        await waitFor(
            () => c.svc.getState().bufferedTotal,
            (n) => n >= 3000,
            'bulk lines',
            15000
        )
        expect(c.svc.getState().lines.length).toBeLessThanOrEqual(2000)
    })
})

describe('LogService: refresh', () => {
    it('refuses with a clear message when the engine is down', async () => {
        const c = await setup()
        c.current.api = null
        expect(await c.svc.refresh()).toMatchObject({ ok: false, code: 'ENGINE_DOWN' })
    })

    it('reads the engine buffer again and reports how many new lines it found', async () => {
        const c = await setup()
        c.engine.mode = 'silent' // stream gives nothing, so Refresh has to find the lines
        c.engine.logs = [entry(1), entry(2), entry(3)]
        const r = await c.svc.refresh()
        expect(r).toMatchObject({ ok: true })
        expect(r.message).toContain('3 new')
        expect((await c.svc.refresh()).message).toBe('Logs are up to date.')
    })
})

describe('LogService: disk problems', () => {
    it('shows lines and a file error when the log files cannot be written, and does not crash', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rf-logsvc-blocked-'))
        const blocker = join(dir, 'not-a-folder')
        writeFileSync(blocker, 'x') // a FILE where the log folder should be: mkdir / append fail (like permission denied)
        cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
        const c = await setup({}, join(blocker, 'logs'))
        c.engine.logs = [entry(1)]
        c.svc.start()
        await waitFor(
            () => lines(c).length,
            (n) => n === 1,
            'line'
        )
        await waitFor(
            () => c.svc.getState().fileError,
            (e) => e !== null,
            'file error'
        )
        expect(c.svc.getState().status).toBe('ok')
    })

    it('archives a full log file instead of deleting or overwriting it (rotation)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rf-rotate-'))
        cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
        let tick = 0
        const log = new JsonlLog(
            join(dir, 'logs'),
            'engine.log',
            'engine',
            (t) => t,
            () => new Date(Date.UTC(2026, 9, 12, 10, 0, tick++)),
            { maxBytes: 400 }
        )
        for (let i = 0; i < 20; i++)
            log.write({ level: 'info', component: 'engine', message: `line-${String(i)}` })
        await log.flush()
        const files = readdirSync(join(dir, 'logs')).filter((f) => f.startsWith('engine'))
        expect(files.length).toBeGreaterThan(2)
        expect(files).toContain('engine.log')
        const all = files.map((f) => readFileSync(join(dir, 'logs', f), 'utf8')).join('')
        for (let i = 0; i < 20; i++) expect(all).toContain(`line-${String(i)}"`)
        expect(log.lastError).toBeNull()
    })
})

describe('LogService: export', () => {
    const level = (l: 'all' | 'debug' | 'info' | 'warn' | 'error', text = '') => ({ level: l, text })

    it('writes only the lines that match the filter, with the secret hidden even if it was learned after the line arrived', async () => {
        const c = await setup()
        c.engine.logs = [
            entry(1),
            entry(2, { level: 'warn', message: 'late-secret-xyz appeared' }),
            entry(3, { level: 'error', message: 'bad' })
        ]
        c.svc.start()
        await waitFor(
            () => lines(c).length,
            (n) => n === 3,
            'lines'
        )
        c.redactor.add('late-secret-xyz') // registered AFTER the line was stored
        const r = await c.svc.exportLogs(level('warn'))
        expect(r).toMatchObject({ ok: true, message: 'Exported 2 log line(s).' })
        const text = readFileSync(c.saved.path ?? '', 'utf8')
        expect(text.split('\n')[0]).toMatch(/^# Microsoft Rewards Farmer log export - 2 line/)
        expect(text).toContain('[WARN]')
        expect(text).toContain('[ERROR]')
        expect(text).not.toContain('[INFO]')
        expect(text).not.toContain('late-secret-xyz')
    })

    it('applies the text filter, and refuses when nothing matches', async () => {
        const c = await setup()
        c.engine.logs = [entry(1, { message: 'alpha thing' }), entry(2, { message: 'beta thing' })]
        c.svc.start()
        await waitFor(
            () => lines(c).length,
            (n) => n === 2,
            'lines'
        )
        expect((await c.svc.exportLogs(level('all', 'BETA'))).message).toBe('Exported 1 log line(s).')
        expect(await c.svc.exportLogs(level('all', 'gamma'))).toMatchObject({ ok: false })
    })

    it('treats a cancelled dialog as not exported, rejects a bad filter, and reports a write failure', async () => {
        const c = await setup()
        c.engine.logs = [entry(1)]
        c.svc.start()
        await waitFor(
            () => lines(c).length,
            (n) => n === 1,
            'line'
        )
        c.saved.path = null
        expect(await c.svc.exportLogs(level('all'))).toMatchObject({
            ok: false,
            message: 'Export cancelled.'
        })
        for (const bad of [
            null,
            'x',
            {},
            { level: 'trace', text: '' },
            { level: 'all', text: 5 },
            { level: 'all', text: 'x'.repeat(500) }
        ])
            expect(await c.svc.exportLogs(bad)).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
        c.saved.path = join(c.dir, 'no-such-folder', 'x.txt')
        expect(await c.svc.exportLogs(level('all'))).toMatchObject({ ok: false, code: 'WRITE_FAILED' })
        mkdirSync(join(c.dir, 'no-such-folder'))
    })
})
