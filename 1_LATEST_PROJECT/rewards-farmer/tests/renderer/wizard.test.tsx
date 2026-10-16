import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { SetupWizardService } from '../../src/main/setupWizard'
import type { FarmerShellApi } from '../../src/shared/ipc-types'
import type { HealthCheck, HealthState } from '../../src/shared/health-types'
import { FINISH_CONFIRM_TEXT, PREREQUISITE_IDS } from '../../src/shared/wizard-rules'
import type {
    AccountsStepResult,
    PrerequisitesResult,
    SettingsStepResult,
    WizardFinishResult,
    WizardHost,
    WizardReviewResult
} from '../../src/shared/wizard-types'
import { installBridge } from '../helpers/notifyBridge'

// Phase 22: the setup wizard screens. First with a stand-in bridge (rule 18), then with the REAL SetupWizardService on real
// accounts files in a temp folder (the app's own setters are stand-ins). Every account and secret is FAKE.

const T = '2026-10-16T09:00:00.000Z'
const rows = (bad?: string): PrerequisitesResult => {
    const list = PREREQUISITE_IDS.map((id) => ({
        id,
        title: `Row ${id}`,
        status: id === bad ? ('error' as const) : ('ok' as const),
        detail: id === bad ? `Detail of ${id} is broken.` : `Detail of ${id}.`,
        fix: id === bad ? 'Double-click Fix.bat.' : null
    }))
    const blockers = bad === undefined ? [] : [`Row ${bad}: Detail of ${bad} is broken.`]
    return { rows: list, canContinue: bad === undefined, blockers, checkedAt: T }
}
const accountsOk = (count = 2, name = 'my-accounts.env'): AccountsStepResult => ({
    ok: true,
    choice: { source: 'pick', fileName: name, accountCount: count, willCreate: false },
    warnings: []
})
const refusal = (message: string, fix: string, cancelled = false) =>
    ({ ok: false, stage: 'invalid', message, fix, cancelled }) as const
const review: WizardReviewResult = {
    ok: true,
    review: {
        lines: [
            { label: 'Accounts file', value: 'my-accounts.env (2 accounts)' },
            { label: 'Theme', value: 'Light' },
            { label: 'Browser window', value: 'Hidden (headless)' },
            { label: 'Daily timer', value: 'On, every day at 07:45' }
        ],
        warnings: ['The timer starts a run every day at 07:45 only while this app is open.'],
        canFinish: true
    }
}
const finished: WizardFinishResult = {
    ok: true,
    message: 'Setup finished: 4 step(s) applied and checked.',
    finishedAt: T,
    doneSteps: ['accounts-file', 'timer', 'theme', 'headless'],
    notes: []
}

type Over = Partial<FarmerShellApi>
function standIn(over: Over = {}): Over {
    return {
        wizardIsFirstRun: () => Promise.resolve(true),
        wizardCheckPrerequisites: () => Promise.resolve(rows()),
        wizardChooseAccounts: () => Promise.resolve(accountsOk()),
        wizardSetSettings: (s) => Promise.resolve<SettingsStepResult>({ ok: true, settings: s }),
        wizardReview: () => Promise.resolve(review),
        wizardFinish: () => Promise.resolve(finished),
        ...over
    }
}

function open(over: Over = {}, hash = '#/home'): void {
    installBridge(standIn(over))
    window.location.hash = hash
    render(<App />)
}

type User = ReturnType<typeof userEvent.setup>
const next = (user: User) => user.click(screen.getByRole('button', { name: 'Next' }))

async function toAccounts(user: User): Promise<void> {
    await screen.findByText('This computer is ready. You can go to the next step.')
    await next(user)
    await screen.findByRole('heading', { name: 'Accounts file' })
}
async function toSettings(user: User): Promise<void> {
    await toAccounts(user)
    await user.click(screen.getByRole('button', { name: /^Choose a file/ }))
    await screen.findByText(/my-accounts\.env:/)
    await next(user)
    await screen.findByRole('heading', { name: 'Basic settings' })
}
async function toReview(user: User): Promise<void> {
    await toSettings(user)
    await next(user)
    await screen.findByRole('heading', { name: 'Review and finish' })
}

beforeEach(() => {
    window.location.hash = ''
})
afterEach(() => {
    vi.restoreAllMocks()
})

describe('opening', () => {
    it('opens by itself on a first run', async () => {
        open()
        expect(await screen.findByRole('heading', { name: 'Check this computer' })).toBeInTheDocument()
    })
    it('does not open when it is not the first run', async () => {
        open({ wizardIsFirstRun: () => Promise.resolve(false) })
        await waitFor(() =>
            expect(screen.queryByRole('heading', { name: 'Check this computer' })).not.toBeInTheDocument()
        )
        expect(window.location.hash).not.toBe('#/setup')
    })
    it('a failing first-run question leaves the app on Home', async () => {
        open({ wizardIsFirstRun: () => Promise.reject(new Error('channel closed')) })
        await new Promise((r) => setTimeout(r, 50))
        expect(screen.queryByRole('heading', { name: 'Check this computer' })).not.toBeInTheDocument()
    })
    it('can be opened by hand at #/setup', async () => {
        open({ wizardIsFirstRun: () => Promise.resolve(false) }, '#/setup')
        expect(await screen.findByRole('heading', { name: 'Check this computer' })).toBeInTheDocument()
    })
})

describe('step 1: computer check', () => {
    it('shows every row from the real check, and the green line when all is fine', async () => {
        open()
        for (const id of PREREQUISITE_IDS) expect(await screen.findByText(`Row ${id}`)).toBeInTheDocument()
        expect(screen.getByText('This computer is ready. You can go to the next step.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    })
    it('a problem row blocks Next, with the reason, the blocker and the fix on screen', async () => {
        open({ wizardCheckPrerequisites: () => Promise.resolve(rows('engine-built')) })
        expect(await screen.findByText(/The wizard cannot go on yet\./)).toHaveTextContent(
            'Detail of engine-built is broken.'
        )
        expect(screen.getByText(/What to do: Double-click Fix\.bat\./)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
        expect(screen.getByLabelText('The computer check has to pass first.')).toBeInTheDocument()
    })
    it('Check again runs the check again and can turn the page green', async () => {
        const user = userEvent.setup()
        const check = vi
            .fn<() => Promise<PrerequisitesResult>>()
            .mockResolvedValueOnce(rows('node'))
            .mockResolvedValue(rows())
        open({ wizardCheckPrerequisites: check })
        await screen.findByText(/The wizard cannot go on yet\./)
        await user.click(screen.getByRole('button', { name: 'Check again' }))
        await screen.findByText('This computer is ready. You can go to the next step.')
        expect(check).toHaveBeenCalledTimes(2)
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    })
    it('a lost answer is shown with a retry, not a blank page', async () => {
        open({ wizardCheckPrerequisites: () => Promise.reject(new Error('channel closed')) })
        expect(await screen.findByText(/could not be done or its answer was lost/)).toBeInTheDocument()
        expect(screen.getByText(/Nothing was changed by this step/)).toBeInTheDocument()
    })
    it('"Not now" leaves for Home and writes nothing', async () => {
        const user = userEvent.setup()
        const finish = vi.fn()
        open({ wizardFinish: finish })
        await screen.findByRole('heading', { name: 'Check this computer' })
        await user.click(screen.getByRole('button', { name: 'Not now' }))
        await waitFor(() =>
            expect(screen.queryByRole('heading', { name: 'Check this computer' })).not.toBeInTheDocument()
        )
        expect(finish).not.toHaveBeenCalled()
    })
})

describe('step 2: accounts file', () => {
    it('Next is disabled until a file is chosen', async () => {
        const user = userEvent.setup()
        open()
        await toAccounts(user)
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
        expect(screen.getByLabelText('Choose the accounts file first.')).toBeInTheDocument()
    })
    it('the buttons send only the words default and pick', async () => {
        const user = userEvent.setup()
        const choose = vi.fn((s: 'default' | 'pick') => Promise.resolve(accountsOk(s === 'default' ? 0 : 2)))
        open({ wizardChooseAccounts: choose })
        await toAccounts(user)
        await user.click(screen.getByRole('button', { name: /^Use the app/ }))
        await screen.findByText(/0 accounts found/)
        await user.click(screen.getByRole('button', { name: /^Choose a file/ }))
        await screen.findByText(/2 accounts found/)
        expect(choose.mock.calls.map((c) => c[0])).toEqual(['default', 'pick'])
    })
    it('a good file shows its name and the number of accounts (singular for one)', async () => {
        const user = userEvent.setup()
        open({ wizardChooseAccounts: () => Promise.resolve(accountsOk(1, 'one.env')) })
        await toAccounts(user)
        await user.click(screen.getByRole('button', { name: /^Choose a file/ }))
        expect(await screen.findByText('one.env: 1 account found.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    })
    it('a file that will be created, and its warning, are said plainly', async () => {
        const user = userEvent.setup()
        open({
            wizardChooseAccounts: () =>
                Promise.resolve<AccountsStepResult>({
                    ok: true,
                    choice: {
                        source: 'default',
                        fileName: 'accounts.env',
                        accountCount: 0,
                        willCreate: true
                    },
                    warnings: ['The own file is created empty when you finish.']
                })
        })
        await toAccounts(user)
        await user.click(screen.getByRole('button', { name: /^Use the app/ }))
        expect(await screen.findByText(/will be created when you finish/)).toBeInTheDocument()
        expect(screen.getByText('The own file is created empty when you finish.')).toBeInTheDocument()
    })
    it('a refused file shows the message and the fix, and Next stays disabled', async () => {
        const user = userEvent.setup()
        open({
            wizardChooseAccounts: () =>
                Promise.resolve(refusal('This file has no account in it.', 'Choose another file.'))
        })
        await toAccounts(user)
        await user.click(screen.getByRole('button', { name: /^Choose a file/ }))
        expect(
            await screen.findByText(/This file has no account in it\. Choose another file\./)
        ).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    })
    it('closing the file dialog is information, not an error', async () => {
        const user = userEvent.setup()
        open({
            wizardChooseAccounts: () =>
                Promise.resolve(refusal('No file was chosen.', 'Choose a file, or use the own file.', true))
        })
        await toAccounts(user)
        await user.click(screen.getByRole('button', { name: /^Choose a file/ }))
        const box = await screen.findByText(/No file was chosen\./)
        expect(box.closest('[role="alert"]')).toHaveClass('MuiAlert-colorInfo')
    })
    it('a lost answer is shown and nothing is kept', async () => {
        const user = userEvent.setup()
        open({ wizardChooseAccounts: () => Promise.reject(new Error('channel closed')) })
        await toAccounts(user)
        await user.click(screen.getByRole('button', { name: /^Choose a file/ }))
        expect(await screen.findByText(/Choosing the accounts file could not be done/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    })
    it('Back returns to the computer check', async () => {
        const user = userEvent.setup()
        open()
        await toAccounts(user)
        await user.click(screen.getByRole('button', { name: 'Back' }))
        expect(await screen.findByRole('heading', { name: 'Check this computer' })).toBeInTheDocument()
    })
})

describe('step 3: basic settings', () => {
    it('sends exactly what was chosen', async () => {
        const user = userEvent.setup()
        const set = vi.fn((s: unknown) =>
            Promise.resolve<SettingsStepResult>({ ok: true, settings: s as never })
        )
        open({ wizardSetSettings: set })
        await toSettings(user)
        await user.click(screen.getByLabelText('Light'))
        await user.click(screen.getByLabelText(/Hide the browser window/))
        await user.click(screen.getByLabelText(/Start automatically every day/))
        fireEvent.change(screen.getByLabelText('Time (24 hours)'), { target: { value: '07:45' } })
        await next(user)
        await screen.findByRole('heading', { name: 'Review and finish' })
        expect(set).toHaveBeenCalledTimes(1)
        expect(set).toHaveBeenCalledWith({
            theme: 'light',
            headless: true,
            timerEnabled: true,
            timerTime: '07:45'
        })
    })
    it('a refused value is marked, the page stays, and the fix is shown', async () => {
        const user = userEvent.setup()
        open({
            wizardSetSettings: () =>
                Promise.resolve<SettingsStepResult>({
                    ok: false,
                    stage: 'invalid',
                    message: 'Time must be HH:MM (24 hours), for example 08:30.',
                    fix: 'Correct the marked setting and press Next again.',
                    cancelled: false,
                    errors: { timerTime: 'Time must be HH:MM (24 hours), for example 08:30.' }
                })
        })
        await toSettings(user)
        await next(user)
        expect((await screen.findAllByText(/Time must be HH:MM/)).length).toBeGreaterThan(0)
        expect(screen.getByText(/Correct the marked setting and press Next again\./)).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Basic settings' })).toBeInTheDocument()
    })
    it('a lost answer keeps the page and says nothing was changed', async () => {
        const user = userEvent.setup()
        open({ wizardSetSettings: () => Promise.reject(new Error('channel closed')) })
        await toSettings(user)
        await next(user)
        expect(await screen.findByText(/Saving the basic settings could not be done/)).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Basic settings' })).toBeInTheDocument()
    })
})

describe('step 4: review and finish', () => {
    it('shows the summary and its warnings; Finish is disabled until the box is ticked', async () => {
        const user = userEvent.setup()
        const finish = vi.fn(() => Promise.resolve(finished))
        open({ wizardFinish: finish })
        await toReview(user)
        expect(screen.getByText('my-accounts.env (2 accounts)')).toBeInTheDocument()
        expect(screen.getByText('On, every day at 07:45')).toBeInTheDocument()
        expect(screen.getByText(/only while this app is open/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
        expect(finish).not.toHaveBeenCalled()
        await user.click(screen.getByLabelText(FINISH_CONFIRM_TEXT))
        expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled()
        await user.click(screen.getByLabelText(FINISH_CONFIRM_TEXT))
        expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
    })
    it('Finish sends confirmed = true once, shows the result, and "Go to Home" leaves', async () => {
        const user = userEvent.setup()
        const finish = vi.fn((c: boolean) => {
            void c
            return Promise.resolve(finished)
        })
        open({ wizardFinish: finish })
        await toReview(user)
        await user.click(screen.getByLabelText(FINISH_CONFIRM_TEXT))
        await user.click(screen.getByRole('button', { name: 'Finish' }))
        expect(
            await screen.findByText(/Setup finished: 4 step\(s\) applied and checked\./)
        ).toHaveTextContent('accounts-file, timer, theme, headless')
        expect(finish).toHaveBeenCalledTimes(1)
        expect(finish).toHaveBeenCalledWith(true)
        expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Go to Home' }))
        await waitFor(() =>
            expect(screen.queryByRole('heading', { name: 'Review and finish' })).not.toBeInTheDocument()
        )
    })
    it('a note from the service (for example headless not saved) is shown as a warning', async () => {
        const user = userEvent.setup()
        open({
            wizardFinish: () =>
                Promise.resolve<WizardFinishResult>({
                    ...finished,
                    doneSteps: ['accounts-file', 'timer', 'theme'],
                    notes: ['The browser window setting was not saved because the engine is not running.']
                })
        })
        await toReview(user)
        await user.click(screen.getByLabelText(FINISH_CONFIRM_TEXT))
        await user.click(screen.getByRole('button', { name: 'Finish' }))
        expect(await screen.findByText(/was not saved because the engine is not running/)).toBeInTheDocument()
    })
    it('a failed step shows the message, the fix and what stayed done; Finish and Back stay available', async () => {
        const user = userEvent.setup()
        open({
            wizardFinish: () =>
                Promise.resolve<WizardFinishResult>({
                    ok: false,
                    stage: 'apply-failed',
                    message: 'Could not set the theme: Settings file is locked.',
                    fix: 'Fix the problem named above, then run the wizard again.',
                    cancelled: false,
                    doneSteps: ['accounts-file', 'timer']
                })
        })
        await toReview(user)
        await user.click(screen.getByLabelText(FINISH_CONFIRM_TEXT))
        await user.click(screen.getByRole('button', { name: 'Finish' }))
        const box = await screen.findByText(/Could not set the theme: Settings file is locked\./)
        expect(box).toHaveTextContent('Already done and kept: accounts-file, timer.')
        expect(screen.queryByRole('button', { name: 'Go to Home' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
    })
    it('a refusal such as "run is active" is shown, nothing else changes', async () => {
        const user = userEvent.setup()
        open({
            wizardFinish: () =>
                Promise.resolve<WizardFinishResult>({
                    ok: false,
                    stage: 'blocked',
                    message: 'A run is active. Nothing was changed.',
                    fix: 'Stop the run, then press Finish again.',
                    cancelled: false,
                    doneSteps: []
                })
        })
        await toReview(user)
        await user.click(screen.getByLabelText(FINISH_CONFIRM_TEXT))
        await user.click(screen.getByRole('button', { name: 'Finish' }))
        expect(await screen.findByText(/A run is active\. Nothing was changed\./)).toBeInTheDocument()
        expect(screen.queryByText(/Already done and kept/)).not.toBeInTheDocument()
    })
    it('a lost answer says some steps may have been applied and where to look', async () => {
        const user = userEvent.setup()
        open({ wizardFinish: () => Promise.reject(new Error('channel closed')) })
        await toReview(user)
        await user.click(screen.getByLabelText(FINISH_CONFIRM_TEXT))
        await user.click(screen.getByRole('button', { name: 'Finish' }))
        expect(await screen.findByText(/Some steps may have been applied/)).toHaveTextContent(
            'Home, Settings and Accounts'
        )
    })
    it('a review that is not ready shows the reason and offers no Finish', async () => {
        const user = userEvent.setup()
        open({
            wizardReview: () =>
                Promise.resolve<WizardReviewResult>({
                    ok: false,
                    stage: 'not-ready',
                    message: 'Some steps are not finished yet.',
                    fix: 'Go back and finish the earlier steps.',
                    cancelled: false
                })
        })
        await toReview(user)
        expect(screen.getByText(/Some steps are not finished yet\. Go back/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
        expect(screen.getByLabelText('The review is not ready.')).toBeInTheDocument()
    })
    it('Back from the review returns to the settings with the choices kept', async () => {
        const user = userEvent.setup()
        open()
        await toSettings(user)
        await user.click(screen.getByLabelText('Light'))
        await next(user)
        await screen.findByRole('heading', { name: 'Review and finish' })
        await user.click(screen.getByRole('button', { name: 'Back' }))
        await screen.findByRole('heading', { name: 'Basic settings' })
        expect(screen.getByLabelText('Light')).toBeChecked()
    })
    it('no password, cookie or key field exists anywhere in the wizard', async () => {
        const user = userEvent.setup()
        open()
        await toReview(user)
        expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
        // Only the fields of the wizard itself (the side menu has a link called "Secrets & API keys").
        const names = Array.from(document.querySelectorAll('input')).map(
            (i) =>
                `${i.getAttribute('aria-label') ?? ''} ${Array.from(i.labels ?? [])
                    .map((l) => l.textContent)
                    .join(' ')}`
        )
        expect(names.length).toBeGreaterThan(0)
        expect(names.join('|')).not.toMatch(/password|cookie|api key|token|secret/i)
    })
})

// ---- the real service behind the screens ---------------------------------------------------------------------------

const FAKE_PASSWORD = 'fake-pw-Zx81-test-only'
const ACCOUNTS = [
    'ACCOUNT_1_EMAIL=alpha@example.com',
    `ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}`,
    'ACCOUNT_2_EMAIL=beta@example.com',
    `ACCOUNT_2_PASSWORD=${FAKE_PASSWORD}2`,
    ''
].join('\n')

describe('against the real SetupWizardService', () => {
    const dirs: string[] = []
    afterEach(() => {
        while (dirs.length > 0)
            rmSync(dirs.pop() as string, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    })

    function real(health: 'ok' | 'bad' = 'ok') {
        const dir = mkdtempSync(join(tmpdir(), 'rf-wizard-ui-'))
        dirs.push(dir)
        const file = join(dir, 'my-accounts.env')
        writeFileSync(file, ACCOUNTS)
        const redactor = new Redactor()
        const audit = new JsonlLog(join(dir, 'logs'), 'audit.log', 'audit', (t) => redactor.redact(t))
        const appLog = new JsonlLog(join(dir, 'logs'), 'app.log', 'app', (t) => redactor.redact(t))
        const applied: string[] = []
        const done =
            (n: string) =>
            (...a: unknown[]) => {
                applied.push(
                    `${n}(${a.map((x) => (typeof x === 'string' && x.includes(dir) ? '<file>' : String(x))).join(',')})`
                )
                return Promise.resolve({ ok: true as const, message: 'done' })
            }
        const host: WizardHost = {
            useAccountsFile: done('useAccountsFile'),
            setTimer: done('setTimer'),
            setTheme: done('setTheme'),
            setHeadless: done('setHeadless')
        }
        const svc = new SetupWizardService({
            health: {
                runChecks: (): Promise<HealthState> =>
                    Promise.resolve({
                        status: 'done',
                        checks: PREREQUISITE_IDS.map(
                            (id) =>
                                ({
                                    id,
                                    group: 'runtime',
                                    title: `Row ${id}`,
                                    status: health === 'bad' && id === 'node' ? 'error' : 'ok',
                                    detail: health === 'bad' && id === 'node' ? 'Node is too old.' : 'fine',
                                    fix: health === 'bad' && id === 'node' ? 'Install Node 24.' : null,
                                    checkedAt: T
                                }) as HealthCheck
                        ),
                        startedAt: null,
                        finishedAt: T
                    })
            },
            pickAccountsFile: () => Promise.resolve(file),
            defaultAccountsPath: join(dir, 'accounts.env'),
            currentAccountsPath: () => null,
            markerPath: join(dir, 'setup-wizard.json'),
            host,
            runBlock: () => null,
            redactor,
            audit,
            appLog
        })
        return { dir, svc, applied }
    }

    const bridge = (svc: SetupWizardService): Over => ({
        wizardIsFirstRun: () => svc.isFirstRun(),
        wizardCheckPrerequisites: () => svc.checkPrerequisites(),
        wizardChooseAccounts: (s) => svc.chooseAccounts(s),
        wizardSetSettings: (s) => Promise.resolve(svc.setBasicSettings(s)),
        wizardReview: () => Promise.resolve(svc.review()),
        wizardFinish: (c) => svc.finish(c)
    })

    it('goes through all four steps, applies the choices once and shows no secret', async () => {
        const user = userEvent.setup()
        const r = real()
        installBridge(bridge(r.svc))
        window.location.hash = '#/home'
        render(<App />)
        await screen.findByText('This computer is ready. You can go to the next step.')
        await next(user)
        await user.click(await screen.findByRole('button', { name: /^Choose a file/ }))
        expect(await screen.findByText('my-accounts.env: 2 accounts found.')).toBeInTheDocument()
        await next(user)
        await user.click(await screen.findByLabelText('Light'))
        await user.click(screen.getByLabelText(/Start automatically every day/))
        fireEvent.change(screen.getByLabelText('Time (24 hours)'), { target: { value: '06:30' } })
        await next(user)
        expect(await screen.findByText('On, every day at 06:30')).toBeInTheDocument()
        expect(r.applied).toEqual([])
        await user.click(screen.getByLabelText(FINISH_CONFIRM_TEXT))
        await user.click(screen.getByRole('button', { name: 'Finish' }))
        expect(
            await screen.findByText(/Setup finished: 4 step\(s\) applied and checked\./)
        ).toBeInTheDocument()
        expect(r.applied).toEqual([
            'useAccountsFile(<file>)',
            'setTimer(true,06:30)',
            'setTheme(light)',
            'setHeadless(false)'
        ])
        const text = document.body.textContent ?? ''
        for (const s of [FAKE_PASSWORD, 'alpha@example.com', 'beta@example.com', r.dir])
            expect(text).not.toContain(s)
    })

    it('a computer that fails the check cannot pass step 1 (real service)', async () => {
        const r = real('bad')
        installBridge(bridge(r.svc))
        window.location.hash = '#/home'
        render(<App />)
        expect(await screen.findByText(/The wizard cannot go on yet\./)).toHaveTextContent('Node is too old.')
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
        expect(r.applied).toEqual([])
    })
})
