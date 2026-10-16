// @vitest-environment node
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_ACCOUNT_INPUT } from '../../src/shared/accounts-types'
import { AccountsService } from '../../src/main/accounts'
import { DEFAULT_ACCOUNTS_TEXT } from '../../src/main/farmer'
import { FAKE_ACCOUNTS_ENV, makeFixture, makeHarness, readLog, waitFor } from './helpers'
import type { Harness } from './helpers'

// Phase 15 follow-up: the app creates its own accounts file (.env) on first use. Real files, real engine API (unmodified
// upstream scripts in a temp dir), only the bot entry is a fixture. Every account here is FAKE and lives in a temp dir.

const harnesses: Harness[] = []
afterEach(async () => {
    while (harnesses.length > 0) await harnesses.pop()?.cleanup()
})

function make() {
    const fixture = makeFixture()
    const own = join(fixture.userData, 'accounts.env')
    const h = makeHarness({ fixture, defaultAccountsPath: own })
    harnesses.push(h)
    return { h, own }
}

describe('accounts file is created by the app', () => {
    it('first start: creates accounts.env with no account in it, remembers it, does not start the engine', async () => {
        const { h, own } = make()
        expect(existsSync(own)).toBe(false)
        await h.farmer.init()
        expect(existsSync(own)).toBe(true)
        const text = readFileSync(own, 'utf8')
        expect(text).toBe(DEFAULT_ACCOUNTS_TEXT)
        // rule 3: no fake account, no fake value
        expect(text).not.toMatch(/^\s*ACCOUNT_\d+_/m)
        expect(text).not.toContain('example.com')
        if (process.platform !== 'win32') expect(statSync(own).mode & 0o077).toBe(0)
        expect(h.settings.value.accountsPath).toBe(own)
        const s = h.farmer.getState()
        expect(s.accounts).toMatchObject({ path: own, status: 'ok', error: null, count: 0 })
        expect(s.engine.link).toBe('not-started')
        expect(s.startDisabledReason).toBe('Add your first account on the Accounts page.')
        expect(s.notices.some((n) => n.id === 'accounts')).toBe(false)
        await h.audit.flush()
        expect(readLog(h, 'audit.log')).toContain('accounts-auto-create')
    })

    it('adding the first account on the Accounts page makes the file valid and the engine starts with it', async () => {
        const { h, own } = make()
        await h.farmer.init()
        const accounts = new AccountsService({
            host: {
                accountsPath: () => h.farmer.accountsPath(),
                editBlock: () => h.farmer.accountsEditBlock(),
                editAccounts: (work) => h.farmer.editAccounts(work)
            },
            redactor: h.redactor,
            audit: h.audit,
            appLog: h.appLog,
            backupDir: join(h.fx.userData, 'backups', 'accounts')
        })
        expect((await accounts.getState()).status).toBe('ok')
        expect((await accounts.getState()).accounts).toHaveLength(0)
        const res = await accounts.add({
            ...EMPTY_ACCOUNT_INPUT,
            email: 'first@example.com',
            password: 'fake-pw-only-test'
        })
        expect(res.ok).toBe(true)
        await waitFor(
            () => h.farmer.getState(),
            (s) => s.engine.link === 'ready' && s.accounts.count === 1,
            'engine ready with 1 account'
        )
        expect(h.farmer.getState().startDisabledReason).toBeNull()
        expect(readFileSync(own, 'utf8')).toContain('ACCOUNT_1_EMAIL=first@example.com')
        // the header comments are still there (the app never rewrites what it did not change)
        expect(readFileSync(own, 'utf8')).toContain('The app created this file for you')
    })

    it('rule 10: a file that is already there is NEVER overwritten; it is used as it is', async () => {
        const fixture = makeFixture()
        const own = join(fixture.userData, 'accounts.env')
        writeFileSync(own, FAKE_ACCOUNTS_ENV)
        const h = makeHarness({ fixture, defaultAccountsPath: own })
        harnesses.push(h)
        await h.farmer.init()
        expect(readFileSync(own, 'utf8')).toBe(FAKE_ACCOUNTS_ENV)
        expect(h.farmer.getState().accounts).toMatchObject({ path: own, status: 'ok', count: 2 })
        await waitFor(
            () => h.farmer.getState().engine.link,
            (v) => v === 'ready',
            'engine ready'
        )
        await h.audit.flush()
        expect(readLog(h, 'audit.log')).toContain('Existing accounts file')
    })

    it('a path chosen before is kept: the app does not create a second file, and a deleted file is reported as before', async () => {
        const fixture = makeFixture()
        const own = join(fixture.userData, 'accounts.env')
        const h = makeHarness({ fixture, defaultAccountsPath: own })
        harnesses.push(h)
        await h.settings.update({ accountsPath: fixture.accountsFile })
        await h.farmer.init()
        expect(existsSync(own)).toBe(false)
        expect(h.farmer.getState().accounts).toMatchObject({
            path: fixture.accountsFile,
            status: 'ok',
            count: 2
        })
        unlinkSync(fixture.accountsFile)
        await h.farmer.init()
        expect(existsSync(own)).toBe(false)
        expect(h.farmer.getState().accounts.status).toBe('error')
    })

    it('the app data folder cannot be written: nothing crashes, the old "choose a file" state stays, the reason is in the audit log', async () => {
        const fixture = makeFixture()
        // a FILE where the folder should be: mkdir fails for real
        const blocker = join(fixture.dir, 'blocker')
        writeFileSync(blocker, 'x')
        const h = makeHarness({ fixture, defaultAccountsPath: join(blocker, 'accounts.env') })
        harnesses.push(h)
        await h.farmer.init()
        expect(h.farmer.getState().accounts).toMatchObject({ path: null, status: 'not-set' })
        await h.audit.flush()
        expect(readLog(h, 'audit.log')).toContain('Could not create the accounts file')
    })
})
