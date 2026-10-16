// @vitest-environment node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_ACCOUNT_INPUT } from '../../src/shared/accounts-types'
import type { AccountInput } from '../../src/shared/accounts-types'
import { AccountsService, parseAccountInput } from '../../src/main/accounts'
import { FAKE_ACCOUNTS_ENV, FAKE_PASSWORD, FAKE_TOTP, makeHarness, readLog, waitFor } from './helpers'
import type { Harness } from './helpers'

// Accounts lifecycle against the REAL engine control API (engine/scripts/api/server.js, copied unmodified into a temp dir).
// Only the bot entry is a fixture. Every account in this file is FAKE and exists only in a temp dir (rule 18).

const harnesses: Harness[] = []
afterEach(async () => {
    while (harnesses.length > 0) await harnesses.pop()?.cleanup()
})

interface Rig {
    readonly h: Harness
    readonly accounts: AccountsService
    readonly backupDir: string
    // Runs once, the next time the service asks for the clock (used to simulate an outside edit in the middle of a change).
    hook: (() => void) | null
}

async function rig(
    options: Parameters<typeof makeHarness>[0] = {},
    backupDirOverride?: string
): Promise<Rig> {
    const h = makeHarness(options)
    harnesses.push(h)
    const backupDir = backupDirOverride ?? join(h.fx.userData, 'backups', 'accounts')
    const r: Rig = { h, backupDir, hook: null, accounts: undefined as unknown as AccountsService }
    const accounts = new AccountsService({
        host: {
            accountsPath: () => h.farmer.accountsPath(),
            editBlock: () => h.farmer.accountsEditBlock(),
            editAccounts: (work) => h.farmer.editAccounts(work)
        },
        redactor: h.redactor,
        audit: h.audit,
        appLog: h.appLog,
        backupDir,
        now: () => {
            const hook = r.hook
            r.hook = null
            hook?.()
            return new Date()
        }
    })
    ;(r as { accounts: AccountsService }).accounts = accounts
    await h.farmer.init()
    return r
}

async function ready(options: Parameters<typeof makeHarness>[0] = {}): Promise<Rig> {
    const r = await rig(options)
    const res = await r.h.farmer.pickAccounts()
    expect(res.result.ok).toBe(true)
    await waitFor(
        () => r.h.farmer.getState().engine.link,
        (v) => v === 'ready',
        'engine ready'
    )
    return r
}

const form = (over: Partial<AccountInput>): AccountInput => ({ ...EMPTY_ACCOUNT_INPUT, ...over })
const fileText = (r: Rig): string => readFileSync(r.h.fx.accountsFile, 'utf8')
const backups = (r: Rig): string[] =>
    existsSync(r.backupDir) ? readdirSync(r.backupDir).filter((n) => n.endsWith('.bak')) : []
const engineEmails = async (r: Rig): Promise<string[]> => {
    const api = r.h.supervisor.api
    if (api === null) return []
    const res = await api.accounts()
    return (res.accounts ?? []).map((a) => a.email ?? '').sort()
}
// Engine and app must agree: the engine API counts the accounts of the file we gave it.
async function expectEngineCount(r: Rig, n: number): Promise<void> {
    await waitFor(
        () => engineEmails(r),
        (v) => v.length === n,
        `engine lists ${String(n)} accounts`
    )
}

describe('Accounts: list shows the real file', () => {
    it('before an accounts file is chosen: not-set, no accounts, edit disabled with a reason', async () => {
        const r = await rig()
        const s = await r.accounts.getState()
        expect(s).toMatchObject({ status: 'not-set', path: null, accounts: [] })
        expect(s.editDisabledReason).toMatch(/No accounts file chosen/)
        expect(s.lastBackupAt).toBeNull()
    })

    it('lists the accounts of the chosen file with flags only, never secret values', async () => {
        const r = await ready()
        const s = await r.accounts.getState()
        expect(s.status).toBe('ok')
        expect(s.path).toBe(r.h.fx.accountsFile)
        expect(s.editDisabledReason).toBeNull()
        expect(s.accounts.map((a) => a.email)).toEqual(['alpha@example.com', 'beta@example.com'])
        expect(s.accounts[0]).toMatchObject({
            slot: 1,
            hasPassword: true,
            hasTotp: true,
            hasRecoveryEmail: false,
            langCode: null,
            geoLocale: null,
            proxy: null,
            problems: []
        })
        expect(s.accounts[1]).toMatchObject({
            slot: 2,
            hasTotp: false,
            proxy: { url: 'http://proxy.example.com', port: 8080, httpToo: false, hasCredentials: true },
            problems: []
        })
        const json = JSON.stringify(s)
        for (const secret of [FAKE_PASSWORD, FAKE_TOTP, 'proxypass-test-only', 'proxyuser-test'])
            expect(json).not.toContain(secret)
    })

    it('matches what the engine itself reports (same e-mails, same count)', async () => {
        const r = await ready()
        const s = await r.accounts.getState()
        expect(await engineEmails(r)).toEqual(s.accounts.map((a) => a.email).sort())
    })

    it('a changed file on disk shows up on the next read (no stale copy)', async () => {
        const r = await ready()
        writeFileSync(r.h.fx.accountsFile, `${FAKE_ACCOUNTS_ENV}ACCOUNT_3_EMAIL=gamma@example.com\n`)
        expect((await r.accounts.getState()).accounts.map((a) => a.slot)).toEqual([1, 2, 3])
    })

    it('a missing or broken file gives an error state, not a crash', async () => {
        const r = await ready()
        writeFileSync(r.h.fx.accountsFile, 'ACCOUNT_1_EMAIL=a@example.com\n')
        writeFileSync(join(r.h.fx.dir, 'x.txt'), 'x')
        const ok = await r.accounts.getState()
        expect(ok.status).toBe('ok')
        const bad = Buffer.from([0xff, 0xfe, 0x41, 0x42])
        writeFileSync(r.h.fx.accountsFile, bad)
        const s = await r.accounts.getState()
        expect(s.status).toBe('error')
        expect(s.error).toMatch(/not valid UTF-8/)
        expect(s.accounts).toEqual([])
    })

    it('shows problems the engine would reject (bad region, proxy without port)', async () => {
        const r = await ready()
        writeFileSync(
            r.h.fx.accountsFile,
            'ACCOUNT_1_EMAIL=a@example.com\nACCOUNT_1_GEO_LOCALE=USA\nACCOUNT_2_EMAIL=b@example.com\nACCOUNT_2_PROXY_URL=http://p.example.com\n'
        )
        const s = await r.accounts.getState()
        expect(s.accounts[0]?.problems.length).toBeGreaterThan(0)
        expect(s.accounts[1]?.problems.join(' ')).toMatch(/port/)
    })
})

describe('Accounts: add', () => {
    it('adds one account: file changes only by the new block, backup holds the exact old bytes, engine restarts on the new file', async () => {
        const r = await ready()
        const before = fileText(r)
        const res = await r.accounts.add(
            form({
                email: 'delta@example.com',
                password: 'delta-pass-77',
                langCode: 'pt-br',
                geoLocale: 'br'
            })
        )
        expect(res).toMatchObject({ ok: true })
        const after = fileText(r)
        expect(after.startsWith(before)).toBe(true)
        expect(after.slice(before.length)).toBe(
            '\n# Account 3\nACCOUNT_3_EMAIL=delta@example.com\nACCOUNT_3_PASSWORD=delta-pass-77\nACCOUNT_3_LANG_CODE=pt-BR\nACCOUNT_3_GEO_LOCALE=BR\n'
        )
        expect(after).toContain('UNRELATED_SETTING=must-not-be-forwarded')
        const files = backups(r)
        expect(files).toHaveLength(1)
        expect(readFileSync(join(r.backupDir, files[0] ?? ''), 'utf8')).toBe(before)
        await expectEngineCount(r, 3)
        expect(r.h.farmer.getState().accounts.count).toBe(3)
        expect((await r.accounts.getState()).lastBackupAt).not.toBeNull()
    })

    it('refuses invalid data and a duplicate e-mail, writes nothing and makes no backup', async () => {
        const r = await ready()
        const before = fileText(r)
        for (const bad of [
            form({ email: '' }),
            form({ email: 'nope' }),
            form({ email: 'ALPHA@example.com' }),
            form({ email: 'z@example.com', proxyUrl: 'proxy.example.com' }),
            form({ email: 'z@example.com', langCode: 'not a tag' }),
            form({ email: 'z@example.com', password: 'line\nbreak' })
        ]) {
            expect(await r.accounts.add(bad)).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
        }
        expect(fileText(r)).toBe(before)
        expect(backups(r)).toHaveLength(0)
        expect(await r.accounts.add('not an object')).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
        expect(await r.accounts.add({ ...EMPTY_ACCOUNT_INPUT, email: 5 })).toMatchObject({
            ok: false,
            code: 'BAD_REQUEST'
        })
    })

    it('adds an account with proxy and credentials; the engine accepts the file and shows the proxy without credentials', async () => {
        const r = await ready()
        const res = await r.accounts.add(
            form({
                email: 'prox@example.com',
                proxyUrl: 'http://px.example.com',
                proxyPort: '3128',
                proxyUsername: 'pxuser-1',
                proxyPassword: 'pxpass-1'
            })
        )
        expect(res.ok).toBe(true)
        await expectEngineCount(r, 3)
        const view = (await r.accounts.getState()).accounts.find((a) => a.email === 'prox@example.com')
        expect(view?.proxy).toEqual({
            url: 'http://px.example.com',
            port: 3128,
            httpToo: false,
            hasCredentials: true
        })
        expect(view?.problems).toEqual([])
        expect(JSON.stringify(await r.accounts.getState())).not.toContain('pxpass-1')
    })

    it('uses the next free slot and fills the file from empty accounts only when valid', async () => {
        const r = await ready()
        writeFileSync(r.h.fx.accountsFile, 'ACCOUNT_5_EMAIL=e@example.com\n')
        await r.h.farmer.restartEngine()
        expect((await r.accounts.add(form({ email: 'f@example.com' }))).ok).toBe(true)
        expect((await r.accounts.getState()).accounts.map((a) => a.slot)).toEqual([5, 6])
    })

    it('two changes started at the same time are done one after the other, both succeed', async () => {
        const r = await ready()
        const [a, b] = await Promise.all([
            r.accounts.add(form({ email: 'one@example.com' })),
            r.accounts.add(form({ email: 'two@example.com' }))
        ])
        expect(a.ok).toBe(true)
        expect(b.ok).toBe(true)
        expect((await r.accounts.getState()).accounts.map((x) => x.email)).toEqual([
            'alpha@example.com',
            'beta@example.com',
            'one@example.com',
            'two@example.com'
        ])
        expect(backups(r)).toHaveLength(2)
    })
})

describe('Accounts: edit', () => {
    it('empty secret boxes keep the saved secrets; other fields change; nothing else in the file moves', async () => {
        const r = await ready()
        const before = fileText(r)
        const res = await r.accounts.update(
            1,
            'alpha@example.com',
            form({ email: 'alpha@example.com', langCode: 'nl', geoLocale: 'NL' })
        )
        expect(res.ok).toBe(true)
        const after = fileText(r)
        expect(after).toContain(`ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}`)
        expect(after).toContain(`ACCOUNT_1_TOTP_SECRET=${FAKE_TOTP}`)
        expect(after).toContain('ACCOUNT_1_LANG_CODE=nl')
        expect(after).toContain('ACCOUNT_1_GEO_LOCALE=NL')
        expect(after.replace('ACCOUNT_1_LANG_CODE=nl\n', '').replace('ACCOUNT_1_GEO_LOCALE=NL\n', '')).toBe(
            before
        )
        expect(backups(r)).toHaveLength(1)
    })

    it('saving an account without changing anything still keeps the file identical', async () => {
        const r = await ready()
        const before = fileText(r)
        const res = await r.accounts.update(
            2,
            'beta@example.com',
            form({
                email: 'beta@example.com',
                proxyUrl: 'http://proxy.example.com',
                proxyPort: '8080'
            })
        )
        expect(res.ok).toBe(true)
        expect(fileText(r)).toBe(before)
    })

    it('can set a new password, clear the 2FA secret, and remove the proxy', async () => {
        const r = await ready()
        expect(
            (
                await r.accounts.update(
                    1,
                    'alpha@example.com',
                    form({ email: 'alpha@example.com', password: 'brand-new-pw', clearTotp: true })
                )
            ).ok
        ).toBe(true)
        expect((await r.accounts.update(2, 'beta@example.com', form({ email: 'beta@example.com' }))).ok).toBe(
            true
        )
        const text = fileText(r)
        expect(text).toContain('ACCOUNT_1_PASSWORD=brand-new-pw')
        expect(text).not.toContain('ACCOUNT_1_TOTP_SECRET')
        expect(text).not.toContain('ACCOUNT_2_PROXY')
        const s = await r.accounts.getState()
        expect(s.accounts[0]).toMatchObject({ hasPassword: true, hasTotp: false })
        expect(s.accounts[1]?.proxy).toBeNull()
        expect(text).toContain('UNRELATED_SETTING=must-not-be-forwarded')
    })

    it('changing the e-mail says that the saved session does not move; duplicate e-mail is refused', async () => {
        const r = await ready()
        const res = await r.accounts.update(1, 'alpha@example.com', form({ email: 'alpha2@example.com' }))
        expect(res.ok).toBe(true)
        expect(res.message).toMatch(/saved sessions per e-mail/)
        const dup = await r.accounts.update(
            2,
            'beta@example.com',
            form({ email: 'alpha2@example.com', proxyUrl: 'http://proxy.example.com', proxyPort: '8080' })
        )
        expect(dup).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    })

    it('a stale list is refused: the slot holds a different account now', async () => {
        const r = await ready()
        const before = fileText(r)
        const res = await r.accounts.update(1, 'someone-else@example.com', form({ email: 'x@example.com' }))
        expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' })
        expect(
            await r.accounts.update(9, 'alpha@example.com', form({ email: 'x@example.com' }))
        ).toMatchObject({ ok: false, code: 'NOT_FOUND' })
        expect(fileText(r)).toBe(before)
        expect(backups(r)).toHaveLength(0)
    })
})

describe('Accounts: remove', () => {
    it('removes one account (and its header); the rest of the file stays; sessions are not deleted', async () => {
        const r = await ready()
        const sessions = join(r.h.fx.engineRoot, 'sessions', 'beta@example.com')
        mkdirSync(sessions, { recursive: true })
        writeFileSync(join(sessions, 'session.json'), '{}')
        const res = await r.accounts.remove(2, 'beta@example.com')
        expect(res.ok).toBe(true)
        const text = fileText(r)
        expect(text).not.toContain('ACCOUNT_2_')
        expect(text).toContain('ACCOUNT_1_EMAIL=alpha@example.com')
        expect(text).toContain('UNRELATED_SETTING=must-not-be-forwarded')
        expect(existsSync(join(sessions, 'session.json'))).toBe(true)
        expect(backups(r)).toHaveLength(1)
        await expectEngineCount(r, 1)
        expect(r.h.farmer.getState().accounts.count).toBe(1)
    })

    it('refuses a stale list entry', async () => {
        const r = await ready()
        const before = fileText(r)
        expect(await r.accounts.remove(2, 'alpha@example.com')).toMatchObject({
            ok: false,
            code: 'NOT_FOUND'
        })
        expect(await r.accounts.remove('2', 'beta@example.com')).toMatchObject({
            ok: false,
            code: 'BAD_REQUEST'
        })
        expect(fileText(r)).toBe(before)
    })

    it('removing the last account is allowed, stops the engine (no run with old accounts) and Add recovers', async () => {
        const r = await ready()
        expect((await r.accounts.remove(1, 'alpha@example.com')).ok).toBe(true)
        const last = await r.accounts.remove(2, 'beta@example.com')
        expect(last.ok).toBe(true)
        expect(last.message).toMatch(/no account left/)
        const st = r.h.farmer.getState()
        expect(st.accounts.status).toBe('error')
        expect(st.engine.link).toBe('not-started')
        expect(st.startDisabledReason).toMatch(/No account found/)
        expect(r.h.supervisor.api).toBeNull()
        expect((await r.accounts.getState()).accounts).toEqual([])

        expect((await r.accounts.add(form({ email: 'again@example.com' }))).ok).toBe(true)
        await waitFor(
            () => r.h.farmer.getState().engine.link,
            (v) => v === 'ready',
            'engine ready again'
        )
        expect(r.h.farmer.getState().accounts.status).toBe('ok')
        expect(backups(r)).toHaveLength(3)
    })
})

describe('Accounts: guards', () => {
    it('during a run Add / Edit / Remove are refused, with the reason, and the file is untouched', async () => {
        const r = await ready()
        expect((await r.h.farmer.startRun()).ok).toBe(true)
        await waitFor(
            () => r.h.farmer.getState().run.phase,
            (v) => v === 'running',
            'running'
        )
        const before = fileText(r)
        const s = await r.accounts.getState()
        expect(s.editDisabledReason).toMatch(/run is active/)
        expect(await r.accounts.add(form({ email: 'late@example.com' }))).toMatchObject({
            ok: false,
            code: 'RUN_ACTIVE'
        })
        expect(
            await r.accounts.update(1, 'alpha@example.com', form({ email: 'alpha@example.com' }))
        ).toMatchObject({ ok: false, code: 'RUN_ACTIVE' })
        expect(await r.accounts.remove(1, 'alpha@example.com')).toMatchObject({
            ok: false,
            code: 'RUN_ACTIVE'
        })
        expect(fileText(r)).toBe(before)
        expect(backups(r)).toHaveLength(0)
        expect((await r.h.farmer.stopRun()).ok).toBe(true)
        await waitFor(
            () => r.h.farmer.getState().run.phase,
            (v) => v === 'idle',
            'idle'
        )
        expect((await r.accounts.getState()).editDisabledReason).toBeNull()
    })

    it('Start is refused while an account change is in progress', async () => {
        const r = await ready()
        let startDuring: unknown = null
        r.hook = () => {
            // runs inside the change, after the engine was marked busy
            void r.h.farmer.startRun().then((x) => {
                startDuring = x
            })
        }
        const res = await r.accounts.add(form({ email: 'busy@example.com' }))
        expect(res.ok).toBe(true)
        await waitFor(
            () => startDuring,
            (v) => v !== null,
            'start answer'
        )
        expect(startDuring).toMatchObject({ ok: false, code: 'RUN_ACTIVE' })
    })

    it('a file changed by another program in the middle of a change is NOT overwritten', async () => {
        const r = await ready()
        const outside = `${FAKE_ACCOUNTS_ENV}# edited by hand\nACCOUNT_9_EMAIL=hand@example.com\n`
        r.hook = () => writeFileSync(r.h.fx.accountsFile, outside)
        const res = await r.accounts.add(form({ email: 'late@example.com' }))
        expect(res).toMatchObject({ ok: false, code: 'WRITE_FAILED' })
        expect(res.message).toMatch(/changed on disk/)
        expect(fileText(r)).toBe(outside)
    })

    it('when the backup cannot be made nothing is changed', async () => {
        const h0 = makeHarness()
        harnesses.push(h0)
        const blocker = join(h0.fx.dir, 'not-a-folder')
        writeFileSync(blocker, 'file where the backup folder should be')
        const r = await rig({ fixture: h0.fx }, join(blocker, 'accounts'))
        await r.h.farmer.pickAccounts()
        const before = fileText(r)
        const res = await r.accounts.add(form({ email: 'nb@example.com' }))
        expect(res).toMatchObject({ ok: false, code: 'WRITE_FAILED' })
        expect(res.message).toMatch(/Backup failed/)
        expect(fileText(r)).toBe(before)
    })

    it('Windows line endings, a BOM and the file mode survive an edit', async () => {
        const r = await ready()
        const crlf = `\uFEFF# top\r\n${FAKE_ACCOUNTS_ENV.replace(/\n/g, '\r\n')}`
        writeFileSync(r.h.fx.accountsFile, crlf, { mode: 0o640 })
        const modeBefore = statSync(r.h.fx.accountsFile).mode & 0o777
        const res = await r.accounts.update(
            1,
            'alpha@example.com',
            form({ email: 'alpha@example.com', langCode: 'it' })
        )
        expect(res.ok).toBe(true)
        const after = fileText(r)
        expect(after.startsWith('\uFEFF# top\r\n')).toBe(true)
        expect(after.replace(/\r\n/g, '')).not.toContain('\n')
        expect(after).toContain('ACCOUNT_1_LANG_CODE=it\r\n')
        if (process.platform !== 'win32') expect(statSync(r.h.fx.accountsFile).mode & 0o777).toBe(modeBefore)
        expect(readdirSync(r.h.fx.dir).filter((n) => n.includes('.tmp'))).toEqual([])
    })

    it('no temp file is left next to the accounts file after a change', async () => {
        const r = await ready()
        await r.accounts.add(form({ email: 'tidy@example.com' }))
        expect(readdirSync(r.h.fx.dir).filter((n) => n.includes('.rf-'))).toEqual([])
    })
})

describe('Accounts: logs and secrets', () => {
    it('audit log records who/what/result with the e-mail, but no password, 2FA secret or proxy password', async () => {
        const r = await ready()
        await r.accounts.add(
            form({
                email: 'logged@example.com',
                password: 'LOGGED-PW-4455',
                totpSecret: 'LOGGEDTOTP234567',
                recoveryEmail: 'recover-me@example.com',
                proxyUrl: 'http://px.example.com',
                proxyPort: '8080',
                proxyUsername: 'logged-proxy-user',
                proxyPassword: 'logged-proxy-pass'
            })
        )
        await r.accounts.update(
            1,
            'alpha@example.com',
            form({ email: 'alpha@example.com', password: 'UPDATED-PW-9911' })
        )
        await r.accounts.remove(2, 'beta@example.com')
        await r.h.audit.flush()
        await r.h.appLog.flush()
        const audit = readLog(r.h, 'audit.log')
        expect(audit).toContain('"action":"account-add"')
        expect(audit).toContain('"action":"account-update"')
        expect(audit).toContain('"action":"account-remove"')
        expect(audit).toContain('logged@example.com')
        const all = audit + readLog(r.h, 'app.log')
        for (const secret of [
            'LOGGED-PW-4455',
            'LOGGEDTOTP234567',
            'recover-me@example.com',
            'logged-proxy-user',
            'logged-proxy-pass',
            'UPDATED-PW-9911',
            FAKE_PASSWORD,
            FAKE_TOTP
        ]) {
            expect(all).not.toContain(secret)
        }
    })

    it('refused changes are audited as warnings too', async () => {
        const r = await ready()
        await r.accounts.update(1, 'nobody@example.com', form({ email: 'x@example.com' }))
        await r.h.audit.flush()
        expect(readLog(r.h, 'audit.log')).toContain('"result":"NOT_FOUND"')
    })
})

describe('parseAccountInput', () => {
    it('accepts the exact shape, fills missing fields, rejects wrong types and non-objects', () => {
        expect(parseAccountInput({ email: 'a@example.com' })).toMatchObject({
            email: 'a@example.com',
            clearPassword: false,
            proxyPort: ''
        })
        expect(parseAccountInput({ email: 1 })).toBeNull()
        expect(parseAccountInput({ email: 'a@example.com', clearTotp: 'yes' })).toBeNull()
        expect(parseAccountInput(null)).toBeNull()
        expect(parseAccountInput([])).toBeNull()
        expect(parseAccountInput({ email: 'a'.repeat(5000) })).toBeNull()
    })
})
