// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { SetupWizardService } from '../../src/main/setupWizard'
import type { ActionResult } from '../../src/shared/farmer-types'
import type { HealthCheck, HealthState, HealthStatus } from '../../src/shared/health-types'
import { PREREQUISITE_IDS } from '../../src/shared/wizard-rules'
import type {
    AccountsStepResult,
    SettingsStepResult,
    WizardFinishResult,
    WizardHost
} from '../../src/shared/wizard-types'

// Phase 22 (first half): the wizard service. Real accounts files in a temp folder; health and the app's own setters are
// stand-ins (rule 18: tests only). Every account and secret is FAKE.

const FAKE_PASSWORD = 'fake-pw-Zx81-test-only'
const FAKE_TOTP = 'FAKETOTPSECRET234567'
const ACCOUNTS = [
    'ACCOUNT_1_EMAIL=alpha@example.com',
    `ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}`,
    `ACCOUNT_1_TOTP_SECRET=${FAKE_TOTP}`,
    'ACCOUNT_2_EMAIL=beta@example.com',
    `ACCOUNT_2_PASSWORD=${FAKE_PASSWORD}2`,
    ''
].join('\n')
const GOOD = { theme: 'light', headless: true, timerEnabled: true, timerTime: '07:45' }
const FIXED = () => new Date(2026, 9, 16, 9, 0, 0)

const dirs: string[] = []
const flushers: Array<() => Promise<void>> = []
afterEach(async () => {
    while (flushers.length > 0) await (flushers.pop() as () => Promise<void>)().catch(() => undefined)
    while (dirs.length > 0)
        rmSync(dirs.pop() as string, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const healthRow = (id: string, status: HealthStatus, detail = 'ok'): HealthCheck =>
    ({
        id,
        group: 'runtime',
        title: id,
        status,
        detail,
        fix: status === 'ok' ? null : 'Click Fix.',
        checkedAt: '2026-10-16T09:00:00.000Z'
    }) as HealthCheck

interface Rig {
    readonly dir: string
    readonly svc: SetupWizardService
    readonly build: (
        extra?: Partial<ConstructorParameters<typeof SetupWizardService>[0]>
    ) => SetupWizardService
    readonly host: { [K in keyof WizardHost]: ReturnType<typeof vi.fn> }
    readonly calls: string[]
    readonly state: {
        health: Record<string, HealthStatus>
        picked: string | null
        runBlock: string | null
        currentPath: string | null
    }
    readonly goodFile: string
    readonly defaultFile: string
    readonly markerPath: string
    readonly pick: ReturnType<typeof vi.fn>
    readonly logText: () => Promise<string>
}

function rig(): Rig {
    const dir = mkdtempSync(join(tmpdir(), 'rf-wizard-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'userData'), { recursive: true })
    const goodFile = join(dir, 'my-accounts.env')
    const defaultFile = join(dir, 'userData', 'accounts.env')
    const markerPath = join(dir, 'userData', 'setup-wizard.json')
    writeFileSync(goodFile, ACCOUNTS)
    const redactor = new Redactor()
    const redact = (t: string) => redactor.redact(t)
    const logs = join(dir, 'userData', 'logs')
    const audit = new JsonlLog(logs, 'audit.log', 'audit', redact)
    const appLog = new JsonlLog(logs, 'app.log', 'app', redact)
    flushers.push(async () => {
        await audit.flush()
        await appLog.flush()
    })
    const state: Rig['state'] = {
        health: Object.fromEntries(PREREQUISITE_IDS.map((id) => [id, 'ok' as HealthStatus])),
        picked: goodFile,
        runBlock: null,
        currentPath: null
    }
    const calls: string[] = []
    const ok = (name: string) =>
        vi.fn((...args: unknown[]): Promise<ActionResult> => {
            calls.push(`${name}(${args.map((a) => String(a)).join(',')})`)
            return Promise.resolve({ ok: true, message: 'done' })
        })
    const host = {
        useAccountsFile: ok('useAccountsFile'),
        setTimer: ok('setTimer'),
        setTheme: ok('setTheme'),
        setHeadless: ok('setHeadless')
    }
    const pick = vi.fn(() => Promise.resolve(state.picked))
    const build: Rig['build'] = (extra = {}) =>
        new SetupWizardService({
            health: {
                runChecks: (): Promise<HealthState> =>
                    Promise.resolve({
                        status: 'done',
                        checks: PREREQUISITE_IDS.map((id) =>
                            healthRow(
                                id,
                                state.health[id] ?? 'ok',
                                state.health[id] === 'error' ? 'It is broken.' : 'fine'
                            )
                        ),
                        startedAt: null,
                        finishedAt: '2026-10-16T09:00:00.000Z'
                    })
            },
            pickAccountsFile: pick,
            defaultAccountsPath: defaultFile,
            currentAccountsPath: () => state.currentPath,
            markerPath,
            host: host as unknown as WizardHost,
            runBlock: () => state.runBlock,
            redactor,
            audit,
            appLog,
            now: FIXED,
            ...extra
        })
    const logText = async (): Promise<string> => {
        await audit.flush()
        await appLog.flush()
        return ['audit.log', 'app.log']
            .map((n) => (existsSync(join(logs, n)) ? readFileSync(join(logs, n), 'utf8') : ''))
            .join('\n')
    }
    return { dir, svc: build(), build, host, calls, state, goodFile, defaultFile, markerPath, pick, logText }
}

async function toReview(r: Rig, svc = r.svc): Promise<void> {
    expect((await svc.checkPrerequisites()).canContinue).toBe(true)
    expect((await svc.chooseAccounts('pick')).ok).toBe(true)
    expect(svc.setBasicSettings(GOOD).ok).toBe(true)
}

const acc = (res: AccountsStepResult) => {
    if (!res.ok) throw new Error(`expected ok: ${res.message}`)
    return res
}
const fin = (res: WizardFinishResult) => {
    if (!res.ok) throw new Error(`expected ok: ${res.message}`)
    return res
}
const noCalls = (r: Rig) => expect(r.calls).toEqual([])

describe('step 1: prerequisites', () => {
    it('good computer: can continue, state moves to step 2', async () => {
        const r = rig()
        expect(r.svc.getState().furthestStep).toBe('prerequisites')
        const res = await r.svc.checkPrerequisites()
        expect(res.canContinue).toBe(true)
        expect(r.svc.getState().prerequisitesOk).toBe(true)
        expect(r.svc.getState().furthestStep).toBe('accounts')
    })
    it('a broken prerequisite blocks, names the row and gives a fix', async () => {
        const r = rig()
        r.state.health['engine-built'] = 'error'
        const res = await r.svc.checkPrerequisites()
        expect(res.canContinue).toBe(false)
        expect(res.blockers[0]).toContain('It is broken.')
        expect(res.rows.find((x) => x.id === 'engine-built')?.fix).not.toBeNull()
        expect(r.svc.getState().furthestStep).toBe('prerequisites')
    })
    it('when the computer check turns bad later, the later choices are asked again', async () => {
        const r = rig()
        await toReview(r)
        expect(r.svc.getState().furthestStep).toBe('review')
        r.state.health['node'] = 'error'
        await r.svc.checkPrerequisites()
        const s = r.svc.getState()
        expect(s.accounts).toBeNull()
        expect(s.settings).toBeNull()
        expect(s.furthestStep).toBe('prerequisites')
    })
})

describe('step 2: accounts location', () => {
    it('is locked until the computer check passes; nothing is opened', async () => {
        const r = rig()
        const res = await r.svc.chooseAccounts('pick')
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.stage).toBe('locked')
        expect(r.pick).not.toHaveBeenCalled()
    })
    for (const bad of [undefined, null, 'file', 'PICK', 1, {}, '../x']) {
        it(`refuses the source ${JSON.stringify(bad)} and opens no dialog`, async () => {
            const r = rig()
            await r.svc.checkPrerequisites()
            const res = await r.svc.chooseAccounts(bad)
            expect(res.ok).toBe(false)
            if (!res.ok) expect(res.stage).toBe('bad-request')
            expect(r.pick).not.toHaveBeenCalled()
        })
    }
    it('a good chosen file: counts its accounts, shows the name only, no secret and no folder', async () => {
        const r = rig()
        await r.svc.checkPrerequisites()
        const res = acc(await r.svc.chooseAccounts('pick'))
        expect(res.choice).toEqual({
            source: 'pick',
            fileName: 'my-accounts.env',
            accountCount: 2,
            willCreate: false
        })
        const dump = JSON.stringify([res, r.svc.getState()])
        for (const s of [FAKE_PASSWORD, FAKE_TOTP, 'alpha@example.com', r.dir]) expect(dump).not.toContain(s)
        expect(r.svc.getState().furthestStep).toBe('settings')
    })
    it('closing the dialog is not an error and changes nothing', async () => {
        const r = rig()
        await r.svc.checkPrerequisites()
        r.state.picked = null
        const res = await r.svc.chooseAccounts('pick')
        expect(res.ok).toBe(false)
        if (!res.ok) {
            expect(res.cancelled).toBe(true)
            expect(res.fix.length).toBeGreaterThan(10)
        }
        expect(r.svc.getState().accounts).toBeNull()
    })
    it('a dialog that throws is reported, not crashed', async () => {
        const r = rig()
        const svc = r.build({ pickAccountsFile: () => Promise.reject(new Error('boom')) })
        await svc.checkPrerequisites()
        const res = await svc.chooseAccounts('pick')
        expect(res.ok).toBe(false)
    })
    const badFiles: Array<[string, (r: Rig) => string]> = [
        ['a file that does not exist', (r) => join(r.dir, 'missing.env')],
        [
            'a file with the wrong name',
            (r) => {
                const p = join(r.dir, 'accounts.txt')
                writeFileSync(p, ACCOUNTS)
                return p
            }
        ],
        [
            'a file with no account in it',
            (r) => {
                const p = join(r.dir, 'empty.env')
                writeFileSync(p, '# nothing here\n')
                return p
            }
        ],
        ['a folder', (r) => r.dir],
        ['a relative path', () => 'accounts.env']
    ]
    for (const [label, make] of badFiles) {
        it(`refuses ${label} with a plain message and a fix; nothing is kept`, async () => {
            const r = rig()
            await r.svc.checkPrerequisites()
            r.state.picked = make(r)
            const res = await r.svc.chooseAccounts('pick')
            expect(res.ok).toBe(false)
            if (!res.ok) {
                expect(res.stage).toBe('invalid')
                expect(res.message.length).toBeGreaterThan(10)
                expect(res.fix.length).toBeGreaterThan(10)
            }
            expect(r.svc.getState().accounts).toBeNull()
        })
    }
    it("the app's own file that is not there yet will be created at the end (no file is made now)", async () => {
        const r = rig()
        await r.svc.checkPrerequisites()
        const res = acc(await r.svc.chooseAccounts('default'))
        expect(res.choice).toMatchObject({
            source: 'default',
            fileName: 'accounts.env',
            accountCount: 0,
            willCreate: true
        })
        expect(res.warnings.join(' ')).toMatch(/created empty/)
        expect(existsSync(r.defaultFile)).toBe(false)
    })
    it("the app's own file with no account yet is accepted with a warning", async () => {
        const r = rig()
        writeFileSync(r.defaultFile, '# no accounts yet\n')
        await r.svc.checkPrerequisites()
        const res = acc(await r.svc.chooseAccounts('default'))
        expect(res.choice.accountCount).toBe(0)
        expect(res.choice.willCreate).toBe(false)
        expect(res.warnings.join(' ')).toMatch(/no account yet/)
    })
    it('is refused while a run is active', async () => {
        const r = rig()
        await r.svc.checkPrerequisites()
        r.state.runBlock = 'A run is active.'
        const res = await r.svc.chooseAccounts('pick')
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.stage).toBe('blocked')
        expect(r.pick).not.toHaveBeenCalled()
    })
    it('a bad file after a good one keeps the earlier good choice', async () => {
        const r = rig()
        await r.svc.checkPrerequisites()
        acc(await r.svc.chooseAccounts('pick'))
        r.state.picked = join(r.dir, 'missing.env')
        expect((await r.svc.chooseAccounts('pick')).ok).toBe(false)
        expect(r.svc.getState().accounts?.fileName).toBe('my-accounts.env')
    })
})

describe('step 3: basic settings', () => {
    it('is locked until the accounts file is chosen', () => {
        const r = rig()
        const res = r.svc.setBasicSettings(GOOD)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.stage).toBe('locked')
    })
    const bad: Array<[string, unknown, string]> = [
        ['a theme that does not exist', { ...GOOD, theme: 'blue' }, 'theme'],
        ['headless as text', { ...GOOD, headless: 'yes' }, 'headless'],
        ['a timer flag as a number', { ...GOOD, timerEnabled: 1 }, 'timerEnabled'],
        ['a bad time', { ...GOOD, timerTime: '25:99' }, 'timerTime'],
        ['not an object', 'settings', 'theme'],
        ['null', null, 'theme']
    ]
    for (const [label, input, field] of bad) {
        it(`refuses ${label}: names ${field}, keeps nothing`, async () => {
            const r = rig()
            await r.svc.checkPrerequisites()
            await r.svc.chooseAccounts('pick')
            const res: SettingsStepResult = r.svc.setBasicSettings(input)
            expect(res.ok).toBe(false)
            if (!res.ok) {
                expect(Object.keys(res.errors)).toContain(field)
                expect(res.fix.length).toBeGreaterThan(10)
            }
            expect(r.svc.getState().settings).toBeNull()
        })
    }
    it('a good set is kept, and a wrong set later does not remove it', async () => {
        const r = rig()
        await r.svc.checkPrerequisites()
        await r.svc.chooseAccounts('pick')
        expect(r.svc.setBasicSettings(GOOD).ok).toBe(true)
        expect(r.svc.setBasicSettings({ ...GOOD, timerTime: 'x' }).ok).toBe(false)
        expect(r.svc.getState().settings).toEqual(GOOD)
        expect(r.svc.getState().furthestStep).toBe('review')
    })
})

describe('step 4: review', () => {
    it('is not ready before the earlier steps', async () => {
        const r = rig()
        const res = r.svc.review()
        expect(res.ok).toBe(false)
        await r.svc.checkPrerequisites()
        expect(r.svc.review().ok).toBe(false)
    })
    it('lists what will be set, without secret or folder', async () => {
        const r = rig()
        await toReview(r)
        const res = r.svc.review()
        expect(res.ok).toBe(true)
        if (res.ok) {
            expect(res.review.lines.map((l) => l.value).join(' | ')).toContain('my-accounts.env (2 accounts)')
            expect(JSON.stringify(res)).not.toContain(r.dir)
            expect(JSON.stringify(res)).not.toContain('alpha@example.com')
        }
        noCalls(r)
    })
})

describe('finish', () => {
    const notYes: Array<[string, unknown]> = [
        ['false', false],
        ['undefined', undefined],
        ['null', null],
        ['"true"', 'true'],
        ['1', 1],
        ['an object', {}]
    ]
    for (const [label, v] of notYes) {
        it(`confirmed = ${label}: nothing is changed, no marker`, async () => {
            const r = rig()
            await toReview(r)
            const res = await r.svc.finish(v)
            expect(res.ok).toBe(false)
            if (!res.ok) {
                expect(res.stage).toBe('not-confirmed')
                expect(res.doneSteps).toEqual([])
            }
            noCalls(r)
            expect(existsSync(r.markerPath)).toBe(false)
        })
    }
    it('before the steps are done: not ready, nothing is changed', async () => {
        const r = rig()
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.stage).toBe('not-ready')
        noCalls(r)
    })
    it('happy path: applies each choice in order, writes the marker, is no longer a first run', async () => {
        const r = rig()
        expect(await r.svc.isFirstRun()).toBe(true)
        await toReview(r)
        const res = fin(await r.svc.finish(true))
        expect(res.doneSteps).toEqual(['accounts-file', 'timer', 'theme', 'headless'])
        expect(r.calls).toEqual([
            `useAccountsFile(${r.goodFile})`,
            'setTimer(true,07:45)',
            'setTheme(light)',
            'setHeadless(true)'
        ])
        expect(r.svc.getState().completed).toBe(true)
        const marker = readFileSync(r.markerPath, 'utf8')
        expect(JSON.parse(marker)).toMatchObject({ format: 'rewards-farmer-setup-wizard' })
        for (const s of [FAKE_PASSWORD, FAKE_TOTP, 'alpha@example.com', r.dir])
            expect(marker).not.toContain(s)
        expect(await r.svc.isFirstRun()).toBe(false)
        expect(res.notes).toEqual([])
    })
    it("the app's own file that did not exist is handed to the app, which creates it", async () => {
        const r = rig()
        await r.svc.checkPrerequisites()
        await r.svc.chooseAccounts('default')
        r.svc.setBasicSettings({ ...GOOD, timerEnabled: false })
        fin(await r.svc.finish(true))
        expect(r.calls[0]).toBe(`useAccountsFile(${r.defaultFile})`)
        expect(r.calls[1]).toBe('setTimer(false,07:45)')
    })
    it('is refused while a run is active; nothing is changed', async () => {
        const r = rig()
        await toReview(r)
        r.state.runBlock = 'A run is active.'
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.stage).toBe('blocked')
        noCalls(r)
    })
    it('the accounts file was deleted after it was chosen: refused, nothing applied', async () => {
        const r = rig()
        await toReview(r)
        rmSync(r.goodFile)
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        if (!res.ok) {
            expect(res.stage).toBe('invalid')
            expect(res.message).toMatch(/Nothing was changed/)
        }
        noCalls(r)
        expect(existsSync(r.markerPath)).toBe(false)
        expect(r.svc.getState().furthestStep).toBe('accounts')
    })
    it('the accounts file lost all its accounts after it was chosen: refused', async () => {
        const r = rig()
        await toReview(r)
        writeFileSync(r.goodFile, '# emptied\n')
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        noCalls(r)
    })
    it('the computer check fails at the end: refused, nothing applied', async () => {
        const r = rig()
        await toReview(r)
        r.state.health['engine-packages'] = 'error'
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.stage).toBe('not-ready')
        noCalls(r)
    })
    it('a step that fails stops there, says which steps were done, writes no marker, and the wizard can run again', async () => {
        const r = rig()
        await toReview(r)
        r.host.setTheme.mockImplementationOnce(() =>
            Promise.resolve({ ok: false, message: 'Settings file is locked.' })
        )
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        if (!res.ok) {
            expect(res.stage).toBe('apply-failed')
            expect(res.doneSteps).toEqual(['accounts-file', 'timer'])
            expect(res.message).toContain('Settings file is locked.')
            expect(res.message).toContain('accounts-file, timer')
            expect(res.fix.length).toBeGreaterThan(10)
        }
        expect(r.host.setHeadless).not.toHaveBeenCalled()
        expect(existsSync(r.markerPath)).toBe(false)
        expect(r.svc.getState().completed).toBe(false)
        expect(await r.svc.isFirstRun()).toBe(true)
        // run again: works
        fin(await r.svc.finish(true))
        expect(existsSync(r.markerPath)).toBe(true)
    })
    it('the first step failing says that no setting was changed', async () => {
        const r = rig()
        await toReview(r)
        r.host.useAccountsFile.mockImplementationOnce(() =>
            Promise.resolve({ ok: false, message: 'Engine did not start.' })
        )
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        if (!res.ok) {
            expect(res.doneSteps).toEqual([])
            expect(res.message).toMatch(/No setting was changed/)
        }
    })
    it('a step that throws is a failed step, not a crash', async () => {
        const r = rig()
        await toReview(r)
        r.host.setTimer.mockImplementationOnce(() => Promise.reject(new Error('disk gone')))
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.doneSteps).toEqual(['accounts-file'])
    })
    it('an error message that holds a secret is redacted before it is shown', async () => {
        const r = rig()
        const redactor = new Redactor()
        redactor.add(FAKE_PASSWORD)
        const svc = r.build({ redactor })
        await toReview(r, svc)
        r.host.setTheme.mockImplementationOnce(() =>
            Promise.resolve({ ok: false, message: `bad value ${FAKE_PASSWORD}` })
        )
        const res = await svc.finish(true)
        expect(JSON.stringify(res)).not.toContain(FAKE_PASSWORD)
    })
    it('if the marker cannot be written, the choices stay applied and a note says so', async () => {
        const r = rig()
        const blocked = join(r.dir, 'blocked')
        writeFileSync(blocked, 'a file where a folder must be')
        const svc = r.build({ markerPath: join(blocked, 'setup-wizard.json') })
        await toReview(r, svc)
        const res = fin(await svc.finish(true))
        expect(res.doneSteps).toHaveLength(4)
        expect(res.notes.join(' ')).toMatch(/may be offered again/)
    })
    it('two finishes at the same time run one after the other', async () => {
        const r = rig()
        await toReview(r)
        const [a, b] = await Promise.all([r.svc.finish(true), r.svc.finish(true)])
        expect(a.ok && b.ok).toBe(true)
        expect(r.calls).toHaveLength(8)
        expect(r.calls.slice(0, 4)).toEqual(r.calls.slice(4))
    })
})

describe('first run and reset', () => {
    it('an existing setup (accounts file already set) is not a first run', async () => {
        const r = rig()
        r.state.currentPath = r.goodFile
        expect(await r.svc.isFirstRun()).toBe(false)
    })
    it('reset starts again from step 1 and changes no file', async () => {
        const r = rig()
        await toReview(r)
        const s = r.svc.reset()
        expect(s).toMatchObject({ prerequisitesOk: false, accounts: null, settings: null, completed: false })
        expect(s.furthestStep).toBe('prerequisites')
        noCalls(r)
    })
})

describe('secrets never leave the main process', () => {
    it('no result and no log line holds a password, a TOTP secret, an e-mail or a folder', async () => {
        const r = rig()
        const results: unknown[] = []
        results.push(await r.svc.checkPrerequisites())
        results.push(await r.svc.chooseAccounts('pick'))
        results.push(r.svc.setBasicSettings(GOOD))
        results.push(r.svc.setBasicSettings({ ...GOOD, timerTime: 'x' }))
        results.push(r.svc.review())
        results.push(await r.svc.finish(false))
        results.push(await r.svc.finish(true))
        results.push(r.svc.getState())
        const dump = JSON.stringify(results) + (await r.logText())
        for (const s of [FAKE_PASSWORD, FAKE_TOTP, 'alpha@example.com', 'beta@example.com', r.dir]) {
            expect(dump.includes(s)).toBe(false)
        }
        const log = await r.logText()
        expect(log).toMatch(/wizard-finished/)
        expect(log).toMatch(/wizard-accounts-chosen/)
    })
})

// ---- Phase 22, second half: first-run detection at start and the browser window setting when the engine is not running ----

describe('first-run detection at start (before the app makes its own accounts file)', () => {
    it('a fresh start: detected once, the wizard is offered, and it stays offered even after the app makes its own file', async () => {
        const r = rig()
        expect(r.svc.needsWizard()).toBe(false) // nothing detected yet
        expect(await r.svc.detectFirstRun()).toBe(true)
        expect(r.svc.needsWizard()).toBe(true)
        // The app now creates its own accounts file and remembers its path (this is what FarmerService.init does).
        r.state.currentPath = r.defaultFile
        expect(await r.svc.isFirstRun()).toBe(false) // a live check would now say "used app"
        expect(r.svc.needsWizard()).toBe(true) // the answer taken at start is kept for this session
    })
    it('an app that was set up before is not pushed into the wizard', async () => {
        const r = rig()
        r.state.currentPath = r.goodFile
        expect(await r.svc.detectFirstRun()).toBe(false)
        expect(r.svc.needsWizard()).toBe(false)
    })
    it('an app whose wizard finished before is not pushed into the wizard', async () => {
        const r = rig()
        await toReview(r)
        fin(await r.svc.finish(true))
        const next = r.build() // the next start: same marker file, a fresh service
        expect(await next.detectFirstRun()).toBe(false)
        expect(next.needsWizard()).toBe(false)
    })
    it('after Finish the wizard is no longer offered in this session', async () => {
        const r = rig()
        await r.svc.detectFirstRun()
        expect(r.svc.needsWizard()).toBe(true)
        await toReview(r)
        fin(await r.svc.finish(true))
        expect(r.svc.needsWizard()).toBe(false)
    })
    it('leaving the wizard (reset) changes no file and does not write the marker', async () => {
        const r = rig()
        await r.svc.detectFirstRun()
        await toReview(r)
        r.svc.reset()
        noCalls(r)
        expect(existsSync(r.markerPath)).toBe(false)
        expect(r.svc.needsWizard()).toBe(true)
    })
})

describe('the browser window setting when the engine is not running', () => {
    const engineDown = (code: 'ENGINE_DOWN' | 'CONFIG_MISSING'): ActionResult => ({
        ok: false,
        code,
        message: 'The engine is not running.'
    })
    for (const code of ['ENGINE_DOWN', 'CONFIG_MISSING'] as const) {
        it(`${code}: the wizard still finishes, says honestly that the setting was NOT saved, and does not list it as done`, async () => {
            const r = rig()
            r.host.setHeadless.mockImplementationOnce(() => Promise.resolve(engineDown(code)))
            await toReview(r)
            const res = fin(await r.svc.finish(true))
            expect(res.doneSteps).toEqual(['accounts-file', 'timer', 'theme'])
            expect(res.notes.join(' ')).toMatch(/NOT saved/)
            expect(res.notes.join(' ')).toMatch(/Settings page/)
            expect(existsSync(r.markerPath)).toBe(true)
            expect(JSON.parse(readFileSync(r.markerPath, 'utf8')).steps).toEqual([
                'accounts-file',
                'timer',
                'theme'
            ])
        })
    }
    it('any OTHER failure of that step still stops the wizard and writes no marker', async () => {
        const r = rig()
        r.host.setHeadless.mockImplementationOnce(() =>
            Promise.resolve({ ok: false, code: 'WRITE_FAILED', message: 'Disk full.' } as ActionResult)
        )
        await toReview(r)
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        if (!res.ok) {
            expect(res.stage).toBe('apply-failed')
            expect(res.doneSteps).toEqual(['accounts-file', 'timer', 'theme'])
        }
        expect(existsSync(r.markerPath)).toBe(false)
    })
    it('a failure without a code (a plain message) is not treated as "engine not running"', async () => {
        const r = rig()
        r.host.setHeadless.mockImplementationOnce(() =>
            Promise.resolve({ ok: false, message: 'The engine is not running.' } as ActionResult)
        )
        await toReview(r)
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
    })
    it('the same code on another step (the accounts file) is NOT softened', async () => {
        const r = rig()
        r.host.useAccountsFile.mockImplementationOnce(() => Promise.resolve(engineDown('ENGINE_DOWN')))
        await toReview(r)
        const res = await r.svc.finish(true)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.doneSteps).toEqual([])
    })
})
