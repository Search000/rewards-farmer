// @vitest-environment node
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/main/engine/apiClient'
import type { EngineApi } from '../../src/main/engine/apiClient'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { NotificationsService } from '../../src/main/notifications'
import type { NotificationsHost } from '../../src/main/notifications'
import { CHANNELS, MIN_TEST_INTERVAL_MS } from '../../src/shared/notifications-rules'
import type { NotifyChannelId } from '../../src/shared/notifications-types'
import { FAKE } from '../fixtures/fake-secrets'

// Phase 16: the notification service at service level. Everything lives in a temp dir. Values are FAKE (rule 18).
// The network is a recording stand-in for fetch. A stand-in that fails the test when called proves "no request".

const REAL_ENGINE = join(__dirname, '..', '..', 'engine')
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const isWindows = process.platform === 'win32'

const dirs: string[] = []
afterEach(() => {
    while (dirs.length > 0) {
        const d = dirs.pop()
        if (d !== undefined) {
            try {
                chmodSync(join(d, 'engine', 'config.json'), 0o600)
            } catch {
                /* not there */
            }
            rmSync(d, { recursive: true, force: true })
        }
    }
})

const FULL: Record<NotifyChannelId, Record<string, unknown>> = {
    discord: { url: FAKE.discordUrl },
    ntfy: { url: FAKE.ntfyUrl, topic: 'my-topic', token: FAKE.ntfyToken },
    telegram: { botToken: FAKE.telegramBotToken, chatId: FAKE.telegramChatId },
    pushplus: { token: FAKE.pushplusToken }
}
const ids = CHANNELS.map((c) => c.id)

interface Call {
    readonly url: string
    readonly init: RequestInit
}

interface Rig {
    readonly dir: string
    readonly configPath: string
    readonly backupDir: string
    readonly service: NotificationsService
    readonly calls: Call[]
    readonly clock: { now: number }
    readonly state: { editBlock: string | null; api: EngineApi | null; answer: () => Promise<Response> }
    readonly auditText: () => string
    readonly patches: Record<string, unknown>[]
    configText(): string
    writeConfig(patch: Record<string, Record<string, unknown>>): void
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

function rig(options: { config?: boolean } = {}): Rig {
    const dir = mkdtempSync(join(tmpdir(), 'rf-notify-'))
    dirs.push(dir)
    const engineRoot = join(dir, 'engine')
    mkdirSync(engineRoot, { recursive: true })
    const configPath = join(engineRoot, 'config.json')
    if (options.config !== false) cpSync(join(REAL_ENGINE, 'config.example.json'), configPath)
    const backupDir = join(dir, 'userData', 'backups', 'config')
    const redactor = new Redactor()
    const redact = (t: string): string => redactor.redact(t)
    const logsDir = join(dir, 'userData', 'logs')
    const audit = new JsonlLog(logsDir, 'audit.log', 'audit', redact)
    const appLog = new JsonlLog(logsDir, 'app.log', 'app', redact)
    const calls: Call[] = []
    const patches: Record<string, unknown>[] = []
    const clock = { now: Date.UTC(2026, 9, 14, 12, 0, 0) }
    const state: Rig['state'] = {
        editBlock: null,
        api: null,
        answer: () => Promise.resolve(jsonResponse(200, ''))
    }
    // Stands in for the engine's PATCH /config: merges the body into config.json, like the real API does.
    const api = {
        patchConfig: (body: Record<string, unknown>): Promise<unknown> => {
            patches.push(body)
            const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
                string,
                Record<string, Record<string, unknown>>
            >
            const hooks = (body['webhook'] ?? {}) as Record<string, Record<string, unknown>>
            for (const [k, v] of Object.entries(hooks)) {
                cfg['webhook'] = cfg['webhook'] ?? {}
                cfg['webhook'][k] = { ...(cfg['webhook'][k] ?? {}), ...v }
            }
            writeFileSync(configPath, JSON.stringify(cfg, null, 2))
            return Promise.resolve({ ok: true })
        }
    } as unknown as EngineApi
    state.api = api
    const host: NotificationsHost = {
        api: () => state.api,
        editBlock: () => state.editBlock,
        run: (work) => work()
    }
    const service = new NotificationsService({
        host,
        engineRoot,
        redactor,
        audit,
        appLog,
        backupDir,
        fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} })
            return state.answer()
        }) as typeof fetch,
        now: () => new Date(clock.now),
        restrict: () => Promise.resolve({ ok: true, detail: 'test' })
    })
    return {
        dir,
        configPath,
        backupDir,
        service,
        calls,
        clock,
        state,
        patches,
        auditText: () => {
            const p = join(logsDir, 'audit.log')
            return existsSync(p) ? readFileSync(p, 'utf8') : ''
        },
        configText: () => readFileSync(configPath, 'utf8'),
        writeConfig: (patch) => {
            const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
                string,
                Record<string, Record<string, unknown>>
            >
            for (const [k, v] of Object.entries(patch)) {
                cfg['webhook'] = cfg['webhook'] ?? {}
                cfg['webhook'][k] = { ...(cfg['webhook'][k] ?? {}), ...v }
            }
            writeFileSync(configPath, JSON.stringify(cfg, null, 2))
        }
    }
}

const allValues = Object.values(FAKE)
function expectNoSecret(label: string, text: string): void {
    for (const v of allValues)
        expect(text.includes(v), `${label} contains a saved value (${v.slice(0, 6)}...)`).toBe(false)
}

async function flushLogs(): Promise<void> {
    await new Promise((r) => setTimeout(r, 60))
}

describe('notification service: nothing is sent unless it is configured and asked for (Phase 16)', () => {
    it('reading the state never makes a request', async () => {
        const r = rig()
        r.writeConfig({ discord: { ...FULL.discord, enabled: true } })
        const s = await r.service.getState()
        expect(s.status).toBe('ok')
        expect(r.calls).toHaveLength(0)
    })

    it('unconfigured channels: a test makes NO request and says exactly why', async () => {
        const r = rig()
        for (const id of ids) {
            const res = await r.service.sendTest(id)
            expect(res.ok, id).toBe(false)
            expect(res.outcome, id).toBe('not-configured')
            expect(res.requestMade, id).toBe(false)
            expect(res.message, id).toMatch(/not set up/)
            expect(res.message, id).toMatch(/No message was sent/)
        }
        expect(r.calls).toHaveLength(0)
    })

    it('a switched-on but empty channel is misconfigured and still makes no request', async () => {
        const r = rig()
        r.writeConfig({ discord: { enabled: true } })
        const res = await r.service.sendTest('discord')
        expect(res.outcome).toBe('not-configured')
        expect(res.requestMade).toBe(false)
        expect(r.calls).toHaveLength(0)
    })

    it('a saved but unusable value = misconfigured, no request, and the value is not echoed', async () => {
        const r = rig()
        r.writeConfig({ discord: { url: 'https://example.com/hook-SECRETBIT987' } })
        const res = await r.service.sendTest('discord')
        expect(res.outcome).toBe('misconfigured')
        expect(res.requestMade).toBe(false)
        expect(res.message).not.toContain('SECRETBIT987')
        expect(r.calls).toHaveLength(0)
    })

    it('ntfy without a topic is misconfigured and makes no request', async () => {
        const r = rig()
        r.writeConfig({ ntfy: { url: FAKE.ntfyUrl, topic: '' } })
        const res = await r.service.sendTest('ntfy')
        expect(res.outcome).toBe('misconfigured')
        expect(res.message).toMatch(/topic/)
        expect(r.calls).toHaveLength(0)
    })

    it('missing config.json: state is unavailable, a test says not-configured, no request', async () => {
        const r = rig({ config: false })
        const s = await r.service.getState()
        expect(s.status).toBe('unavailable')
        expect(s.problem).toBe('missing')
        expect(s.channels).toEqual([])
        const res = await r.service.sendTest('discord')
        expect(res.outcome).toBe('not-configured')
        expect(res.requestMade).toBe(false)
        expect(r.calls).toHaveLength(0)
    })

    it('invalid config.json: state is error, a test is misconfigured, no request, and the parser text is not shown', async () => {
        const r = rig()
        writeFileSync(
            r.configPath,
            '{ "webhook": { "discord": { "url": "https://discord.com/api/webhooks/1/LEAKME" ,, } }'
        )
        const s = await r.service.getState()
        expect(s.status).toBe('error')
        expect(s.problem).toBe('invalid')
        expect(s.reason).toMatch(/Repair config\.json/)
        expect(s.reason ?? '').not.toContain('LEAKME')
        const res = await r.service.sendTest('discord')
        expect(res.outcome).toBe('misconfigured')
        expect(res.requestMade).toBe(false)
        expect(res.message).not.toContain('LEAKME')
        expect(r.calls).toHaveLength(0)
    })

    it('an unknown or non-text channel is refused with no request and no throw', async () => {
        const r = rig()
        for (const bad of ['serverchan', 'clawbot', '', 5, null, undefined, {}, '../etc']) {
            const res = await r.service.sendTest(bad)
            expect(res.ok).toBe(false)
            expect(res.code).toBe('BAD_REQUEST')
            expect(res.channel).toBeNull()
            expect(res.requestMade).toBe(false)
        }
        expect(r.calls).toHaveLength(0)
    })

    it.skipIf(isRoot || isWindows)(
        'permission denied on config.json: clear outcome and no request',
        async () => {
            const r = rig()
            r.writeConfig({ discord: FULL.discord })
            chmodSync(r.configPath, 0o000)
            const s = await r.service.getState()
            expect(s.status).toBe('error')
            expect(s.problem).toBe('permission')
            expect(s.reason).toMatch(/permission denied/)
            const res = await r.service.sendTest('discord')
            expect(res.outcome).toBe('permission-denied')
            expect(res.requestMade).toBe(false)
            expect(res.message).toMatch(/Security/)
            expect(r.calls).toHaveLength(0)
        }
    )
})

describe('notification service: test message (Phase 16)', () => {
    it('sends exactly one fixed message per channel to the right place, safely', async () => {
        for (const id of ids) {
            const r = rig()
            r.writeConfig({ [id]: { ...FULL[id], enabled: true } })
            r.state.answer = () =>
                Promise.resolve(
                    jsonResponse(
                        200,
                        id === 'telegram' ? { ok: true } : id === 'pushplus' ? { code: 200 } : ''
                    )
                )
            const res = await r.service.sendTest(id)
            expect(res.ok, id).toBe(true)
            expect(res.outcome, id).toBe('sent')
            expect(res.requestMade, id).toBe(true)
            expect(res.channel, id).toBe(id)
            expect(r.calls, id).toHaveLength(1)
            const call = r.calls[0]
            expect(call?.init.method).toBe('POST')
            expect(call?.init.redirect, 'a webhook must not redirect the app').toBe('error')
            expect(call?.init.signal, 'there must be a time limit').toBeDefined()
            expect(String(call?.init.body)).toContain('Rewards Farmer')
            // The result and the audit log never hold a saved value.
            expectNoSecret(`${id} result`, JSON.stringify(res))
            await flushLogs()
            expectNoSecret(`${id} audit log`, r.auditText())
            expect(r.auditText()).toMatch(/test sent/)
        }
    })

    it('the real address used is the saved one (Discord) and the topic is added (ntfy)', async () => {
        const d = rig()
        d.writeConfig({ discord: FULL.discord })
        await d.service.sendTest('discord')
        expect(d.calls[0]?.url).toBe(FAKE.discordUrl)
        const n = rig()
        n.writeConfig({ ntfy: FULL.ntfy })
        await n.service.sendTest('ntfy')
        expect(n.calls[0]?.url).toBe('https://ntfy.example.com/my-topic')
        expect((n.calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe(
            `Bearer ${FAKE.ntfyToken}`
        )
    })

    it('a channel that is switched off can still be tested, and the result says the engine will not use it', async () => {
        const r = rig()
        r.writeConfig({ discord: { ...FULL.discord, enabled: false } })
        const res = await r.service.sendTest('discord')
        expect(res.ok).toBe(true)
        expect(res.message).toMatch(/switched off/)
    })

    it('does not change config.json', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord })
        const before = r.configText()
        await r.service.sendTest('discord')
        expect(r.configText()).toBe(before)
        expect(existsSync(r.backupDir)).toBe(false)
    })

    it('HTTP failures are reported as rejected with the real reason', async () => {
        const cases: [number, RegExp][] = [
            [401, /refused the saved token/],
            [403, /refused the saved token/],
            [404, /does not exist/],
            [429, /too fast/],
            [500, /on its side/],
            [502, /on its side/]
        ]
        for (const [status, text] of cases) {
            const r = rig()
            r.writeConfig({ discord: FULL.discord })
            r.state.answer = () => Promise.resolve(jsonResponse(status, 'nope'))
            const res = await r.service.sendTest('discord')
            expect(res.ok, String(status)).toBe(false)
            expect(res.outcome, String(status)).toBe('rejected')
            expect(res.requestMade, String(status)).toBe(true)
            expect(res.message, String(status)).toMatch(text)
        }
    })

    it('PushPlus: HTTP 200 with a wrong-token answer is NOT reported as sent', async () => {
        const r = rig()
        r.writeConfig({ pushplus: FULL.pushplus })
        r.state.answer = () => Promise.resolve(jsonResponse(200, { code: 600, msg: 'token error' }))
        const res = await r.service.sendTest('pushplus')
        expect(res.ok).toBe(false)
        expect(res.outcome).toBe('rejected')
        expect(res.message).toMatch(/answer code 600/)
    })

    it('Telegram: ok:false and non-JSON answers are rejected', async () => {
        for (const body of [{ ok: false, description: 'chat not found' }, 'not json']) {
            const r = rig()
            r.writeConfig({ telegram: FULL.telegram })
            r.state.answer = () => Promise.resolve(jsonResponse(200, body))
            const res = await r.service.sendTest('telegram')
            expect(res.ok).toBe(false)
            expect(res.outcome).toBe('rejected')
        }
    })

    it('offline, unreachable, timeout and unknown network failures each get their own plain outcome', async () => {
        const cases: [unknown, string, RegExp][] = [
            [
                new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }),
                'offline',
                /No internet connection/
            ],
            [
                new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } }),
                'offline',
                /No internet connection/
            ],
            [
                new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }),
                'unreachable',
                /could not be reached/
            ],
            [
                Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
                'timeout',
                /did not answer within 10 seconds/
            ],
            [new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } }), 'timeout', /did not answer/],
            [new Error('something odd'), 'failed', /could not be sent/]
        ]
        for (const [error, outcome, text] of cases) {
            const r = rig()
            r.writeConfig({ discord: FULL.discord })
            r.state.answer = () => Promise.reject(error)
            const res = await r.service.sendTest('discord')
            expect(res.ok, outcome).toBe(false)
            expect(res.outcome, outcome).toBe(outcome)
            expect(res.requestMade, outcome).toBe(true)
            expect(res.message, outcome).toMatch(text)
        }
    })

    it('an error whose text quotes the secret address never reaches the result or the log', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord, telegram: FULL.telegram })
        r.state.answer = () => Promise.reject(new TypeError(`request to ${FAKE.discordUrl} failed`))
        const res = await r.service.sendTest('discord')
        await flushLogs()
        expectNoSecret('result', JSON.stringify(res))
        expectNoSecret('audit', r.auditText())
    })

    it('a second test for the same channel inside 5 seconds is refused with no request; another channel is not blocked', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord, ntfy: FULL.ntfy })
        expect((await r.service.sendTest('discord')).outcome).toBe('sent')
        const again = await r.service.sendTest('discord')
        expect(again.outcome).toBe('too-soon')
        expect(again.requestMade).toBe(false)
        expect(r.calls).toHaveLength(1)
        expect((await r.service.sendTest('ntfy')).outcome).toBe('sent')
        expect(r.calls).toHaveLength(2)
        r.clock.now += MIN_TEST_INTERVAL_MS
        expect((await r.service.sendTest('discord')).outcome).toBe('sent')
        expect(r.calls).toHaveLength(3)
    })

    it('two tests started together send only one request', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord })
        const [a, b] = await Promise.all([r.service.sendTest('discord'), r.service.sendTest('discord')])
        const outcomes = [a.outcome, b.outcome].sort()
        expect(outcomes).toEqual(['sent', 'too-soon'])
        expect(r.calls).toHaveLength(1)
    })

    it('a failed test also counts for the 5 second limit (no hammering a broken address)', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord })
        r.state.answer = () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))
        expect((await r.service.sendTest('discord')).outcome).toBe('offline')
        expect((await r.service.sendTest('discord')).outcome).toBe('too-soon')
        expect(r.calls).toHaveLength(1)
    })

    it('Windows-style paths in the temp folder do not matter: the saved values are registered so later text is masked', async () => {
        const r = rig()
        r.writeConfig({ ntfy: FULL.ntfy })
        r.state.answer = () => Promise.reject(new Error(`token ${FAKE.ntfyToken} refused`))
        const res = await r.service.sendTest('ntfy')
        expectNoSecret('result', JSON.stringify(res))
    })
})

describe('notification service: state (Phase 16)', () => {
    it('lists the four offered channels and the two it does not offer', async () => {
        const r = rig()
        const s = await r.service.getState()
        expect(s.status).toBe('ok')
        expect(s.problem).toBeNull()
        expect(s.reason).toBeNull()
        expect(s.channels.map((c) => c.id)).toEqual(['discord', 'ntfy', 'telegram', 'pushplus'])
        expect(s.unsupported.map((u) => u.id)).toEqual(['serverchan', 'clawbot'])
        for (const c of s.channels) expect(c.readiness).toBe('not-set-up')
    })

    it('logFilter follows webhook.webhookLogFilter.enabled of the real file, unknown when unreadable', async () => {
        const r = rig()
        expect((await r.service.getState()).logFilter).toBe('off')
        const cfg = JSON.parse(readFileSync(r.configPath, 'utf8')) as {
            webhook: { webhookLogFilter: { enabled: boolean } }
        }
        cfg.webhook.webhookLogFilter.enabled = true
        writeFileSync(r.configPath, JSON.stringify(cfg))
        expect((await r.service.getState()).logFilter).toBe('on')
        writeFileSync(r.configPath, '{ nope')
        expect((await r.service.getState()).logFilter).toBe('unknown')
    })

    it('shows ready-off, on and misconfigured from the real file, and never a saved value', async () => {
        const r = rig()
        r.writeConfig({
            discord: { ...FULL.discord, enabled: true },
            ntfy: { ...FULL.ntfy, enabled: false },
            telegram: { botToken: FAKE.telegramBotToken },
            pushplus: {}
        })
        const s = await r.service.getState()
        const by = Object.fromEntries(s.channels.map((c) => [c.id, c.readiness]))
        expect(by).toEqual({
            discord: 'on',
            ntfy: 'ready-off',
            telegram: 'misconfigured',
            pushplus: 'not-set-up'
        })
        expectNoSecret('state', JSON.stringify(s))
    })
})

describe('notification service: switch on / off (Phase 16)', () => {
    it('refuses to switch ON an incomplete channel and changes nothing', async () => {
        const r = rig()
        const before = r.configText()
        const res = await r.service.setEnabled('discord', true)
        expect(res.ok).toBe(false)
        expect(res.code).toBe('BAD_REQUEST')
        expect(res.message).toMatch(/cannot be switched on yet/)
        expect(r.patches).toHaveLength(0)
        expect(r.configText()).toBe(before)
    })

    it('switches a complete channel on: backup first, only the one flag is sent, read back', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord })
        const res = await r.service.setEnabled('discord', true)
        expect(res.ok).toBe(true)
        expect(res.message).toMatch(/now on/)
        expect(r.patches).toEqual([{ webhook: { discord: { enabled: true } } }])
        const cfg = JSON.parse(r.configText()) as { webhook: { discord: { enabled: boolean; url: string } } }
        expect(cfg.webhook.discord.enabled).toBe(true)
        expect(cfg.webhook.discord.url).toBe(FAKE.discordUrl)
        const backups = readdirSync(r.backupDir)
        expect(backups).toHaveLength(1)
        expect(backups[0]).toMatch(/^config-\d{8}-\d{6}-\d{3}\.json$/)
        expect(
            (
                JSON.parse(readFileSync(join(r.backupDir, backups[0] ?? ''), 'utf8')) as {
                    webhook: { discord: { enabled: boolean } }
                }
            ).webhook.discord.enabled
        ).toBe(false)
        expect(r.calls).toHaveLength(0)
        await flushLogs()
        expectNoSecret('audit', r.auditText())
    })

    it('switching OFF works even when the saved setup is incomplete', async () => {
        const r = rig()
        r.writeConfig({ discord: { enabled: true } })
        const res = await r.service.setEnabled('discord', false)
        expect(res.ok).toBe(true)
        expect(
            (JSON.parse(r.configText()) as { webhook: { discord: { enabled: boolean } } }).webhook.discord
                .enabled
        ).toBe(false)
    })

    it('already in that state: nothing is written and no backup is made', async () => {
        const r = rig()
        r.writeConfig({ discord: { ...FULL.discord, enabled: true } })
        const res = await r.service.setEnabled('discord', true)
        expect(res.ok).toBe(true)
        expect(res.message).toMatch(/already on/)
        expect(r.patches).toHaveLength(0)
        expect(existsSync(r.backupDir)).toBe(false)
    })

    it('refused while a run is active', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord })
        r.state.editBlock = 'A run is active. Stop it first.'
        const res = await r.service.setEnabled('discord', true)
        expect(res.ok).toBe(false)
        expect(res.code).toBe('RUN_ACTIVE')
        expect(r.patches).toHaveLength(0)
    })

    it('engine not ready: says so and changes nothing', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord })
        r.state.api = null
        const res = await r.service.setEnabled('discord', true)
        expect(res.ok).toBe(false)
        expect(res.code).toBe('ENGINE_DOWN')
    })

    it('the engine refusing the change is reported and the saved file stays as it was', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord })
        const before = r.configText()
        r.state.api = {
            patchConfig: () => Promise.reject(new AppError('WRITE_FAILED', `refused ${FAKE.discordUrl}`))
        } as unknown as EngineApi
        const res = await r.service.setEnabled('discord', true)
        expect(res.ok).toBe(false)
        expect(res.code).toBe('WRITE_FAILED')
        expectNoSecret('message', res.message)
        expect(r.configText()).toBe(before)
    })

    it('an engine that says it accepted the change but did not write it is caught by the read-back', async () => {
        const r = rig()
        r.writeConfig({ discord: FULL.discord })
        r.state.api = { patchConfig: () => Promise.resolve({ ok: true }) } as unknown as EngineApi
        const res = await r.service.setEnabled('discord', true)
        expect(res.ok).toBe(false)
        expect(res.message).toMatch(/reading it back shows something else/)
    })

    it('bad arguments are refused', async () => {
        const r = rig()
        expect((await r.service.setEnabled('serverchan', true)).code).toBe('BAD_REQUEST')
        expect((await r.service.setEnabled('discord', 'yes')).code).toBe('BAD_REQUEST')
        expect((await r.service.setEnabled(undefined, undefined)).code).toBe('BAD_REQUEST')
        expect(r.patches).toHaveLength(0)
    })

    it('missing config.json: switch is refused with a way forward', async () => {
        const r = rig({ config: false })
        const res = await r.service.setEnabled('discord', true)
        expect(res.ok).toBe(false)
        expect(res.code).toBe('CONFIG_INVALID')
    })
})
