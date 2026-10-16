// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSettingsStore, sanitizeSettings } from '../../src/main/appSettings'
import { AppError, EngineApi, mapHttpError } from '../../src/main/engine/apiClient'
import {
    loadAccountsFile,
    looksLikeEnvFileName,
    MAX_ENV_FILE_BYTES,
    parseEnvText
} from '../../src/main/engine/envFile'
import { MASK, Redactor } from '../../src/main/engine/redact'
import { buildHomeNumbers, latestActivity, proxyLabel } from '../../src/main/engine/snapshot'
import { JsonlLog, localIso } from '../../src/main/jsonlLog'
import { MISSED_GRACE_MS, nextOccurrence, Scheduler } from '../../src/main/scheduler'
import { isValidTime } from '../../src/shared/farmer-types'

let tmp: string
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'rf-unit-'))
})
afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    vi.useRealTimers()
})

describe('Redactor', () => {
    it('masks registered secret values anywhere, longest first', () => {
        const r = new Redactor()
        r.add('hunter2-long-password')
        r.add('hunter2')
        expect(r.redact('login with hunter2-long-password failed; hunter2 again')).toBe(
            `login with ${MASK} failed; ${MASK} again`
        )
    })
    it('ignores values shorter than 4 characters (documented limit)', () => {
        const r = new Redactor()
        r.add('abc')
        expect(r.redact('abc stays')).toBe('abc stays')
    })
    it('masks bearer tokens, URL credentials, webhooks, bot tokens and key=value secrets', () => {
        const r = new Redactor()
        const input = [
            'Authorization: Bearer abcdef1234567890abcdef',
            'proxy http://user:p4ss@proxy.example.com:8080',
            'hook https://discord.com/api/webhooks/123456/abcDEF_ghi',
            'tg 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0',
            'ACCOUNT_1_PASSWORD=supersecret',
            '{"password":"abc123","totpSecret":"JBSWY3DP"}'
        ].join('\n')
        const out = r.redact(input)
        for (const leaked of [
            'abcdef1234567890abcdef',
            'p4ss',
            '/webhooks/123456',
            'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0',
            'supersecret',
            'abc123',
            'JBSWY3DP'
        ])
            expect(out, `leaked ${leaked}`).not.toContain(leaked)
        expect(out).toContain('proxy.example.com') // host stays, only credentials go
    })
    it('does NOT mask e-mail addresses (decision 7: full e-mails visible)', () => {
        expect(new Redactor().redact('Starting account: alpha@example.com')).toContain('alpha@example.com')
    })
})

describe('envFile', () => {
    it('parses like the engine loader: comments, quotes, blank lines', () => {
        expect(parseEnvText('# c\nA=1\n\nB="two"\r\nC=\'three\'\nbad line')).toEqual({
            A: '1',
            B: 'two',
            C: 'three'
        })
    })
    it('accepts only .env-like file names', () => {
        for (const ok of ['.env', 'accounts.env', '.env.local', 'C:\\x\\my.env'])
            expect(looksLikeEnvFileName(ok)).toBe(true)
        for (const no of ['accounts.txt', 'passwd', 'config.json'])
            expect(looksLikeEnvFileName(no)).toBe(false)
    })
    it('forwards only ACCOUNT_N_* variables and counts accounts and secrets', async () => {
        const p = join(tmp, 'a.env')
        writeFileSync(
            p,
            'ACCOUNT_1_EMAIL=a@x.com\nACCOUNT_1_PASSWORD=pw-1234\nOTHER=zzz\nACCOUNT_2_EMAIL=\nHEADLESS=false\n'
        )
        const res = await loadAccountsFile(p)
        expect(res.ok).toBe(true)
        if (!res.ok) return
        expect(Object.keys(res.file.vars).sort()).toEqual(['ACCOUNT_1_EMAIL', 'ACCOUNT_1_PASSWORD'])
        expect(res.file.accountCount).toBe(1)
        expect(res.file.secretValues).toEqual(['pw-1234'])
    })
    it('reports clear errors: missing file, directory, wrong name, too large, no accounts', async () => {
        const msg = async (p: string) => {
            const r = await loadAccountsFile(p)
            return r.ok ? 'OK' : r.message
        }
        expect(await msg(join(tmp, 'gone.env'))).toMatch(/does not exist/)
        mkdirSync(join(tmp, 'dir.env'))
        expect(await msg(join(tmp, 'dir.env'))).toMatch(/not a file/)
        writeFileSync(join(tmp, 'x.txt'), 'ACCOUNT_1_EMAIL=a@x.com')
        expect(await msg(join(tmp, 'x.txt'))).toMatch(/file name/)
        writeFileSync(join(tmp, 'big.env'), 'A'.repeat(MAX_ENV_FILE_BYTES + 1))
        expect(await msg(join(tmp, 'big.env'))).toMatch(/larger than/)
        writeFileSync(join(tmp, 'empty.env'), '# nothing here\nFOO=bar\n')
        expect(await msg(join(tmp, 'empty.env'))).toMatch(/No account found/)
    })
    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
        'reports permission denied',
        async () => {
            const p = join(tmp, 'locked.env')
            writeFileSync(p, 'ACCOUNT_1_EMAIL=a@x.com')
            chmodSync(p, 0o000)
            const r = await loadAccountsFile(p)
            expect(r.ok).toBe(false)
        }
    )
})

describe('snapshot mapping (no invented numbers)', () => {
    it('everything unknown stays null', () => {
        expect(buildHomeNumbers({ points: null, accounts: null, history: null })).toEqual({
            account: null,
            points: null,
            proxy: null,
            all: null,
            finished: null,
            failed: null
        })
    })
    it('counts finished and failed from live /points accounts', () => {
        const n = buildHomeNumbers({
            points: {
                currentAccount: 'b@x.com',
                balance: 55,
                accounts: [
                    { email: 'a@x.com', done: true, success: true },
                    { email: 'b@x.com', done: false, success: null },
                    { email: 'c@x.com', done: true, success: false }
                ]
            },
            accounts: {
                count: 3,
                accounts: [{ email: 'b@x.com', proxy: { url: 'http://p.example.com', port: '8080' } }]
            },
            history: null
        })
        expect(n).toMatchObject({
            account: 'b@x.com',
            points: 55,
            all: 3,
            finished: 1,
            failed: 1,
            proxy: 'http://p.example.com:8080'
        })
    })
    it('falls back to the last history run, and to a true zero only when the engine answered with no run yet', () => {
        const last = buildHomeNumbers({
            points: { accounts: [] },
            accounts: { count: 2 },
            history: { runs: [{ accounts: [{ success: true }, { success: false }, { success: false }] }] }
        })
        expect([last.finished, last.failed]).toEqual([1, 2])
        const none = buildHomeNumbers({
            points: { accounts: [] },
            accounts: { count: 2 },
            history: { runs: [] }
        })
        expect([none.finished, none.failed]).toEqual([0, 0])
    })
    it('proxy label: none when the account has no proxy, never invents one', () => {
        expect(proxyLabel({ accounts: [{ email: 'a@x.com' }] }, 'a@x.com')).toBeNull()
        expect(
            proxyLabel({ accounts: [{ email: 'a@x.com', proxy: { url: 'http://p', port: 0 } }] }, 'a@x.com')
        ).toBe('http://p:0')
    })
    it('latest activity skips controller lines and redacts', () => {
        const act = latestActivity(
            {
                logs: [
                    { source: 'stdout', title: 'SEARCH-BING', message: 'pointsGained=3 secret=abc' },
                    { source: 'controller', title: 'CONTROLLER', message: 'Run started' }
                ]
            },
            (s) => s.replace('abc', MASK)
        )
        expect(act).toEqual({ section: 'SEARCH-BING', detail: `pointsGained=3 secret=${MASK}` })
        expect(latestActivity(null, (s) => s)).toEqual({ section: null, detail: null })
    })
})

describe('Scheduler', () => {
    it('computes the next local occurrence strictly after now', () => {
        const base = new Date(2026, 9, 11, 10, 30, 0).getTime()
        expect(new Date(nextOccurrence(base, '10:31')).getMinutes()).toBe(31)
        expect(new Date(nextOccurrence(base, '10:30')).getDate()).toBe(12)
    })
    it('validates the time format', () => {
        expect(isValidTime('00:00') && isValidTime('23:59')).toBe(true)
        for (const bad of ['24:00', '9:00', '12:60', '', 'ab:cd']) expect(isValidTime(bad)).toBe(false)
        expect(() =>
            new Scheduler({ onFire: () => undefined, onMissed: () => undefined }).configure(true, '99:99')
        ).toThrow(RangeError)
    })
    it('fires on time, repeats daily, and reports a missed time instead of starting late', () => {
        vi.useFakeTimers()
        let now = new Date(2026, 9, 11, 10, 0, 0).getTime()
        const fired: string[] = []
        const missed: number[] = []
        const s = new Scheduler({
            now: () => now,
            tickMs: 1000,
            onFire: (i) => fired.push(i.scheduledFor),
            onMissed: (i) => missed.push(i.lateByMs)
        })
        s.configure(true, '10:05')
        expect(s.state().enabled).toBe(true)
        now += 4 * 60_000
        vi.advanceTimersByTime(1000)
        expect(fired).toHaveLength(0)
        now += 61_000
        vi.advanceTimersByTime(1000)
        expect(fired).toHaveLength(1)
        // PC slept: next scheduled time is tomorrow 10:05, we wake 2 hours later
        now = new Date(2026, 9, 12, 12, 5, 0).getTime()
        vi.advanceTimersByTime(1000)
        expect(fired).toHaveLength(1)
        expect(missed).toHaveLength(1)
        expect(missed[0]).toBeGreaterThan(MISSED_GRACE_MS)
        s.dispose()
    })
    it('does nothing when disabled', () => {
        vi.useFakeTimers()
        const fired: string[] = []
        const s = new Scheduler({
            now: Date.now,
            onFire: (i) => fired.push(i.scheduledFor),
            onMissed: () => undefined
        })
        s.configure(false, '00:00')
        vi.advanceTimersByTime(3_600_000)
        expect(fired).toHaveLength(0)
        expect(s.state().nextFireAt).toBeNull()
    })
})

describe('AppSettingsStore', () => {
    it('uses defaults when no file exists, and round-trips an update', async () => {
        const store = new AppSettingsStore(tmp)
        expect((await store.load()).settings).toMatchObject({
            themeMode: 'dark',
            accountsPath: null,
            timerEnabled: false,
            timerTime: '00:00'
        })
        await store.update({
            themeMode: 'light',
            timerEnabled: true,
            timerTime: '07:30',
            accountsPath: 'C:\\x\\a.env'
        })
        const again = await new AppSettingsStore(tmp).load()
        expect(again.settings).toMatchObject({
            themeMode: 'light',
            timerEnabled: true,
            timerTime: '07:30',
            accountsPath: 'C:\\x\\a.env'
        })
        expect(readdirSync(tmp)).toEqual(['app-settings.json']) // atomic write leaves no temp file
    })
    it('keeps a corrupt file as a backup and starts from defaults with a notice', async () => {
        writeFileSync(join(tmp, 'app-settings.json'), '{ not json')
        const res = await new AppSettingsStore(tmp, () => 123).load()
        expect(res.notice).toMatch(/corrupt/)
        expect(readFileSync(join(tmp, 'app-settings.corrupt-123.json'), 'utf8')).toBe('{ not json')
    })
    it('sanitizes wrong types and bad times', () => {
        expect(
            sanitizeSettings({ themeMode: 5, accountsPath: 7, timerEnabled: 'yes', timerTime: '25:00' })
        ).toEqual({
            schemaVersion: 2,
            themeMode: 'dark',
            accountsPath: null,
            timerEnabled: false,
            timerTime: '00:00',
            shutdownAfterRun: false
        })
    })
    it('shutdownAfterRun is true only for the boolean true', () => {
        expect(sanitizeSettings({ shutdownAfterRun: true }).shutdownAfterRun).toBe(true)
        expect(sanitizeSettings({ shutdownAfterRun: 'true' }).shutdownAfterRun).toBe(false)
        expect(sanitizeSettings({ shutdownAfterRun: 1 }).shutdownAfterRun).toBe(false)
    })
    it('a schema 1 file is copied to a backup first, then upgraded to schema 2 with the old values kept', async () => {
        const old = JSON.stringify({
            schemaVersion: 1,
            themeMode: 'light',
            accountsPath: 'C:\\x\\a.env',
            timerEnabled: true,
            timerTime: '07:30'
        })
        writeFileSync(join(tmp, 'app-settings.json'), old)
        const res = await new AppSettingsStore(tmp, () => 123).load()
        expect(res.notice).toBeNull()
        expect(res.settings).toMatchObject({
            schemaVersion: 2,
            themeMode: 'light',
            timerEnabled: true,
            timerTime: '07:30',
            shutdownAfterRun: false
        })
        expect(readFileSync(join(tmp, 'app-settings.schema1-123.json'), 'utf8')).toBe(old)
        const upgraded = JSON.parse(readFileSync(join(tmp, 'app-settings.json'), 'utf8')) as Record<
            string,
            unknown
        >
        expect(upgraded).toMatchObject({ schemaVersion: 2, shutdownAfterRun: false, themeMode: 'light' })
    })
    it('a schema 2 file is not backed up again', async () => {
        const store = new AppSettingsStore(tmp, () => 5)
        await store.update({ shutdownAfterRun: true })
        const res = await new AppSettingsStore(tmp, () => 6).load()
        expect(res.settings.shutdownAfterRun).toBe(true)
        expect(readdirSync(tmp)).toEqual(['app-settings.json'])
    })
})

describe('JsonlLog', () => {
    it('writes one redacted JSON object per line with a UTC offset', async () => {
        const log = new JsonlLog(join(tmp, 'logs'), 'a.log', 'audit', (t) => t.replaceAll('SECRET1234', MASK))
        log.write({
            level: 'info',
            component: 'T',
            action: 'x',
            result: 'ok',
            message: 'token SECRET1234 used',
            corrId: 'c1'
        })
        await log.flush()
        const line = readFileSync(join(tmp, 'logs', 'a.log'), 'utf8').trim()
        const obj = JSON.parse(line) as Record<string, string>
        expect(obj['message']).toBe(`token ${MASK} used`)
        expect(obj['source']).toBe('audit')
        expect(obj['ts']).toMatch(/T\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/)
        expect(line).not.toContain('SECRET1234')
        expect(localIso(new Date(0))).toMatch(/[+-]\d\d:\d\d$/)
    })
    it('survives a write failure and reports it instead of crashing', async () => {
        writeFileSync(join(tmp, 'blocker'), 'x') // a FILE where the log directory should be
        const log = new JsonlLog(join(tmp, 'blocker', 'logs'), 'a.log', 'app', (t) => t)
        log.write({ level: 'info', component: 'T', message: 'hi' })
        await log.flush()
        expect(log.lastError).not.toBeNull()
    })
})

describe('EngineApi', () => {
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
    it('sends the bearer token and calls only allowed routes', async () => {
        const fetchImpl = vi.fn(() => Promise.resolve(json(200, { ok: true })))
        const api = new EngineApi({
            baseUrl: 'http://127.0.0.1:1/',
            token: 'tok-123',
            fetchImpl: fetchImpl as unknown as typeof fetch
        })
        await api.health()
        const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
        expect(call[0]).toBe('http://127.0.0.1:1/health')
        expect((call[1].headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123')
    })
    it('maps HTTP errors to app error codes (docs/architecture.md section 9)', () => {
        expect(mapHttpError(400, {}).code).toBe('BAD_REQUEST')
        expect(mapHttpError(401, {}).code).toBe('AUTH')
        expect(mapHttpError(403, {}).code).toBe('WRITE_DISABLED')
        expect(mapHttpError(404, {}).code).toBe('NOT_FOUND')
        expect(mapHttpError(409, { code: 'ALREADY_RUNNING' }).code).toBe('RUN_ACTIVE')
        expect(mapHttpError(409, { code: 'NOT_RUNNING' }).code).toBe('NOT_RUNNING')
        expect(mapHttpError(422, { error: 'bad' }).message).toBe('bad')
        const e = mapHttpError(500, {})
        expect([e.code, e.retryable]).toEqual(['ENGINE_ERROR', true])
    })
    it('turns a refused connection into ENGINE_DOWN and a non-JSON answer into ENGINE_ERROR', async () => {
        const down = new EngineApi({
            baseUrl: 'http://127.0.0.1:1',
            token: 't',
            fetchImpl: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch
        })
        await expect(down.status()).rejects.toMatchObject({ code: 'ENGINE_DOWN' })
        const html = new EngineApi({
            baseUrl: 'http://x',
            token: 't',
            fetchImpl: (() =>
                Promise.resolve(new Response('<html>', { status: 200 }))) as unknown as typeof fetch
        })
        await expect(html.status()).rejects.toBeInstanceOf(AppError)
    })
})
