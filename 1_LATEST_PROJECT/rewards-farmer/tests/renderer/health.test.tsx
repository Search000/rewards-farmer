import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCheck } from '../../src/shared/health-rules'
import type { HealthCheck, HealthState } from '../../src/shared/health-types'
import type { FarmerState } from '../../src/shared/farmer-types'
import type { FarmerShellApi } from '../../src/shared/ipc-types'
import { App } from '../../src/renderer/App'

// Stand-in for the preload bridge (rule 18). The real checks are covered in tests/main/health*.test.ts.

const T = '2026-10-14T10:00:00.000Z'

const farmerState = (): FarmerState => ({
    engine: { link: 'ready', detail: null, version: '4.3.2' },
    accounts: { path: null, status: 'not-set', error: null, count: null },
    run: { phase: 'idle', startedAt: null, lastExit: null },
    current: { account: null, points: null, section: null, detail: null, proxy: null },
    summary: { all: null, finished: null, failed: null },
    timer: { enabled: false, time: '00:00', nextFireAt: null },
    startDisabledReason: null,
    stopDisabledReason: 'No run in progress.',
    notices: [],
    updatedAt: T
})

const row = (
    id: HealthCheck['id'],
    status: HealthCheck['status'],
    detail: string,
    fix: string | null = null
): HealthCheck => makeCheck(id, status, detail, fix, T)

const done = (checks: HealthCheck[]): HealthState => ({ status: 'done', checks, startedAt: T, finishedAt: T })

function installBridge(run: () => Promise<HealthState>) {
    const fn = vi.fn(run)
    let listener: ((s: FarmerState) => void) | null = null
    const no = () => Promise.reject(new Error('not used'))
    const api: FarmerShellApi = {
        getAppInfo: no,
        getFarmerState: () => Promise.resolve(farmerState()),
        pickAccountsFile: no,
        startRun: no,
        stopRun: no,
        createEngineConfig: no,
        repairEngineConfig: no,
        restartEngine: no,
        setTimer: no,
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
        getLogsState: no,
        refreshLogs: no,
        exportLogs: no,
        runHealthChecks: fn,
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
        getRestoreHistory: () => Promise.reject(new Error('not used'))
    }
    window.farmerShell = api
    // push = the main process sends a new app state (for example the engine went down).
    const push = (patch: Partial<FarmerState['engine']>): void => {
        listener?.({ ...farmerState(), engine: { ...farmerState().engine, ...patch } })
    }
    return Object.assign(fn, { push })
}

describe('Health page (Phase 12 renderer)', () => {
    beforeEach(() => {
        window.location.hash = '#/health'
    })
    afterEach(() => {
        delete window.farmerShell
    })

    it('outside Electron it says there is nothing to check, and shows no rows', () => {
        render(<App />)
        expect(screen.getByRole('heading', { level: 1, name: 'Health' })).toBeInTheDocument()
        expect(screen.getByText(/works only inside the desktop app/)).toBeInTheDocument()
        expect(screen.queryByTestId('health-summary')).not.toBeInTheDocument()
    })

    it('runs the checks when the page opens, shows a loading state first, then the real rows grouped', async () => {
        const run = installBridge(() =>
            Promise.resolve(
                done([
                    row('app', 'ok', 'Rewards Farmer LUCK 0.0.1'),
                    row('node', 'ok', 'Node.js 24.21.0'),
                    row('engine-files', 'ok', 'The engine folder and its API script are present.'),
                    row('engine-process', 'ok', 'The engine process is running and ready.')
                ])
            )
        )
        render(<App />)
        expect(screen.getByText('Running the checks...')).toBeInTheDocument()
        expect(await screen.findByTestId('health-summary')).toHaveTextContent('All 4 checks passed.')
        expect(run).toHaveBeenCalledTimes(1)
        for (const name of ['Runtime', 'Configuration', 'Engine'])
            expect(screen.getByRole('region', { name })).toBeInTheDocument()
        expect(within(screen.getByTestId('health-row-node')).getByText(/Node.js 24.21.0/)).toBeInTheDocument()
        expect(screen.getByTestId('health-row-node')).toHaveAttribute('data-status', 'ok')
    })

    it('a failed row shows its status in words, the detail, and "What to do"; unknown is never shown as OK', async () => {
        installBridge(() =>
            Promise.resolve(
                done([
                    row(
                        'node',
                        'error',
                        'Node.js was not found on this computer.',
                        'Download Node.js 24 from https://nodejs.org/ then double-click START.bat.'
                    ),
                    row(
                        'git',
                        'warning',
                        'Git was not found on this computer.',
                        'Download Git only if you want to update the engine.'
                    ),
                    row(
                        'engine-api',
                        'unknown',
                        'Not checked: the engine is not running (see "Engine process").'
                    ),
                    row('app', 'ok', 'Rewards Farmer LUCK 0.0.1')
                ])
            )
        )
        render(<App />)
        const node = await screen.findByTestId('health-row-node')
        expect(node).toHaveTextContent('Problem')
        expect(node).toHaveTextContent('Node.js was not found on this computer.')
        expect(node).toHaveTextContent(/What to do:\s*Download Node\.js 24/)
        expect(screen.getByTestId('health-row-git')).toHaveTextContent('Warning')
        const unknown = screen.getByTestId('health-row-engine-api')
        expect(unknown).toHaveTextContent('Unknown')
        expect(unknown).not.toHaveTextContent('What to do')
        expect(unknown).not.toHaveTextContent(/- OK/)
        expect(screen.getByTestId('health-summary')).toHaveTextContent(
            '1 problem, 1 warning, 1 could not be checked. 1 of 4 checks passed.'
        )
    })

    it('when the run itself fails it says so (error state), and shows no rows', async () => {
        installBridge(() => Promise.reject(new Error('Untrusted sender.')))
        render(<App />)
        expect(await screen.findByText('The health checks could not run.')).toBeInTheDocument()
        expect(screen.getByText('Untrusted sender.')).toBeInTheDocument()
        expect(screen.queryByTestId('health-summary')).not.toBeInTheDocument()
    })

    it('shows the new system rows (disk, folders, internet) in their own group with what to do', async () => {
        installBridge(() =>
            Promise.resolve(
                done([
                    row(
                        'disk-space',
                        'error',
                        'The disk is almost full: 50 MB on the app data drive.',
                        'Free some space on drive C:.'
                    ),
                    row(
                        'folder-data',
                        'error',
                        'This computer does not allow the app to write in the app data folder: C:\\x',
                        'Move the project folder to Documents.'
                    ),
                    row(
                        'network',
                        'error',
                        'The name rewards.bing.com could not be looked up (ENOTFOUND).',
                        'Check your Wi-Fi, then press "Re-run checks".'
                    )
                ])
            )
        )
        render(<App />)
        const region = await screen.findByRole('region', { name: 'This computer' })
        expect(within(region).getAllByRole('listitem')).toHaveLength(3)
        expect(screen.getByTestId('health-row-disk-space')).toHaveTextContent(/What to do:\s*Free some space/)
        expect(screen.getByTestId('health-row-network')).toHaveTextContent('Problem')
    })
})

describe('Health page: Re-run checks and automatic re-checks (Phase 13)', () => {
    const ok = () => Promise.resolve(done([row('app', 'ok', 'Rewards Farmer LUCK 0.0.1')]))

    beforeEach(() => {
        window.location.hash = '#/health'
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        delete window.farmerShell
    })

    const flush = async (ms = 0) => {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(ms)
        })
    }

    it('the Re-run checks button runs the real checks again and is disabled while they run', async () => {
        let release: (s: HealthState) => void = () => undefined
        let calls = 0
        const run = installBridge(() => {
            calls += 1
            return calls === 1 ? ok() : new Promise<HealthState>((r) => (release = r))
        })
        render(<App />)
        await flush()
        const button = screen.getByRole('button', { name: 'Re-run checks' })
        expect(button).toBeEnabled()
        fireEvent.click(button)
        await flush()
        expect(run).toHaveBeenCalledTimes(2)
        const busy = screen.getByRole('button', { name: 'Checking...' })
        expect(busy).toBeDisabled()
        fireEvent.click(busy)
        await flush()
        expect(run).toHaveBeenCalledTimes(2)
        await act(async () => {
            release(done([row('app', 'ok', 'Rewards Farmer LUCK 0.0.1')]))
            await Promise.resolve()
        })
        expect(screen.getByRole('button', { name: 'Re-run checks' })).toBeEnabled()
    })

    it('the page shows the NEW result after a re-run (not the old one)', async () => {
        let n = 0
        installBridge(() => {
            n += 1
            return Promise.resolve(
                done([
                    n === 1
                        ? row('node', 'error', 'Node.js was not found.', 'Install Node.js.')
                        : row('node', 'ok', 'Node.js 24.21.0')
                ])
            )
        })
        render(<App />)
        await flush()
        expect(screen.getByTestId('health-row-node')).toHaveAttribute('data-status', 'error')
        fireEvent.click(screen.getByRole('button', { name: 'Re-run checks' }))
        await flush()
        expect(screen.getByTestId('health-row-node')).toHaveAttribute('data-status', 'ok')
    })

    it('re-runs by itself after the engine state changes, once, after a quiet moment', async () => {
        const run = installBridge(ok)
        render(<App />)
        await flush(6000)
        expect(run).toHaveBeenCalledTimes(1)
        act(() => run.push({ link: 'down' }))
        await flush(500)
        expect(run).toHaveBeenCalledTimes(1)
        act(() => run.push({ link: 'ready' }))
        act(() => run.push({ link: 'down' }))
        await flush(1600)
        expect(run).toHaveBeenCalledTimes(2)
        await flush(20000)
        expect(run).toHaveBeenCalledTimes(2)
    })

    it('does NOT re-run when the pushed state did not change anything the checks look at', async () => {
        const run = installBridge(ok)
        render(<App />)
        await flush(6000)
        act(() => run.push({ detail: 'something else', version: '9.9.9' }))
        await flush(10000)
        expect(run).toHaveBeenCalledTimes(1)
    })

    it('automatic runs are never closer together than the minimum gap (no loop, no hammering)', async () => {
        const run = installBridge(ok)
        render(<App />)
        await flush(0)
        expect(run).toHaveBeenCalledTimes(1)
        act(() => run.push({ link: 'down' }))
        await flush(1600)
        expect(run).toHaveBeenCalledTimes(1)
        await flush(4000)
        expect(run).toHaveBeenCalledTimes(2)
    })

    it('re-runs when the internet goes off or on, and when the window comes back after a long time', async () => {
        const run = installBridge(ok)
        render(<App />)
        await flush(6000)
        act(() => {
            window.dispatchEvent(new Event('offline'))
        })
        await flush(1600)
        expect(run).toHaveBeenCalledTimes(2)
        await flush(6000)
        act(() => {
            window.dispatchEvent(new Event('online'))
        })
        await flush(1600)
        expect(run).toHaveBeenCalledTimes(3)
        act(() => {
            window.dispatchEvent(new Event('focus'))
        })
        await flush(3000)
        expect(run).toHaveBeenCalledTimes(3)
        await flush(20000)
        act(() => {
            window.dispatchEvent(new Event('focus'))
        })
        await flush(1600)
        expect(run).toHaveBeenCalledTimes(4)
    })

    it('stops re-checking when the page is closed', async () => {
        const run = installBridge(ok)
        render(<App />)
        await flush(6000)
        act(() => run.push({ link: 'down' }))
        act(() => {
            window.location.hash = '#/home'
            window.dispatchEvent(new HashChangeEvent('hashchange'))
        })
        await flush(10000)
        act(() => {
            window.dispatchEvent(new Event('offline'))
        })
        await flush(10000)
        expect(run).toHaveBeenCalledTimes(1)
    })
})
