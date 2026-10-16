import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult, FarmerState } from '../../src/shared/farmer-types'
import type { FarmerShellApi } from '../../src/shared/ipc-types'
import type { LogLine, LogsState } from '../../src/shared/logs-types'
import { App } from '../../src/renderer/App'

// Stand-in for the preload bridge (rule 18). Real engine lines, redaction and files are covered in tests/main/.

const farmerState = (over: Partial<FarmerState> = {}): FarmerState => ({
    engine: { link: 'ready', detail: null, version: '4.3.2.4' },
    accounts: { path: null, status: 'not-set', error: null, count: null },
    run: { phase: 'idle', startedAt: null, lastExit: null },
    current: { account: null, points: null, section: null, detail: null, proxy: null },
    summary: { all: null, finished: null, failed: null },
    timer: { enabled: false, time: '00:00', nextFireAt: null },
    startDisabledReason: null,
    stopDisabledReason: 'No run in progress.',
    notices: [],
    updatedAt: '2026-10-12T10:00:00.000Z',
    ...over
})

const line = (seq: number, over: Partial<LogLine> = {}): LogLine => ({
    seq,
    session: 1,
    id: seq,
    at: '2026-10-12T10:00:00.000Z',
    level: 'info',
    title: 'FLOW',
    message: `message ${String(seq)}`,
    user: 'alpha',
    ...over
})

const logsState = (over: Partial<LogsState> = {}): LogsState => ({
    status: 'ok',
    reason: null,
    connection: 'live',
    lines: [],
    bufferedTotal: 0,
    dropped: 0,
    missed: 0,
    fileError: null,
    updatedAt: '2026-10-12T10:00:00.000Z',
    ...over
})

function installBridge(state: LogsState, farmer: FarmerState = farmerState()) {
    const fns = {
        get: vi.fn(() => Promise.resolve(state)),
        refresh: vi.fn(() => Promise.resolve({ ok: true, message: 'Logs are up to date.' } as ActionResult)),
        export: vi.fn(() => Promise.resolve({ ok: true, message: 'Exported 1 log line(s).' } as ActionResult))
    }
    const no = () => Promise.reject(new Error('not used'))
    const api: FarmerShellApi = {
        getAppInfo: no,
        getFarmerState: () => Promise.resolve(farmer),
        pickAccountsFile: no,
        startRun: no,
        stopRun: no,
        createEngineConfig: no,
        repairEngineConfig: no,
        restartEngine: no,
        setTimer: no,
        onFarmerState: () => () => undefined,
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
        getAccountsState: no,
        addAccount: no,
        updateAccount: no,
        removeAccount: no,
        getEngineSettingsState: no,
        saveEngineSettings: no,
        resetEngineSettings: no,
        getSecretsState: no,
        setSecret: no,
        clearSecret: no,
        setShutdownAfterRun: no,
        getNotificationsState: no,
        setNotificationEnabled: no,
        sendTestNotification: no,
        getLogsState: fns.get,
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
        refreshLogs: fns.refresh,
        exportLogs: fns.export
    }
    window.farmerShell = api
    return fns
}

describe('Logs page (Phase 11 renderer)', () => {
    beforeEach(() => {
        window.location.hash = '#/logs'
    })
    afterEach(() => {
        delete window.farmerShell
    })

    it('outside Electron it says there is no engine to read, and shows no lines', () => {
        render(<App />)
        expect(screen.getByRole('heading', { level: 1, name: 'Logs' })).toBeInTheDocument()
        expect(screen.getByText(/works only inside the desktop app/)).toBeInTheDocument()
        expect(screen.queryByRole('log')).not.toBeInTheDocument()
    })

    it('shows real lines with level, user, title and message, and the engine status', async () => {
        installBridge(
            logsState({
                lines: [line(1), line(2, { level: 'error', title: 'LOGIN', message: 'Login failed' })],
                bufferedTotal: 2
            }),
            farmerState({
                run: { phase: 'running', startedAt: '2026-10-12T10:00:00.000Z', lastExit: null },
                current: {
                    account: 'alpha@example.com',
                    points: 1003,
                    section: null,
                    detail: null,
                    proxy: null
                }
            })
        )
        render(<App />)
        const log = await screen.findByRole('log', { name: 'Engine log lines' })
        expect(within(log).getByText('message 1')).toBeInTheDocument()
        expect(within(log).getByText('[ERROR]')).toBeInTheDocument()
        expect(within(log).getByText('Login failed')).toBeInTheDocument()
        expect(screen.getByText('Live (event stream)')).toBeInTheDocument()
        expect(screen.getByText('1003')).toBeInTheDocument()
        expect(screen.getByText('alpha@example.com')).toBeInTheDocument()
    })

    it('shows "Unknown" instead of guessing when the engine did not report a value', async () => {
        installBridge(
            logsState(),
            farmerState({
                engine: { link: 'down', detail: null, version: null },
                run: { phase: 'unknown', startedAt: null, lastExit: null }
            })
        )
        render(<App />)
        await screen.findByRole('log')
        expect(screen.getByText('Unknown (engine not reachable)')).toBeInTheDocument()
        expect(screen.getByText('Stopped or crashed')).toBeInTheDocument()
        expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(3) // version, account, points
    })

    it('shows the reason when there is nothing to show, not an empty success', async () => {
        installBridge(
            logsState({
                status: 'unavailable',
                reason: 'The engine is not running, so there are no logs to show.',
                connection: 'idle'
            })
        )
        render(<App />)
        expect(await screen.findByText(/engine is not running, so there are no logs/)).toBeInTheDocument()
        expect(screen.queryByRole('log')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    })

    it('tells the truth about missed lines, dropped lines and a disk problem', async () => {
        installBridge(
            logsState({
                lines: [line(1)],
                bufferedTotal: 1,
                missed: 3,
                dropped: 7,
                fileError: 'EACCES: permission denied'
            })
        )
        render(<App />)
        expect(await screen.findByText(/3 engine log line\(s\) were not received/)).toBeInTheDocument()
        expect(screen.getByText(/7 older line\(s\) were removed from this screen/)).toBeInTheDocument()
        expect(screen.getByText(/log files on disk cannot be written.*EACCES/)).toBeInTheDocument()
    })

    it('marks an engine restart between lines of different sessions (a marker, not a log line)', async () => {
        installBridge(logsState({ lines: [line(1), line(2, { session: 2, id: 1 })], bufferedTotal: 2 }))
        render(<App />)
        expect(await screen.findByText(/engine restarted \(new session\)/)).toBeInTheDocument()
    })

    it('filters by level and text, and says so when nothing matches', async () => {
        installBridge(
            logsState({
                lines: [
                    line(1, { message: 'plain info' }),
                    line(2, { level: 'warn', message: 'be careful' }),
                    line(3, { level: 'error', message: 'broke' })
                ],
                bufferedTotal: 3
            })
        )
        const user = userEvent.setup()
        render(<App />)
        const log = await screen.findByRole('log')
        await user.type(screen.getByLabelText('Search'), 'careful')
        expect(within(log).queryByText('plain info')).not.toBeInTheDocument()
        expect(within(log).getByText('be careful')).toBeInTheDocument()
        await user.clear(screen.getByLabelText('Search'))
        await user.type(screen.getByLabelText('Search'), 'zzz')
        expect(within(log).getByText('No lines match the filter.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled()
    })

    it('Refresh and Export call the bridge; Export sends only the filter (never a path) and reports the result', async () => {
        const fns = installBridge(logsState({ lines: [line(1)], bufferedTotal: 1 }))
        const user = userEvent.setup()
        render(<App />)
        await screen.findByRole('log')
        await user.type(screen.getByLabelText('Search'), 'message')
        await user.click(screen.getByRole('button', { name: 'Refresh' }))
        expect(fns.refresh).toHaveBeenCalledTimes(1)
        await user.click(screen.getByRole('button', { name: 'Export' }))
        await waitFor(() => expect(fns.export).toHaveBeenCalledWith({ level: 'all', text: 'message' }))
        expect(await screen.findByText('Exported 1 log line(s).')).toBeInTheDocument()
    })

    it('Copy puts the shown (already redacted) lines on the clipboard', async () => {
        installBridge(logsState({ lines: [line(1, { message: 'token is ***' })], bufferedTotal: 1 }))
        const user = userEvent.setup()
        render(<App />)
        await screen.findByRole('log')
        await user.click(screen.getByRole('button', { name: 'Copy' }))
        // user-event provides the clipboard in jsdom.
        expect(await navigator.clipboard.readText()).toBe(
            '2026-10-12T10:00:00.000Z [INFO] [alpha] FLOW: token is ***'
        )
    })
})
