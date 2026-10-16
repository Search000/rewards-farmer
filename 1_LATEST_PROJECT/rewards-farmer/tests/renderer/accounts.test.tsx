import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountsState, AccountView } from '../../src/shared/accounts-types'
import type { ActionResult, FarmerState } from '../../src/shared/farmer-types'
import type { FarmerShellApi } from '../../src/shared/ipc-types'
import { App } from '../../src/renderer/App'

// These tests use a stand-in for the Electron preload bridge. It exists only here (rule 18). The real accounts file, the
// backup, the atomic write and the real engine reload are covered by tests/main/accounts.integration.test.ts.

const OK: ActionResult = { ok: true, message: 'Account saved.' }
const NOT_SET_TEXT = 'No accounts file added yet, open an accounts file from Home'

function farmerState(over: Partial<FarmerState> = {}): FarmerState {
    return {
        engine: { link: 'ready', detail: null, version: '4.3.2.4' },
        accounts: { path: null, status: 'not-set', error: null, count: null },
        run: { phase: 'idle', startedAt: null, lastExit: null },
        current: { account: null, points: null, section: null, detail: null, proxy: null },
        summary: { all: null, finished: null, failed: null },
        timer: { enabled: false, time: '00:00', nextFireAt: null },
        startDisabledReason: null,
        stopDisabledReason: 'No run in progress.',
        notices: [],
        updatedAt: '2026-10-11T10:00:00.000Z',
        ...over
    }
}

function account(slot: number, email: string, over: Partial<AccountView> = {}): AccountView {
    return {
        slot,
        email,
        hasPassword: true,
        hasTotp: false,
        hasRecoveryEmail: false,
        langCode: null,
        geoLocale: null,
        proxy: null,
        problems: [],
        ...over
    }
}

function accountsState(over: Partial<AccountsState> = {}): AccountsState {
    return {
        status: 'ok',
        path: 'C:\\farm\\accounts.env',
        error: null,
        accounts: [account(1, 'alpha@example.com'), account(2, 'beta@example.com')],
        editDisabledReason: null,
        lastBackupAt: null,
        updatedAt: '2026-10-11T10:00:00.000Z',
        ...over
    }
}

interface Bridge {
    readonly fns: {
        readonly getAccounts: ReturnType<typeof vi.fn>
        readonly add: ReturnType<typeof vi.fn>
        readonly update: ReturnType<typeof vi.fn>
        readonly remove: ReturnType<typeof vi.fn>
    }
    setAccounts(next: AccountsState): void
    pushFarmer(state: FarmerState): void
}

function installBridge(initial: AccountsState, farmer: FarmerState = farmerState()): Bridge {
    let current = initial
    let listener: ((s: FarmerState) => void) | null = null
    const fns = {
        getAccounts: vi.fn(() => Promise.resolve(current)),
        add: vi.fn(() => Promise.resolve(OK)),
        update: vi.fn(() => Promise.resolve(OK)),
        remove: vi.fn(() => Promise.resolve(OK))
    }
    const api: FarmerShellApi = {
        getAppInfo: () => Promise.reject(new Error('not used')),
        getFarmerState: () => Promise.resolve(farmer),
        pickAccountsFile: () => Promise.reject(new Error('not used')),
        startRun: () => Promise.reject(new Error('not used')),
        stopRun: () => Promise.reject(new Error('not used')),
        createEngineConfig: () => Promise.reject(new Error('not used')),
        repairEngineConfig: () => Promise.reject(new Error('not used')),
        restartEngine: () => Promise.reject(new Error('not used')),
        setTimer: () => Promise.reject(new Error('not used')),
        onFarmerState: (cb) => {
            listener = cb
            return () => {
                listener = null
            }
        },
        getSettings: () =>
            Promise.resolve({
                schemaVersion: 2,
                themeMode: 'dark',
                accountsPath: null,
                timerEnabled: false,
                timerTime: '00:00',
                shutdownAfterRun: false
            }),
        setThemeMode: () => Promise.resolve(),
        getAccountsState: fns.getAccounts,
        addAccount: fns.add,
        updateAccount: fns.update,
        removeAccount: fns.remove,
        // Settings screen (Phase 8): the Accounts page never calls these. Covered by settings.test.tsx.
        getSecretsState: () => Promise.reject(new Error('not used')),
        setSecret: () => Promise.reject(new Error('not used')),
        getNotificationsState: () => Promise.reject(new Error('not used')),
        setNotificationEnabled: () => Promise.reject(new Error('not used')),
        sendTestNotification: () => Promise.reject(new Error('not used')),
        getLogsState: () => Promise.reject(new Error('not used')),
        runHealthChecks: () => Promise.reject(new Error('not used')),
        exportDiagnostics: () => Promise.reject(new Error('not used')),
        getBackupsState: () => Promise.reject(new Error('not used')),
        createBackup: () => Promise.reject(new Error('not used')),
        inspectBackup: () => Promise.reject(new Error('not used')),
        openBackupFolder: () => Promise.reject(new Error('not used')),
        previewRestore: () => Promise.reject(new Error('not used')),
        prepareRestore: () => Promise.reject(new Error('not used')),
        applyRestore: () => Promise.reject(new Error('not used')),
        undoRestore: () => Promise.reject(new Error('not used')),
        // Phase 22: the setup wizard calls. Not the first start by default; no page here uses the rest.
        wizardIsFirstRun: () => Promise.resolve(false),
        wizardGetState: () => Promise.reject(new Error('not used')),
        wizardReset: () => Promise.reject(new Error('not used')),
        wizardCheckPrerequisites: () => Promise.reject(new Error('not used')),
        wizardChooseAccounts: () => Promise.reject(new Error('not used')),
        wizardSetSettings: () => Promise.reject(new Error('not used')),
        wizardReview: () => Promise.reject(new Error('not used')),
        wizardFinish: () => Promise.reject(new Error('not used')),
        getRestoreHistory: () => Promise.reject(new Error('not used')),
        refreshLogs: () => Promise.reject(new Error('not used')),
        exportLogs: () => Promise.reject(new Error('not used')),
        clearSecret: () => Promise.reject(new Error('not used')),
        getEngineSettingsState: () => Promise.reject(new Error('not used')),
        saveEngineSettings: () => Promise.reject(new Error('not used')),
        resetEngineSettings: () => Promise.reject(new Error('not used')),
        setShutdownAfterRun: () => Promise.reject(new Error('not used'))
    }
    window.farmerShell = api
    return {
        fns,
        setAccounts: (next) => {
            current = next
        },
        pushFarmer: (s) => listener?.(s)
    }
}

describe('Accounts page (Phase 7 renderer)', () => {
    beforeEach(() => {
        window.location.hash = '#/accounts'
    })
    afterEach(() => {
        delete window.farmerShell
    })

    it('outside Electron it says so and offers no Add button', () => {
        render(<App />)
        expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent(/not running inside the desktop app/i)
        expect(screen.queryByRole('button', { name: 'Add account' })).not.toBeInTheDocument()
    })

    it('no accounts file yet: the text of screenshot 2, Add disabled with the reason, no accounts invented', async () => {
        installBridge(accountsState({ status: 'not-set', path: null, accounts: [] }))
        render(<App />)
        expect(await screen.findByText(NOT_SET_TEXT)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Add account' })).toBeDisabled()
        expect(screen.getByLabelText('Open an accounts file from Home first.')).toBeInTheDocument()
        expect(screen.queryByRole('list', { name: 'Accounts' })).not.toBeInTheDocument()
        expect(screen.queryByText(/Last backup/)).not.toBeInTheDocument()
    })

    it('lists the real accounts with flags only: no secret values, problems shown, file path and backup status shown', async () => {
        installBridge(
            accountsState({
                accounts: [
                    account(1, 'alpha@example.com', { hasTotp: true, langCode: 'en', geoLocale: 'US' }),
                    account(2, 'beta@example.com', {
                        hasPassword: false,
                        proxy: {
                            url: 'http://proxy.example.com',
                            port: 8080,
                            httpToo: false,
                            hasCredentials: true
                        },
                        problems: ['Region is not "auto" or a two-letter country code.']
                    })
                ]
            })
        )
        render(<App />)
        const list = await screen.findByRole('list', { name: 'Accounts' })
        const rows = within(list).getAllByRole('listitem')
        expect(rows).toHaveLength(2)
        expect(within(rows[0] as HTMLElement).getByText('alpha@example.com')).toBeInTheDocument()
        expect(within(rows[0] as HTMLElement).getByText('Password saved')).toBeInTheDocument()
        expect(within(rows[0] as HTMLElement).getByText('2FA secret saved')).toBeInTheDocument()
        expect(within(rows[0] as HTMLElement).getByText('Language: en')).toBeInTheDocument()
        expect(within(rows[0] as HTMLElement).getByText('Region: US')).toBeInTheDocument()
        expect(within(rows[0] as HTMLElement).getByText('No proxy')).toBeInTheDocument()
        expect(within(rows[1] as HTMLElement).getByText('No password')).toBeInTheDocument()
        expect(
            within(rows[1] as HTMLElement).getByText('Proxy: http://proxy.example.com:8080')
        ).toBeInTheDocument()
        expect(within(rows[1] as HTMLElement).getByText('Proxy login saved')).toBeInTheDocument()
        expect(within(rows[1] as HTMLElement).getByText('Language: default')).toBeInTheDocument()
        expect(within(rows[1] as HTMLElement).getByRole('alert')).toHaveTextContent(/Region is not "auto"/)
        expect(screen.getByText('Accounts file: C:\\farm\\accounts.env')).toBeInTheDocument()
        expect(screen.getByText(/Last backup:\s*none yet/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Add account' })).toBeEnabled()
        expect(screen.getByRole('button', { name: 'Edit alpha@example.com' })).toBeEnabled()
    })

    it('a broken accounts file shows the real error and disables Add with a reason', async () => {
        installBridge(
            accountsState({
                status: 'error',
                error: 'The accounts file does not exist any more.',
                accounts: []
            })
        )
        render(<App />)
        expect(await screen.findByText('The accounts file does not exist any more.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Add account' })).toBeDisabled()
        expect(screen.getByLabelText(/The accounts file has a problem/)).toBeInTheDocument()
    })

    it('while a run is active Add, Edit and Remove are disabled and say why', async () => {
        const reason = 'A run is active. Stop it before changing accounts.'
        installBridge(accountsState({ editDisabledReason: reason }))
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })
        expect(screen.getByRole('button', { name: 'Add account' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Edit alpha@example.com' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Remove alpha@example.com' })).toBeDisabled()
        expect(screen.getAllByLabelText(reason).length).toBeGreaterThanOrEqual(3)
    })

    it('reads the list again when the Home state changes (for example a run starts)', async () => {
        const bridge = installBridge(accountsState())
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })
        const before = bridge.fns.getAccounts.mock.calls.length
        bridge.setAccounts(
            accountsState({ editDisabledReason: 'A run is active. Stop it before changing accounts.' })
        )
        bridge.pushFarmer(
            farmerState({ run: { phase: 'running', startedAt: '2026-10-11T10:05:00.000Z', lastExit: null } })
        )
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add account' })).toBeDisabled())
        expect(bridge.fns.getAccounts.mock.calls.length).toBeGreaterThan(before)
    })

    it('Add: empty form shows hints and sends nothing; a valid form calls the main process once and refreshes the list', async () => {
        const user = userEvent.setup()
        const bridge = installBridge(accountsState())
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })
        await user.click(screen.getByRole('button', { name: 'Add account' }))
        const dialog = await screen.findByRole('dialog', { name: 'Add account' })

        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        expect(within(dialog).getByText('E-mail is required.')).toBeInTheDocument()
        expect(bridge.fns.add).not.toHaveBeenCalled()

        const callsBefore = bridge.fns.getAccounts.mock.calls.length
        await user.type(within(dialog).getByLabelText('E-mail'), 'new@example.com')
        await user.type(within(dialog).getByLabelText('Password'), 'pw-test-only')
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(bridge.fns.add).toHaveBeenCalledTimes(1))
        expect(bridge.fns.add).toHaveBeenCalledWith(
            expect.objectContaining({
                email: 'new@example.com',
                password: 'pw-test-only',
                clearPassword: false
            })
        )
        expect(await screen.findByText('Account saved.')).toBeInTheDocument()
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'Add account' })).not.toBeInTheDocument()
        )
        expect(bridge.fns.getAccounts.mock.calls.length).toBeGreaterThan(callsBefore)
    })

    it('Add: an e-mail that is already in the file is refused in the dialog, without calling the main process', async () => {
        const user = userEvent.setup()
        const bridge = installBridge(accountsState())
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })
        await user.click(screen.getByRole('button', { name: 'Add account' }))
        const dialog = await screen.findByRole('dialog', { name: 'Add account' })
        await user.type(within(dialog).getByLabelText('E-mail'), 'ALPHA@example.com')
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        expect(within(dialog).getByText(/already uses this e-mail/)).toBeInTheDocument()
        expect(bridge.fns.add).not.toHaveBeenCalled()
    })

    it('Add: when the main process refuses, the dialog stays open and shows the real reason', async () => {
        const user = userEvent.setup()
        const bridge = installBridge(accountsState())
        bridge.fns.add.mockResolvedValueOnce({ ok: false, code: 'BAD_REQUEST', message: 'The disk is full.' })
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })
        await user.click(screen.getByRole('button', { name: 'Add account' }))
        const dialog = await screen.findByRole('dialog', { name: 'Add account' })
        await user.type(within(dialog).getByLabelText('E-mail'), 'new@example.com')
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        expect(await within(dialog).findByText('The disk is full.')).toBeInTheDocument()
        expect(screen.getByRole('dialog', { name: 'Add account' })).toBeInTheDocument()
    })

    it('Edit: prefilled without secrets; empty secret boxes mean keep; the remove box clears and disables the field', async () => {
        const user = userEvent.setup()
        const bridge = installBridge(
            accountsState({
                accounts: [
                    account(1, 'alpha@example.com', { hasTotp: true, langCode: 'nl', geoLocale: 'NL' }),
                    account(4, 'beta@example.com')
                ]
            })
        )
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })
        await user.click(screen.getByRole('button', { name: 'Edit alpha@example.com' }))
        const dialog = await screen.findByRole('dialog', { name: 'Edit account' })
        expect(within(dialog).getByLabelText('E-mail')).toHaveValue('alpha@example.com')
        expect(within(dialog).getByLabelText('Language')).toHaveValue('nl')
        expect(within(dialog).getByLabelText('Region')).toHaveValue('NL')
        expect(within(dialog).getByLabelText('Password')).toHaveValue('')
        expect(within(dialog).getAllByText('Saved. Leave empty to keep the saved value.')).toHaveLength(2)

        await user.click(within(dialog).getByRole('checkbox', { name: 'Remove the saved 2FA secret' }))
        expect(within(dialog).getByLabelText('2FA secret')).toBeDisabled()
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(bridge.fns.update).toHaveBeenCalledTimes(1))
        expect(bridge.fns.update).toHaveBeenCalledWith(
            1,
            'alpha@example.com',
            expect.objectContaining({
                password: '',
                clearPassword: false,
                totpSecret: '',
                clearTotp: true,
                langCode: 'nl'
            })
        )
    })

    it('Edit: the e-mail of another account is refused, the own e-mail is fine', async () => {
        const user = userEvent.setup()
        const bridge = installBridge(accountsState())
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })
        await user.click(screen.getByRole('button', { name: 'Edit alpha@example.com' }))
        const dialog = await screen.findByRole('dialog', { name: 'Edit account' })
        const email = within(dialog).getByLabelText('E-mail')
        await user.clear(email)
        await user.type(email, 'beta@example.com')
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        expect(within(dialog).getByText(/already uses this e-mail/)).toBeInTheDocument()
        expect(bridge.fns.update).not.toHaveBeenCalled()
        await user.clear(email)
        await user.type(email, 'alpha@example.com')
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(bridge.fns.update).toHaveBeenCalledTimes(1))
    })

    it('Remove: asks first; Cancel removes nothing; Remove sends the slot and the e-mail it showed', async () => {
        const user = userEvent.setup()
        const bridge = installBridge(
            accountsState({ accounts: [account(1, 'alpha@example.com'), account(7, 'beta@example.com')] })
        )
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })

        await user.click(screen.getByRole('button', { name: 'Remove beta@example.com' }))
        let confirm = await screen.findByRole('dialog', { name: 'Remove account?' })
        expect(confirm).toHaveTextContent(/beta@example\.com/)
        expect(confirm).toHaveTextContent(/backup copy/)
        await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'Remove account?' })).not.toBeInTheDocument()
        )
        expect(bridge.fns.remove).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: 'Remove beta@example.com' }))
        confirm = await screen.findByRole('dialog', { name: 'Remove account?' })
        await user.click(within(confirm).getByRole('button', { name: 'Remove' }))
        await waitFor(() => expect(bridge.fns.remove).toHaveBeenCalledWith(7, 'beta@example.com'))
        expect(await screen.findByText('Account saved.')).toBeInTheDocument()
    })

    it('Remove: a refusal from the main process is shown as an error, not as success', async () => {
        const user = userEvent.setup()
        const bridge = installBridge(accountsState())
        bridge.fns.remove.mockResolvedValueOnce({
            ok: false,
            code: 'NOT_FOUND',
            message: 'The list is out of date. Refresh and try again.'
        })
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })
        await user.click(screen.getByRole('button', { name: 'Remove alpha@example.com' }))
        const confirm = await screen.findByRole('dialog', { name: 'Remove account?' })
        await user.click(within(confirm).getByRole('button', { name: 'Remove' }))
        expect(await screen.findByText('The list is out of date. Refresh and try again.')).toBeInTheDocument()
        expect(screen.queryByText('Account saved.')).not.toBeInTheDocument()
    })

    it('keyboard: Escape closes the Add dialog without saving', async () => {
        const user = userEvent.setup()
        const bridge = installBridge(accountsState())
        render(<App />)
        await screen.findByRole('list', { name: 'Accounts' })
        await user.click(screen.getByRole('button', { name: 'Add account' }))
        await screen.findByRole('dialog', { name: 'Add account' })
        await user.keyboard('{Escape}')
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'Add account' })).not.toBeInTheDocument()
        )
        expect(bridge.fns.add).not.toHaveBeenCalled()
    })
})
