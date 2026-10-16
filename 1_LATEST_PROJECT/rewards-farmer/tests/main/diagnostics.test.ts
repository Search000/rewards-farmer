// @vitest-environment node
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticsService, readTail, writeFileAtomic } from '../../src/main/diagnosticsService'
import type { DiagnosticsDeps } from '../../src/main/diagnosticsService'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { LOG_FILES } from '../../src/shared/diagnostics-rules'
import { DEFAULT_SETTINGS } from '../../src/shared/farmer-types'
import type { FarmerState } from '../../src/shared/farmer-types'
import { makeCheck } from '../../src/shared/health-rules'
import type { HealthState } from '../../src/shared/health-types'
import { FAKE } from '../fixtures/fake-secrets'
import { readZip } from '../helpers/readZip'
import { FAKE_ACCOUNTS_ENV, FAKE_PASSWORD, FAKE_TOTP } from './helpers'

// Phase 14: diagnostics bundle. Everything here uses REAL temp folders, real files and the real ZIP writer. The secrets are
// FAKE values planted on purpose (rule 18) to prove they never reach the bundle. Failures are made from real file system state
// (missing folder, folder in the way, huge file, damaged file) or by an isolated stand-in where the state cannot be made.

const dirs: string[] = []
afterEach(() => {
    while (dirs.length > 0) {
        const d = dirs.pop() ?? ''
        try {
            chmodSync(d, 0o700)
        } catch {
            /* gone */
        }
        rmSync(d, { recursive: true, force: true })
    }
})
const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'rf-diag-'))
    dirs.push(d)
    return d
}

const T = '2026-10-14T10:00:00.000Z'
const HOME = 'C:\\Users\\JahidTest'
const COOKIE = 'COOKIEVALUE123abc'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM'
const UNKNOWN_PW = 'Zq9!unknownpw'

const farmerState = (patch: Partial<FarmerState['accounts']> = {}): FarmerState => ({
    engine: { link: 'ready', detail: null, version: '4.3.2' },
    accounts: { path: 'C:\\placeholder\\accounts.env', status: 'ok', error: null, count: 2, ...patch },
    run: { phase: 'idle', startedAt: null, lastExit: null },
    current: { account: null, points: null, section: null, detail: null, proxy: null },
    summary: { all: null, finished: null, failed: null },
    timer: { enabled: false, time: '00:00', nextFireAt: null },
    startDisabledReason: null,
    stopDisabledReason: null,
    notices: [],
    updatedAt: T
})

const healthState = (): HealthState => ({
    status: 'done',
    startedAt: T,
    finishedAt: T,
    checks: [
        makeCheck('app', 'ok', 'Rewards Farmer LUCK 0.0.1', null, T),
        makeCheck(
            'folder-data',
            'error',
            `The app data folder does not exist: ${HOME}\\AppData\\Roaming\\x (owner alpha@example.com)`,
            'Close this app and open it again with START.bat.',
            T
        )
    ]
})

interface Env {
    readonly root: string
    readonly engineRoot: string
    readonly logsDir: string
    readonly out: string
    readonly redactor: Redactor
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    readonly picked: { value: string | null }
    readonly writes: string[]
    readonly deps: DiagnosticsDeps
}

function setup(over: Partial<DiagnosticsDeps> = {}, opts: { files?: boolean } = {}): Env {
    const root = tmp()
    const engineRoot = join(root, 'engine')
    const logsDir = join(root, 'userData', 'logs')
    const out = join(root, 'out')
    mkdirSync(engineRoot, { recursive: true })
    mkdirSync(out, { recursive: true })
    const redactor = new Redactor()
    for (const v of Object.values(FAKE)) redactor.add(v)
    redactor.add(FAKE_PASSWORD)
    redactor.add(FAKE_TOTP)
    const redact = (t: string): string => redactor.redact(t)
    const audit = new JsonlLog(logsDir, 'audit.log', 'audit', redact)
    const appLog = new JsonlLog(logsDir, 'app.log.test-own', 'app', redact)
    const picked: { value: string | null } = { value: join(out, 'bundle.zip') }
    const writes: string[] = []
    if (opts.files !== false) {
        writeFileSync(join(engineRoot, 'package.json'), JSON.stringify({ name: 'engine', version: '4.3.2' }))
        writeFileSync(join(root, 'ENGINE_PIN'), 'e0c15a6ae6bd102cb04f2a3351e2fa281f82961c\n')
    }
    const deps: DiagnosticsDeps = {
        appInfo: () => ({
            name: 'Rewards Farmer LUCK',
            version: '0.0.1',
            electron: '44.7.0',
            chrome: '150.0.7000.12',
            isPackaged: false
        }),
        engineRoot,
        logsDir,
        enginePinPath: join(root, 'ENGINE_PIN'),
        settings: () => DEFAULT_SETTINGS,
        farmerState: () => farmerState(),
        runHealth: () => Promise.resolve(healthState()),
        redact,
        containsKnownSecret: (t) => redactor.containsKnownSecret(t),
        audit,
        appLog,
        pickSavePath: () => Promise.resolve(picked.value),
        homeDirs: () => [HOME],
        ...over
    }
    return { root, engineRoot, logsDir, out, redactor, audit, appLog, picked, writes, deps }
}

const bundleOf = (path: string): Map<string, string> =>
    new Map(readZip(readFileSync(path)).map((e) => [e.name, e.data.toString('utf8')]))
const allText = (b: Map<string, string>): string => [...b.values()].join('\n---\n')
// Test-only: the bundle JSON is read back with free property paths.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>
const json = (b: Map<string, string>): Loose => JSON.parse(b.get('diagnostics.json') ?? '{}') as Loose
const logLine = (message: string): string =>
    JSON.stringify({ ts: T, level: 'info', source: 'app', component: 'X', message })

// A full set of logs and config, every one of them carrying planted fake secrets in several forms.
function plantEverything(env: Env): void {
    mkdirSync(env.logsDir, { recursive: true })
    const secrets = [
        `discord ${FAKE.discordUrl}`,
        `telegram ${FAKE.telegramBotToken}`,
        `ntfy token ${FAKE.ntfyToken}`,
        `account password ${FAKE_PASSWORD} and 2fa ${FAKE_TOTP}`,
        `login failed password=${UNKNOWN_PW} for alpha@example.com`,
        'Authorization: Bearer abcdefghijklmnop1234567',
        `Cookie: MUID=${COOKIE}; _U=zzz999`,
        `token ${JWT}`,
        'proxy http://proxyuser-test:proxypass-test-only@203.0.113.77:8080',
        `opened ${HOME}\\AppData\\Roaming\\Rewards Farmer LUCK\\session.json for beta@example.com`
    ]
    for (const f of LOG_FILES)
        writeFileSync(join(env.logsDir, f.file), secrets.map(logLine).join('\n') + '\n', 'utf8')
    writeFileSync(
        join(env.engineRoot, 'config.json'),
        JSON.stringify({
            logLevel: 'info',
            headless: true,
            webhook: {
                discord: { enabled: true, url: FAKE.discordUrl },
                telegram: { botToken: FAKE.telegramBotToken, chatId: FAKE.telegramChatId },
                ntfy: { url: FAKE.ntfyUrl, token: FAKE.ntfyToken, topic: 'private-topic-name' },
                pushplus: { token: FAKE.pushplusToken },
                serverchan: { sendKey: FAKE.serverchanSendKey }
            },
            searchSettings: { chinaApi: { appkey: FAKE.chinaApiAppkey } },
            proxy: {
                url: 'http://203.0.113.77',
                port: 8080,
                username: 'proxyuser-test',
                password: 'proxypass-test-only'
            },
            futureField: { apiToken: 'new-upstream-token-123' }
        })
    )
    // Things the bundle must never read at all.
    writeFileSync(join(env.root, 'accounts.env'), FAKE_ACCOUNTS_ENV)
    mkdirSync(join(env.engineRoot, 'sessions', 'acct1'), { recursive: true })
    writeFileSync(join(env.engineRoot, 'sessions', 'acct1', 'cookies.json'), JSON.stringify({ MUID: COOKIE }))
}

const PLANTED = [
    ...Object.values(FAKE),
    FAKE_PASSWORD,
    FAKE_TOTP,
    UNKNOWN_PW,
    'alpha@example.com',
    'beta@example.com',
    '203.0.113.77',
    'JahidTest',
    COOKIE,
    'zzz999',
    JWT,
    'abcdefghijklmnop1234567',
    'proxyuser-test',
    'proxypass-test-only',
    'private-topic-name',
    'new-upstream-token-123',
    'must-not-be-forwarded'
]

describe('the bundle: what is inside', () => {
    it('is one valid ZIP with README, diagnostics.json, health.txt and the three logs', async () => {
        const env = setup()
        plantEverything(env)
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(true)
        expect(r.message).toContain('Saved the diagnostics bundle (6 files')
        const b = bundleOf(join(env.out, 'bundle.zip'))
        expect([...b.keys()].sort()).toEqual(
            [
                'README.txt',
                'diagnostics.json',
                'health.txt',
                'logs/app.log.txt',
                'logs/engine.log.txt',
                'logs/errors.log.txt'
            ].sort()
        )
        const d = json(b)
        expect(d['schema']).toBe(1)
        expect(d['app']).toMatchObject({ name: 'Rewards Farmer LUCK', version: '0.0.1', electron: '44.7.0' })
        expect(d['engine']).toMatchObject({
            processState: 'ready',
            runningVersion: '4.3.2',
            versionInFiles: '4.3.2',
            pinnedCommit: 'e0c15a6ae6bd102cb04f2a3351e2fa281f82961c'
        })
        expect(d['accounts']).toMatchObject({ fileChosen: true, status: 'ok', count: 2 })
        expect(d['appSettings']).toMatchObject({ themeMode: 'dark', timerEnabled: false })
        expect(d['health'].status).toBe('done')
        expect(d['health'].checks).toHaveLength(2)
        expect(d['logs'].map((l: { file: string; status: string }) => `${l.file}:${l.status}`)).toEqual([
            'app.log:included',
            'engine.log:included',
            'errors.log:included'
        ])
        expect(d['notIncluded'].join(' ')).toContain('audit.log')
        expect(b.get('health.txt')).toContain('[PROBLEM] App data folder (read and write)')
        expect(b.get('health.txt')).toContain('What to do: Close this app and open it again with START.bat.')
        expect(b.get('README.txt')).toContain('AUTOMATIC SAFETY CHECK')
    })

    it('shows config values that are safe and secret fields only as set / not set', async () => {
        const env = setup()
        plantEverything(env)
        await new DiagnosticsService(env.deps).exportBundle()
        const cfg = json(bundleOf(join(env.out, 'bundle.zip')))['engineConfig']
        expect(cfg.status).toBe('ok')
        expect(cfg.config.logLevel).toBe('info')
        expect(cfg.config.headless).toBe(true)
        expect(cfg.config.webhook.discord.enabled).toBe(true)
        expect(cfg.config.webhook.discord.url).toBe('<set>')
        expect(cfg.config.webhook.telegram.botToken).toBe('<set>')
        expect(cfg.config.searchSettings.chinaApi.appkey).toBe('<set>')
        expect(cfg.config.proxy.port).toBe(8080)
        expect(cfg.config.proxy.password).toBe('<hidden>')
        expect(cfg.config.futureField.apiToken).toBe('<hidden>')
    })
})

describe('the bundle: no secrets, sessions, tokens, cookies or real account data', () => {
    it('none of ~25 planted fake secrets, e-mails, cookies, tokens or user names is anywhere in any file of the ZIP', async () => {
        const env = setup()
        plantEverything(env)
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(true)
        const text = allText(bundleOf(join(env.out, 'bundle.zip')))
        const found = PLANTED.filter((s) => text.includes(s))
        expect(found).toEqual([])
        // The ZIP itself (compressed bytes are checked after unzipping above); the raw file must not hold them either.
        // (Deflate hides plain text, so only the unzipped contents are meaningful.)
        expect(text.length).toBeGreaterThan(500)
    })

    it('e-mail addresses become <email-N>, the same address the same number, in logs, health and status', async () => {
        const env = setup({
            farmerState: () =>
                farmerState({ status: 'error', error: 'ACCOUNT_2 beta@example.com has no password' })
        })
        plantEverything(env)
        await new DiagnosticsService(env.deps).exportBundle()
        const b = bundleOf(join(env.out, 'bundle.zip'))
        const app = b.get('logs/app.log.txt') ?? ''
        expect(app).toContain('<email-')
        expect(app).not.toMatch(/@example\.com/)
        const numbers = new Set([...allText(b).matchAll(/<email-(\d+)>/g)].map((m) => m[1]))
        // alpha and beta: exactly two different numbers in the whole bundle.
        expect([...numbers].sort()).toEqual(['1', '2'])
        expect(json(b)['accounts'].error).toMatch(/^ACCOUNT_2 <email-\d> has no password$/)
    })

    it('never reads the accounts file or the sessions folder (their content cannot appear)', async () => {
        const env = setup()
        plantEverything(env)
        await new DiagnosticsService(env.deps).exportBundle()
        const text = allText(bundleOf(join(env.out, 'bundle.zip')))
        for (const s of [
            'alpha@example.com',
            FAKE_PASSWORD,
            FAKE_TOTP,
            'proxy.example.com',
            COOKIE,
            'UNRELATED_SETTING'
        ])
            expect(text).not.toContain(s)
        // And the accounts path itself (it holds the Windows user name) is not in the bundle either: only "file chosen".
        expect(text).not.toContain('placeholder')
    })

    it('if the redactor ever fails, the safety check blocks the export and NOTHING is written', async () => {
        const env = setup({
            // A broken redactor that changes nothing, while the app still knows this value is secret.
            redact: (t) => t,
            containsKnownSecret: (t) => t.includes('KNOWN-SECRET-ZZ-123')
        })
        mkdirSync(env.logsDir, { recursive: true })
        writeFileSync(join(env.logsDir, 'app.log'), logLine('value KNOWN-SECRET-ZZ-123 here') + '\n')
        writeFileSync(join(env.out, 'bundle.zip'), 'OLD CONTENT')
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(false)
        expect(r.code).toBe('EXPORT_BLOCKED')
        expect(r.message).toContain('NOT saved')
        expect(r.message).toContain('a secret value the app knows')
        expect(r.message).not.toContain('KNOWN-SECRET-ZZ-123')
        // The file that was there before is untouched, and no temporary file is left.
        expect(readFileSync(join(env.out, 'bundle.zip'), 'utf8')).toBe('OLD CONTENT')
        expect(readdirSync(env.out)).toEqual(['bundle.zip'])
        await env.audit.flush()
        const audit = readFileSync(join(env.logsDir, 'audit.log'), 'utf8')
        expect(audit).toContain('"result":"blocked"')
        expect(audit).not.toContain('KNOWN-SECRET-ZZ-123')
    })

    it('the audit line of a good export holds no path, no secret, no e-mail', async () => {
        const env = setup()
        plantEverything(env)
        await new DiagnosticsService(env.deps).exportBundle()
        await env.audit.flush()
        const audit = readFileSync(join(env.logsDir, 'audit.log'), 'utf8')
        expect(audit).toContain('"action":"export-diagnostics"')
        expect(audit).toContain('"result":"ok"')
        for (const s of [...PLANTED, env.out]) expect(audit).not.toContain(s)
    })
})

describe('missing and damaged inputs do not stop the export', () => {
    it('with no logs folder, no config.json, no ENGINE_PIN and no engine package.json it still exports and says what is missing', async () => {
        const env = setup({ enginePinPath: null }, { files: false })
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(true)
        const b = bundleOf(join(env.out, 'bundle.zip'))
        expect([...b.keys()].sort()).toEqual(['README.txt', 'diagnostics.json', 'health.txt'])
        const d = json(b)
        expect(d['engineConfig'].status).toBe('missing')
        expect(d['engine'].pinnedCommit).toBeNull()
        expect(d['engine'].versionInFiles).toBeNull()
        expect(d['logs'].map((l: { status: string }) => l.status)).toEqual(['missing', 'missing', 'missing'])
    })

    it('a config.json that is not valid JSON is reported without any of its text', async () => {
        const env = setup()
        writeFileSync(
            join(env.engineRoot, 'config.json'),
            `{ "webhook": { "discord": { "url": "${FAKE.discordUrl}" `
        )
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(true)
        const b = bundleOf(join(env.out, 'bundle.zip'))
        expect(json(b)['engineConfig'].status).toBe('invalid-json')
        expect(allText(b)).not.toContain('FAKEdiscordTOKEN')
    })

    it('a config.json bigger than 1 MB is not read', async () => {
        const env = setup()
        writeFileSync(join(env.engineRoot, 'config.json'), 'x'.repeat(1024 * 1024 + 10))
        await new DiagnosticsService(env.deps).exportBundle()
        expect(json(bundleOf(join(env.out, 'bundle.zip')))['engineConfig'].status).toBe('too-large')
    })

    it('a log that cannot be read (a folder where the file should be) is reported; the other logs still go in', async () => {
        const env = setup()
        mkdirSync(join(env.logsDir, 'app.log'), { recursive: true })
        writeFileSync(join(env.logsDir, 'engine.log'), logLine('engine says hello') + '\n')
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(true)
        const b = bundleOf(join(env.out, 'bundle.zip'))
        const logs = json(b)['logs'] as { file: string; status: string; code: string | null }[]
        expect(logs.find((l) => l.file === 'app.log')).toMatchObject({
            status: 'unreadable',
            code: 'NOT_A_FILE'
        })
        expect(logs.find((l) => l.file === 'engine.log')?.status).toBe('included')
        expect(b.get('logs/engine.log.txt')).toContain('engine says hello')
        expect(b.has('logs/app.log.txt')).toBe(false)
    })

    it('a damaged log (NUL bytes, invalid UTF-8) becomes plain readable text', async () => {
        const env = setup()
        mkdirSync(env.logsDir, { recursive: true })
        writeFileSync(
            join(env.logsDir, 'app.log'),
            Buffer.concat([
                Buffer.from('good line\n'),
                Buffer.from([0x00, 0xff, 0xfe, 0x07, 0x41, 0x0a]),
                Buffer.from('last line\n')
            ])
        )
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(true)
        const text = bundleOf(join(env.out, 'bundle.zip')).get('logs/app.log.txt') ?? ''
        // eslint-disable-next-line no-control-regex
        expect(text).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)
        expect(text).toContain('good line')
        expect(text).toContain('last line')
    })

    it('health checks that never finish do not hang the export (30 s limit in the app, 50 ms here)', async () => {
        const env = setup({ runHealth: () => new Promise(() => undefined), healthTimeoutMs: 50 })
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(true)
        const b = bundleOf(join(env.out, 'bundle.zip'))
        expect(json(b)['health'].status).toBe('unavailable')
        expect(b.get('health.txt')).toContain('did not finish in time')
    })

    it('health checks that throw do not stop the export', async () => {
        const env = setup({ runHealth: () => Promise.reject(new Error('boom')) })
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(true)
        expect(json(bundleOf(join(env.out, 'bundle.zip')))['health'].status).toBe('unavailable')
    })
})

describe('very large logs', () => {
    it('a 30 MB log is not read whole: only the newest lines go in, fast, and the bundle stays small', async () => {
        const env = setup()
        mkdirSync(env.logsDir, { recursive: true })
        const filler = logLine('x'.repeat(70)) + '\n'
        const big = filler.repeat(Math.ceil((30 * 1024 * 1024) / filler.length))
        writeFileSync(
            join(env.logsDir, 'app.log'),
            big + [1, 2, 3, 4, 5].map((n) => logLine(`TAIL-${String(n)}`)).join('\n') + '\n'
        )
        expect(readFileSync(join(env.logsDir, 'app.log')).length).toBeGreaterThan(30 * 1024 * 1024)
        const started = Date.now()
        const r = await new DiagnosticsService(env.deps).exportBundle()
        const took = Date.now() - started
        expect(r.ok).toBe(true)
        expect(took).toBeLessThan(4000)
        const zip = readFileSync(join(env.out, 'bundle.zip'))
        expect(zip.length).toBeLessThan(300 * 1024)
        const b = bundleOf(join(env.out, 'bundle.zip'))
        const entry = b.get('logs/app.log.txt') ?? ''
        const lines = entry.trim().split('\n')
        expect(lines.length).toBeLessThanOrEqual(2001) // header + 2000 lines
        expect(entry).toContain('TAIL-5')
        expect(entry).toContain('older lines are not included')
        const rep = json(b)['logs'].find((l: { file: string }) => l.file === 'app.log')
        expect(rep).toMatchObject({ status: 'included', linesIncluded: 2000, olderLinesLeftOut: true })
        expect(rep.sizeBytes).toBeGreaterThan(30 * 1024 * 1024)
    })

    it('a read that starts in the middle of a line drops that half line', async () => {
        const env = setup({ logTailBytes: 700 })
        mkdirSync(env.logsDir, { recursive: true })
        const lines = Array.from({ length: 40 }, (_v, i) => logLine(`line-number-${String(i)}`))
        writeFileSync(join(env.logsDir, 'app.log'), lines.join('\n') + '\n')
        await new DiagnosticsService(env.deps).exportBundle()
        const entry = (bundleOf(join(env.out, 'bundle.zip')).get('logs/app.log.txt') ?? '').trim().split('\n')
        const body = entry.slice(1)
        expect(body.length).toBeGreaterThan(2)
        for (const l of body) expect(() => JSON.parse(l)).not.toThrow()
        expect(body[body.length - 1]).toContain('line-number-39')
    })

    it('one single 3 MB line with no line break does not blow up (nothing complete to include)', async () => {
        const env = setup()
        mkdirSync(env.logsDir, { recursive: true })
        writeFileSync(join(env.logsDir, 'app.log'), 'y'.repeat(3 * 1024 * 1024))
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(true)
        const b = bundleOf(join(env.out, 'bundle.zip'))
        expect(b.has('logs/app.log.txt')).toBe(false)
        expect(json(b)['logs'][0]).toMatchObject({
            file: 'app.log',
            status: 'included',
            linesIncluded: 0,
            olderLinesLeftOut: true
        })
    })

    it('a finished bundle above the size limit is refused and nothing is written', async () => {
        const env = setup({ maxBundleBytes: 200 })
        plantEverything(env)
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(false)
        expect(r.code).toBe('EXPORT_FAILED')
        expect(r.message).toContain('more than the allowed')
        expect(readdirSync(env.out)).toEqual([])
    })

    it('readTail reads only the end and says so', async () => {
        const dir = tmp()
        writeFileSync(join(dir, 'f.log'), 'a'.repeat(5000) + 'END')
        const r = await readTail(join(dir, 'f.log'), 100)
        expect(r.status).toBe('read')
        if (r.status === 'read') {
            expect(r.chunk.length).toBe(100)
            expect(r.chunk.endsWith('END')).toBe(true)
            expect(r.fromMiddle).toBe(true)
            expect(r.size).toBe(5003)
        }
        expect((await readTail(join(dir, 'nope.log'), 100)).status).toBe('missing')
    })
})

describe('where the file is saved, and every way saving can fail', () => {
    it('cancelling the save window writes nothing and does not even run the checks', async () => {
        let healthRuns = 0
        const env = setup({
            runHealth: () => {
                healthRuns += 1
                return Promise.resolve(healthState())
            }
        })
        env.picked.value = null
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r).toEqual({ ok: false, message: 'Export cancelled.' })
        expect(healthRuns).toBe(0)
        expect(readdirSync(env.out)).toEqual([])
    })

    it('a name without .zip gets .zip, and picking an important file never overwrites it', async () => {
        const env = setup()
        writeFileSync(join(env.engineRoot, 'config.json'), '{"keep":"me"}')
        env.picked.value = join(env.out, 'bundle-no-extension')
        expect((await new DiagnosticsService(env.deps).exportBundle()).ok).toBe(true)
        expect(existsSync(join(env.out, 'bundle-no-extension.zip'))).toBe(true)
        // The user picks the engine config.json itself in the save window (a mistake): the bundle goes to config.json.zip.
        env.picked.value = join(env.engineRoot, 'config.json')
        expect((await new DiagnosticsService(env.deps).exportBundle()).ok).toBe(true)
        expect(readFileSync(join(env.engineRoot, 'config.json'), 'utf8')).toBe('{"keep":"me"}')
        expect(existsSync(join(env.engineRoot, 'config.json.zip'))).toBe(true)
    })

    it('overwrites an older bundle only after the new one is complete', async () => {
        const env = setup()
        writeFileSync(join(env.out, 'bundle.zip'), 'OLD')
        expect((await new DiagnosticsService(env.deps).exportBundle()).ok).toBe(true)
        expect(readZip(readFileSync(join(env.out, 'bundle.zip'))).length).toBe(3)
        expect(readdirSync(env.out)).toEqual(['bundle.zip'])
    })

    it('destination folder does not exist (real state): clear message, nothing created', async () => {
        const env = setup()
        env.picked.value = join(env.out, 'no-such-folder', 'bundle.zip')
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(false)
        expect(r.code).toBe('WRITE_FAILED')
        expect(r.message).toContain('That folder does not exist')
        expect(readdirSync(env.out)).toEqual([])
    })

    it('a folder with that name is in the way (real state): clear message, no temporary file left, folder untouched', async () => {
        const env = setup()
        mkdirSync(join(env.out, 'bundle.zip'))
        writeFileSync(join(env.out, 'bundle.zip', 'keep.txt'), 'keep')
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(false)
        expect(r.code).toBe('WRITE_FAILED')
        expect(readdirSync(env.out)).toEqual(['bundle.zip'])
        expect(readFileSync(join(env.out, 'bundle.zip', 'keep.txt'), 'utf8')).toBe('keep')
    })

    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
        'a folder this user may not write to (REAL permission denied, non-root only)',
        async () => {
            const env = setup()
            const locked = join(env.out, 'locked')
            mkdirSync(locked)
            chmodSync(locked, 0o500)
            env.picked.value = join(locked, 'bundle.zip')
            const r = await new DiagnosticsService(env.deps).exportBundle()
            expect(r.ok).toBe(false)
            expect(r.message).toContain('does not allow saving')
            chmodSync(locked, 0o700)
            expect(readdirSync(locked)).toEqual([])
        }
    )

    it.each([
        ['EACCES', 'does not allow saving'],
        ['EPERM', 'does not allow saving'],
        ['ENOSPC', 'disk is full'],
        ['EROFS', 'read-only'],
        ['EBUSY', 'open in another program'],
        ['ENAMETOOLONG', 'not allowed'],
        ['EWEIRD', '(EWEIRD)']
    ])('write error %s (isolated stand-in) -> a plain message and a failed result', async (code, text) => {
        const env = setup({
            writeBundle: () => Promise.reject(Object.assign(new Error('os error'), { code }))
        })
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(false)
        expect(r.code).toBe('WRITE_FAILED')
        expect(r.message).toContain(text)
        expect(r.message).not.toContain('os error')
        await env.audit.flush()
        expect(readFileSync(join(env.logsDir, 'audit.log'), 'utf8')).toContain('"result":"failed"')
    })

    it('a save window that fails to open is reported, not thrown', async () => {
        const env = setup({ pickSavePath: () => Promise.reject(new Error('dialog broke')) })
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(false)
        expect(r.code).toBe('EXPORT_FAILED')
        expect(r.message).toContain('save window could not be opened')
    })

    it('a relative save place is refused', async () => {
        const env = setup()
        env.picked.value = 'bundle.zip'
        const r = await new DiagnosticsService(env.deps).exportBundle()
        expect(r.ok).toBe(false)
        expect(r.code).toBe('BAD_REQUEST')
    })

    it('a second export while one is running is refused, then works again', async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const env = setup({
            pickSavePath: async () => {
                await gate
                return join(env.out, 'one.zip')
            }
        })
        const svc = new DiagnosticsService(env.deps)
        const first = svc.exportBundle()
        const second = await svc.exportBundle()
        expect(second.ok).toBe(false)
        expect(second.message).toContain('already running')
        release()
        expect((await first).ok).toBe(true)
        expect((await svc.exportBundle()).ok).toBe(true)
    })

    it('writeFileAtomic leaves no temporary file when the final step fails', async () => {
        const dir = tmp()
        mkdirSync(join(dir, 'target.zip'))
        await expect(writeFileAtomic(join(dir, 'target.zip'), Buffer.from('x'))).rejects.toThrow()
        expect(readdirSync(dir)).toEqual(['target.zip'])
    })
})
