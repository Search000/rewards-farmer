import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult, FarmerState } from '../../src/shared/farmer-types'
import type { FarmerShellApi } from '../../src/shared/ipc-types'
import { App } from '../../src/renderer/App'

// These tests use a stand-in for the Electron preload bridge. It exists only here (rule 18). The real bridge, the real
// engine API and a real child process are covered by tests/main/farmer.integration.test.ts.

const OK: ActionResult = { ok: true, message: 'ok' }

function baseState(over: Partial<FarmerState> = {}): FarmerState {
    return {
        engine: { link: 'ready', detail: null, version: '4.3.2.4' },
        accounts: { path: null, status: 'not-set', error: null, count: null },
        run: { phase: 'idle', startedAt: null, lastExit: null },
        current: { account: null, points: null, section: null, detail: null, proxy: null },
        summary: { all: null, finished: null, failed: null },
        timer: { enabled: false, time: '00:00', nextFireAt: null },
        startDisabledReason: 'Choose an accounts file first.',
        stopDisabledReason: 'No run in progress.',
        notices: [],
        updatedAt: '2026-10-11T10:00:00.000Z',
        ...over
    }
}

interface Bridge {
    readonly api: FarmerShellApi
    push(state: FarmerState): void
    readonly fns: {
        readonly startRun: ReturnType<typeof vi.fn>
        readonly stopRun: ReturnType<typeof vi.fn>
        readonly pick: ReturnType<typeof vi.fn>
        readonly createConfig: ReturnType<typeof vi.fn>
        readonly restartEngine: ReturnType<typeof vi.fn>
        readonly setTimer: ReturnType<typeof vi.fn>
    }
}

function installBridge(initial: FarmerState): Bridge {
    let listener: ((s: FarmerState) => void) | null = null
    const fns = {
        startRun: vi.fn(() => Promise.resolve(OK)),
        stopRun: vi.fn(() => Promise.resolve(OK)),
        pick: vi.fn(() => Promise.resolve({ cancelled: false, result: OK })),
        createConfig: vi.fn(() => Promise.resolve(OK)),
        restartEngine: vi.fn(() => Promise.resolve(OK)),
        setTimer: vi.fn(() => Promise.resolve(OK))
    }
    const api: FarmerShellApi = {
        getAppInfo: () => Promise.reject(new Error('not used')),
        getFarmerState: () => Promise.resolve(initial),
        pickAccountsFile: fns.pick,
        startRun: fns.startRun,
        stopRun: fns.stopRun,
        createEngineConfig: fns.createConfig,
        repairEngineConfig: () => Promise.reject(new Error('not used')),
        restartEngine: fns.restartEngine,
        setTimer: fns.setTimer,
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
        // Accounts screen (Phase 7): the Home page never calls these. Covered by accounts.test.tsx.
        getAccountsState: () => Promise.reject(new Error('not used')),
        addAccount: () => Promise.reject(new Error('not used')),
        updateAccount: () => Promise.reject(new Error('not used')),
        removeAccount: () => Promise.reject(new Error('not used')),
        // Settings screen (Phase 8): the Home page never calls these. Covered by settings.test.tsx.
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
    return { api, push: (s) => listener?.(s), fns }
}

describe('Home page (Phase 6 renderer)', () => {
    beforeEach(() => {
        window.location.hash = '#/home'
    })
    afterEach(() => {
        delete window.farmerShell
    })

    it('outside Electron it says so and shows no numbers', () => {
        render(<App />)
        expect(screen.getByRole('status')).toHaveTextContent(/not running inside the desktop app/i)
        expect(screen.queryByText('Start')).not.toBeInTheDocument()
    })

    it('idle without accounts: Start and Stop disabled, honest placeholders, no invented numbers', async () => {
        installBridge(baseState())
        render(<App />)
        expect(await screen.findByText('Current account: None')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
        // the reason is available on the focusable wrapper (rule 17)
        expect(screen.getByLabelText('Choose an accounts file first.')).toBeInTheDocument()
        expect(screen.getByLabelText('No run in progress.')).toBeInTheDocument()
        expect(screen.getByText('Choose the .env file that holds your accounts.')).toBeInTheDocument()
        // counts that the engine/file has not provided are "unknown", never 0
        const info = screen.getByRole('region', { name: 'Accounts informations' })
        expect(within(info).getByText('All').nextSibling).toHaveTextContent('unknown')
        expect(within(info).getByText('Locked').nextSibling).toHaveTextContent('unknown')
        expect(within(info).getByText('Suspended').nextSibling).toHaveTextContent('unknown')
    })

    it('alternate proxies is disabled with the reason, never faked', async () => {
        installBridge(baseState())
        render(<App />)
        await screen.findByText('Current account: None')
        expect(screen.getByRole('textbox', { name: 'Alternate proxies' })).toBeDisabled()
        expect(screen.getAllByText(/Not supported by the engine/).length).toBeGreaterThan(0)
    })

    it('Open picks the accounts file through the main process; cancel changes nothing', async () => {
        const user = userEvent.setup()
        const b = installBridge(baseState())
        render(<App />)
        await screen.findByText('Current account: None')
        // The button is re-created while an action is busy, so it is looked up again before every click.
        const open = () => screen.getAllByRole('button', { name: 'Open' })[0] as HTMLElement
        b.fns.pick.mockResolvedValueOnce({ cancelled: true, result: { ok: false, message: 'cancelled' } })
        await user.click(open())
        await waitFor(() => expect(b.fns.pick).toHaveBeenCalledTimes(1))
        expect(screen.queryByText('Accounts file selected.')).not.toBeInTheDocument()
        await waitFor(() => expect(open()).toBeEnabled())
        await user.click(open())
        expect(await screen.findByText('Accounts file selected.')).toBeInTheDocument()
        expect(b.fns.pick).toHaveBeenCalledTimes(2)
    })

    it('an invalid accounts file shows the real error text on the field', async () => {
        installBridge(
            baseState({
                accounts: {
                    path: 'C:\\x\\accounts.env',
                    status: 'error',
                    error: 'No ACCOUNT_1_EMAIL entries found.',
                    count: null
                }
            })
        )
        render(<App />)
        expect(await screen.findByText('No ACCOUNT_1_EMAIL entries found.')).toBeInTheDocument()
    })

    it('running: live values shown, Stop works, Start disabled with a reason', async () => {
        const user = userEvent.setup()
        const b = installBridge(
            baseState({
                accounts: { path: 'C:\\x\\accounts.env', status: 'ok', error: null, count: 2 },
                run: { phase: 'running', startedAt: '2026-10-11T10:00:00.000Z', lastExit: null },
                current: {
                    account: 'alpha@example.com',
                    points: 1234,
                    section: 'FLOW',
                    detail: 'step',
                    proxy: null
                },
                summary: { all: 2, finished: 0, failed: 0 },
                startDisabledReason: 'A run is already running.',
                stopDisabledReason: null
            })
        )
        render(<App />)
        expect(await screen.findByText('Current account: alpha@example.com')).toBeInTheDocument()
        const card = screen.getByRole('region', { name: /Current account/ })
        expect(within(card).getByText('Current point').nextSibling).toHaveTextContent('1234')
        expect(within(card).getByText('Section').nextSibling).toHaveTextContent('FLOW')
        expect(within(card).getByText('Proxy').nextSibling).toHaveTextContent('-')
        expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
        await user.click(screen.getByRole('button', { name: 'Stop' }))
        expect(b.fns.stopRun).toHaveBeenCalledTimes(1)
        expect(b.fns.startRun).not.toHaveBeenCalled()
    })

    it('Start calls the main process once; an engine refusal is shown, not hidden', async () => {
        const user = userEvent.setup()
        const b = installBridge(
            baseState({
                accounts: { path: 'C:\\x\\accounts.env', status: 'ok', error: null, count: 1 },
                startDisabledReason: null
            })
        )
        b.fns.startRun.mockResolvedValueOnce({
            ok: false,
            code: 'RUN_ACTIVE',
            message: 'A run is already active.'
        })
        render(<App />)
        await screen.findByText('Current account: None')
        await user.click(screen.getByRole('button', { name: 'Start' }))
        expect(b.fns.startRun).toHaveBeenCalledTimes(1)
        expect(await screen.findByText('A run is already active.')).toBeInTheDocument()
    })

    it('pushed state updates the page without a reload', async () => {
        const b = installBridge(baseState())
        render(<App />)
        await screen.findByText('Current account: None')
        b.push(
            baseState({
                run: { phase: 'running', startedAt: '2026-10-11T10:00:00.000Z', lastExit: null },
                current: {
                    account: 'beta@example.com',
                    points: 50,
                    section: null,
                    detail: null,
                    proxy: null
                },
                stopDisabledReason: null
            })
        )
        expect(await screen.findByText('Current account: beta@example.com')).toBeInTheDocument()
    })

    it('notice actions call the matching main-process action', async () => {
        const user = userEvent.setup()
        const b = installBridge(
            baseState({
                notices: [
                    {
                        id: 'config',
                        severity: 'warning',
                        message: 'The engine has no config.json.',
                        action: 'create-config'
                    },
                    {
                        id: 'engine',
                        severity: 'error',
                        message: 'The engine stopped.',
                        action: 'restart-engine'
                    }
                ]
            })
        )
        render(<App />)
        expect(await screen.findByText('The engine has no config.json.')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Create config' }))
        expect(b.fns.createConfig).toHaveBeenCalledTimes(1)
        await user.click(screen.getByRole('button', { name: 'Restart engine' }))
        expect(b.fns.restartEngine).toHaveBeenCalledTimes(1)
    })

    it('timer toggle saves through the main process', async () => {
        const user = userEvent.setup()
        const b = installBridge(baseState())
        render(<App />)
        await screen.findByText('Current account: None')
        await user.click(screen.getByRole('switch', { name: 'Timer' }))
        expect(b.fns.setTimer).toHaveBeenCalledWith(true, '00:00')
    })

    it('app bar engine indicator follows the real engine link', async () => {
        installBridge(baseState({ engine: { link: 'down', detail: null, version: null } }))
        render(<App />)
        expect(await screen.findByRole('img', { name: 'Engine: stopped or crashed' })).toBeInTheDocument()
    })
})
