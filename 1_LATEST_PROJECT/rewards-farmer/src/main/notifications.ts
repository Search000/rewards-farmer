import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ActionResult, ErrorCode } from '../shared/farmer-types'
import {
    CHANNELS,
    MIN_TEST_INTERVAL_MS,
    REQUEST_TIMEOUT_MS,
    UNSUPPORTED,
    buildRequest,
    channelDef,
    channelState,
    classifyBody,
    classifyHttp,
    classifyNetworkError,
    evaluateChannel,
    isChannelId,
    readEnabled,
    readLogFilter
} from '../shared/notifications-rules'
import type { ChannelDef, Classified } from '../shared/notifications-rules'
import type {
    NotificationsState,
    NotifyChannelId,
    NotifyOutcome,
    NotifyTestResult
} from '../shared/notifications-types'
import { AppError } from './engine/apiClient'
import type { EngineApi } from './engine/apiClient'
import type { Redactor } from './engine/redact'
import type { JsonlLog } from './jsonlLog'
import { restrictToCurrentUser } from './privatePerms'
import type { PermsResult } from './privatePerms'

// Notification service (Phase 16).
//
// What it is: the part of the app that knows which notification channels are really usable and can send ONE explicit
// test message. What it is NOT: a second sender. During a run the ENGINE posts the real notifications itself (log
// lines for Discord / ntfy / Telegram, a run summary for PushPlus). This app does not copy or forward them, so nothing
// is sent twice and no run data leaves through this service.
//
// Rules this file keeps:
//   - Nothing is sent unless the user asked for it (a test) AND the channel has complete, valid saved values.
//     Unconfigured channel = NO network request, proven in tests by a fetch that fails the test if it is called.
//   - Credentials stay where Phase 10 put them (engine config.json). They are read inside main only, registered in
//     the Redactor BEFORE any request, and never returned, logged or put in an error text.
//   - A webhook cannot redirect the request elsewhere (redirect: 'error').
//   - Only fixed text is sent. No account, point count, path or log line is inside a test message.

export interface NotificationsHost {
    api(): EngineApi | null
    // null = switching a channel on / off is allowed. A string = why not (for example a run is active).
    editBlock(): string | null
    run(work: () => Promise<ActionResult>): Promise<ActionResult>
}

export interface NotificationsDeps {
    readonly host: NotificationsHost
    readonly engineRoot: string
    readonly redactor: Redactor
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    // Backup copies of config.json. They hold secrets, so they stay in the private user-data folder.
    readonly backupDir: string
    // Tests replace these. In the app they are the real fetch and the real clock.
    readonly fetchImpl?: typeof fetch
    readonly now?: () => Date
    readonly restrict?: (path: string, isDir: boolean) => Promise<PermsResult>
}

type ConfigRead =
    | { readonly kind: 'ok'; readonly config: unknown }
    | { readonly kind: 'missing' }
    | { readonly kind: 'permission' }
    | { readonly kind: 'invalid' }
    | { readonly kind: 'error' }

const fail = (code: ErrorCode, message: string): ActionResult => ({ ok: false, code, message })

function stamp(d: Date): string {
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    return `${String(d.getFullYear())}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}

const PERMISSION_TEXT =
    'Windows did not let the app read config.json (permission denied). Right-click the engine folder, choose Properties, then Security, and give your user name Read and Write. Then try again.'

export class NotificationsService {
    private queue: Promise<unknown> = Promise.resolve()
    private readonly lastTest = new Map<NotifyChannelId, number>()
    private readonly inFlight = new Set<NotifyChannelId>()

    constructor(private readonly deps: NotificationsDeps) {}

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date()
    }

    private configPath(): string {
        return join(this.deps.engineRoot, 'config.json')
    }

    private restrict(path: string, isDir: boolean): Promise<PermsResult> {
        return (this.deps.restrict ?? restrictToCurrentUser)(path, isDir)
    }

    // Reads the real config.json. The parser message is dropped on purpose: it can quote a saved value.
    private async readConfig(): Promise<ConfigRead> {
        let text: string
        try {
            text = await readFile(this.configPath(), 'utf8')
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code
            if (code === 'ENOENT') return { kind: 'missing' }
            if (code === 'EACCES' || code === 'EPERM') return { kind: 'permission' }
            return { kind: 'error' }
        }
        let config: unknown
        try {
            config = JSON.parse(text)
        } catch {
            return { kind: 'invalid' }
        }
        // Teach the Redactor every saved value, so a later log line or error text cannot show it.
        for (const def of CHANNELS) {
            const values = evaluateChannel(config, def.id).values
            for (const v of Object.values(values)) this.deps.redactor.add(v)
        }
        return { kind: 'ok', config }
    }

    // ---- read ----------------------------------------------------------------------------------------------------

    async getState(): Promise<NotificationsState> {
        const updatedAt = this.now().toISOString()
        const base = { channels: [], unsupported: UNSUPPORTED, updatedAt, logFilter: 'unknown' } as const
        const read = await this.readConfig()
        switch (read.kind) {
            case 'missing':
                return {
                    ...base,
                    status: 'unavailable',
                    problem: 'missing',
                    reason: 'config.json is missing. Use "Create config" on Home first.'
                }
            case 'permission':
                return { ...base, status: 'error', problem: 'permission', reason: PERMISSION_TEXT }
            case 'invalid':
                return {
                    ...base,
                    status: 'error',
                    problem: 'invalid',
                    reason: 'config.json is not valid. Use "Repair config.json" on the Health page.'
                }
            case 'error':
                return {
                    ...base,
                    status: 'error',
                    problem: 'unreadable',
                    reason: 'config.json could not be read.'
                }
            case 'ok':
                return {
                    status: 'ok',
                    problem: null,
                    logFilter: readLogFilter(read.config),
                    reason: null,
                    channels: CHANNELS.map((c) => channelState(read.config, c.id)),
                    unsupported: UNSUPPORTED,
                    updatedAt
                }
        }
    }

    // ---- test message --------------------------------------------------------------------------------------------

    async sendTest(id: unknown): Promise<NotifyTestResult> {
        if (!isChannelId(id)) {
            return this.result(null, 'failed', false, fail('BAD_REQUEST', 'Unknown notification channel.'))
        }
        const def = channelDef(id)
        const label = def.label

        // Guard 1: one test at a time per channel, and not more often than every few seconds.
        const nowMs = this.now().getTime()
        const last = this.lastTest.get(id)
        if (this.inFlight.has(id) || (last !== undefined && nowMs - last < MIN_TEST_INTERVAL_MS)) {
            return this.finish(
                id,
                'too-soon',
                false,
                `A test for ${label} was just sent. Wait a few seconds and try again.`
            )
        }

        // Claim the channel at once (before any await), so two tests started together cannot both pass Guard 1.
        this.inFlight.add(id)
        try {
            return await this.runTest(id, def, nowMs)
        } finally {
            this.inFlight.delete(id)
        }
    }

    private async runTest(id: NotifyChannelId, def: ChannelDef, nowMs: number): Promise<NotifyTestResult> {
        const label = def.label

        // Guard 2: the saved values must exist and be valid. If not: NO request.
        const read = await this.readConfig()
        if (read.kind === 'permission') return this.finish(id, 'permission-denied', false, PERMISSION_TEXT)
        if (read.kind === 'missing')
            return this.finish(
                id,
                'not-configured',
                false,
                'config.json is missing. Use "Create config" on Home first.'
            )
        if (read.kind !== 'ok')
            return this.finish(
                id,
                'misconfigured',
                false,
                'config.json is not valid or could not be read. Use "Repair config.json" on the Health page.'
            )
        const evaluation = evaluateChannel(read.config, id)
        if (!evaluation.complete) {
            return evaluation.anySaved
                ? this.finish(
                      id,
                      'misconfigured',
                      false,
                      evaluation.problems[0] ?? `${label} is not set up correctly.`
                  )
                : this.finish(
                      id,
                      'not-configured',
                      false,
                      `${label} is not set up. Save its address or token on the Secrets page first. No message was sent.`
                  )
        }

        // From here on a request is made. The values are already known to the Redactor (readConfig).
        const request = buildRequest(read.config, id, evaluation.values)
        const doFetch = this.deps.fetchImpl ?? fetch
        this.lastTest.set(id, nowMs)
        let response: Response
        try {
            response = await doFetch(request.url, {
                method: 'POST',
                headers: { ...request.headers },
                body: request.body,
                redirect: 'error',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            })
        } catch (e) {
            const c = classifyNetworkError(e, label)
            return this.finish(id, c.outcome, true, c.message)
        }
        const http = classifyHttp(response.status, label)
        if (http !== null) {
            await response.body?.cancel().catch(() => undefined)
            return this.finish(id, http.outcome, true, http.message)
        }
        let bodyProblem: Classified | null = null
        if (request.checkBody === 'none') {
            await response.body?.cancel().catch(() => undefined)
        } else {
            let text: string
            try {
                text = (await response.text()).slice(0, 20_000)
            } catch (e) {
                const c = classifyNetworkError(e, label)
                return this.finish(id, c.outcome, true, c.message)
            }
            bodyProblem = classifyBody(request.checkBody, text, label)
        }
        if (bodyProblem !== null) return this.finish(id, bodyProblem.outcome, true, bodyProblem.message)
        const off = readEnabled(read.config, def)
            ? ''
            : ' The channel is switched off, so the engine will not use it until you switch it on.'
        return this.finish(
            id,
            'sent',
            true,
            `Test message sent to ${label}. Look in the channel: it should arrive within a minute.${off}`
        )
    }

    private finish(
        id: NotifyChannelId,
        outcome: NotifyOutcome,
        requestMade: boolean,
        message: string
    ): NotifyTestResult {
        const ok = outcome === 'sent'
        const code: ErrorCode | undefined = ok
            ? undefined
            : outcome === 'not-configured' || outcome === 'misconfigured'
              ? 'CONFIG_INVALID'
              : outcome === 'permission-denied'
                ? 'WRITE_FAILED'
                : 'ENGINE_ERROR'
        const safe = this.deps.redactor.redact(message)
        this.audit(
            'test',
            ok ? 'info' : 'warn',
            outcome,
            `${channelDef(id).label}: test ${outcome} (request made: ${requestMade ? 'yes' : 'no'}).`
        )
        return {
            ok,
            ...(code !== undefined ? { code } : {}),
            message: safe,
            channel: id,
            outcome,
            requestMade
        }
    }

    private result(
        channel: NotifyChannelId | null,
        outcome: NotifyOutcome,
        requestMade: boolean,
        base: ActionResult
    ): NotifyTestResult {
        return { ...base, channel, outcome, requestMade }
    }

    // ---- switch on / off -----------------------------------------------------------------------------------------

    setEnabled(id: unknown, enabled: unknown): Promise<ActionResult> {
        if (!isChannelId(id)) return Promise.resolve(fail('BAD_REQUEST', 'Unknown notification channel.'))
        if (typeof enabled !== 'boolean')
            return Promise.resolve(fail('BAD_REQUEST', 'The switch must be on or off.'))
        const next = this.queue.then(
            () => this.applyEnabled(id, enabled),
            () => this.applyEnabled(id, enabled)
        )
        this.queue = next.catch(() => undefined)
        return next
    }

    private async applyEnabled(id: NotifyChannelId, enabled: boolean): Promise<ActionResult> {
        const def = channelDef(id)
        const label = def.label
        const block = this.deps.host.editBlock()
        if (block !== null) return fail('RUN_ACTIVE', block)

        const read = await this.readConfig()
        if (read.kind === 'permission') return fail('WRITE_FAILED', PERMISSION_TEXT)
        if (read.kind !== 'ok')
            return fail(
                'CONFIG_INVALID',
                'config.json is missing or not valid. Use Home or the Health page first.'
            )
        const evaluation = evaluateChannel(read.config, id)
        if (enabled && !evaluation.complete) {
            return fail(
                'BAD_REQUEST',
                `${label} cannot be switched on yet. ${evaluation.problems[0] ?? 'It is not set up.'}`
            )
        }
        if (readEnabled(read.config, def) === enabled) {
            return {
                ok: true,
                message: `${label} is already ${enabled ? 'on' : 'off'}. Nothing was changed.`
            }
        }

        return this.deps.host.run(async () => {
            const api = this.deps.host.api()
            if (api === null)
                return fail(
                    'ENGINE_DOWN',
                    'The engine is not ready. Choose your accounts file on Home first.'
                )

            // 1. Backup copy of the real config file (rule 10). If it fails, nothing changes.
            const backupPath = join(this.deps.backupDir, `config-${stamp(this.now())}.json`)
            try {
                await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 })
                await this.restrict(this.deps.backupDir, true)
                await copyFile(this.configPath(), backupPath)
                await this.restrict(backupPath, false)
            } catch (e) {
                const code = (e as NodeJS.ErrnoException).code ?? 'unknown error'
                this.audit(
                    'set-enabled',
                    'error',
                    'backup-failed',
                    `${label}: backup failed (${code}); config.json unchanged.`
                )
                return fail('WRITE_FAILED', `Could not make a backup copy (${code}). Nothing was changed.`)
            }

            // 2. The engine validates and writes (atomic on its side). Only the one flag is sent.
            try {
                await api.patchConfig({ webhook: { [id]: { enabled } } })
            } catch (e) {
                if (e instanceof AppError) {
                    const text = this.deps.redactor.redact(e.message)
                    this.audit(
                        'set-enabled',
                        'error',
                        e.code,
                        `${label}: the engine refused or failed: ${text}`
                    )
                    const hint =
                        e.code === 'WRITE_DISABLED' ? ' Config writes are switched off in the engine.' : ''
                    return fail(e.code, `${text}${hint}`)
                }
                this.audit('set-enabled', 'error', 'unknown', `${label}: unexpected failure.`)
                return fail('ENGINE_ERROR', 'The setting could not be changed.')
            }

            // 3. Limit the new file to the current user, then read it back (rule 4).
            const perms = await this.restrict(this.configPath(), false)
            if (!perms.ok) this.audit('set-enabled', 'warn', 'permissions', `config.json: ${perms.detail}`)
            const after = await this.readConfig()
            if (after.kind !== 'ok' || readEnabled(after.config, def) !== enabled) {
                this.audit(
                    'set-enabled',
                    'error',
                    'readback-mismatch',
                    `${label}: the saved flag differs from the request.`
                )
                return fail(
                    'WRITE_FAILED',
                    'The engine accepted the change, but reading it back shows something else. A backup copy exists.'
                )
            }
            this.audit('set-enabled', 'info', 'ok', `${label}: switched ${enabled ? 'on' : 'off'}.`)
            return {
                ok: true,
                message: `${label} is now ${enabled ? 'on' : 'off'}. It applies from the next run.${perms.ok ? '' : ' Note: the file permissions could not be tightened. See the audit log.'}`
            }
        })
    }

    private audit(action: string, level: 'info' | 'warn' | 'error', result: string, message: string): void {
        this.deps.audit.write({
            level,
            component: 'Notifications',
            action,
            result,
            message: this.deps.redactor.redact(message)
        })
    }
}
