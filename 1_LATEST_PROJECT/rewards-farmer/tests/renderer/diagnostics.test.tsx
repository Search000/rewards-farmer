import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXPORT_CANCELLED_MESSAGE } from '../../src/shared/diagnostics-types'
import type { ActionResult, FarmerState } from '../../src/shared/farmer-types'
import { makeCheck } from '../../src/shared/health-rules'
import type { HealthState } from '../../src/shared/health-types'
import type { FarmerShellApi } from '../../src/shared/ipc-types'
import { App } from '../../src/renderer/App'

// Phase 14 renderer: the "Export diagnostics" card on the Health page. The bridge is a stand-in (rule 18); the real export is
// covered by tests/main/diagnostics.test.ts.

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

const healthDone = (): HealthState => ({
    status: 'done',
    startedAt: T,
    finishedAt: T,
    checks: [makeCheck('app', 'ok', 'Rewards Farmer LUCK 0.0.1', null, T)]
})

function installBridge(exportFn: () => Promise<ActionResult>) {
    const exporter = vi.fn(exportFn)
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
        getLogsState: no,
        refreshLogs: no,
        exportLogs: no,
        runHealthChecks: () => Promise.resolve(healthDone()),
        exportDiagnostics: exporter,
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
    return exporter
}

describe('Health page: diagnostics bundle card (Phase 14)', () => {
    beforeEach(() => {
        window.location.hash = '#/health'
    })
    afterEach(() => {
        delete window.farmerShell
    })

    it('outside Electron there is no export button (nothing to export)', () => {
        render(<App />)
        expect(screen.queryByRole('button', { name: 'Export diagnostics' })).not.toBeInTheDocument()
    })

    it('shows what the bundle holds and what it leaves out, and a real button', async () => {
        installBridge(() => Promise.resolve({ ok: true, message: 'x' }))
        render(<App />)
        const region = await screen.findByRole('region', { name: 'Diagnostics bundle' })
        expect(region).toHaveTextContent(
            /Passwords, tokens, cookies, sessions, e-mail addresses and IP addresses/
        )
        expect(screen.getByRole('button', { name: 'Export diagnostics' })).toBeEnabled()
        expect(screen.queryByTestId('diagnostics-result')).not.toBeInTheDocument()
    })

    it('a saved bundle shows the real message from main, as a status', async () => {
        const run = installBridge(() =>
            Promise.resolve({
                ok: true,
                message: 'Saved the diagnostics bundle (6 files, 4.2 KB) to C:\\x\\a.zip.'
            })
        )
        render(<App />)
        fireEvent.click(await screen.findByRole('button', { name: 'Export diagnostics' }))
        const result = await screen.findByTestId('diagnostics-result')
        expect(run).toHaveBeenCalledTimes(1)
        expect(run).toHaveBeenCalledWith()
        expect(result).toHaveTextContent('Saved the diagnostics bundle (6 files, 4.2 KB)')
        expect(result).toHaveAttribute('role', 'status')
    })

    it('a blocked or failed export shows the exact reason as an alert and stays until the next export', async () => {
        let n = 0
        installBridge(() => {
            n += 1
            return Promise.resolve(
                n === 1
                    ? {
                          ok: false,
                          code: 'EXPORT_BLOCKED',
                          message: 'The bundle was NOT saved. The safety check found a cookie in it.'
                      }
                    : { ok: true, message: 'Saved the diagnostics bundle.' }
            )
        })
        render(<App />)
        fireEvent.click(await screen.findByRole('button', { name: 'Export diagnostics' }))
        const first = await screen.findByTestId('diagnostics-result')
        expect(first).toHaveTextContent('The bundle was NOT saved')
        expect(first).toHaveAttribute('role', 'alert')
        fireEvent.click(screen.getByRole('button', { name: 'Export diagnostics' }))
        await screen.findByText('Saved the diagnostics bundle.')
        expect(screen.getByTestId('diagnostics-result')).toHaveAttribute('role', 'status')
    })

    it('closing the save window shows no message at all', async () => {
        installBridge(() => Promise.resolve({ ok: false, message: EXPORT_CANCELLED_MESSAGE }))
        render(<App />)
        fireEvent.click(await screen.findByRole('button', { name: 'Export diagnostics' }))
        await act(async () => {
            await Promise.resolve()
        })
        expect(screen.queryByTestId('diagnostics-result')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Export diagnostics' })).toBeEnabled()
    })

    it('if the call itself throws it says so instead of staying silent', async () => {
        installBridge(() => Promise.reject(new Error('Untrusted sender.')))
        render(<App />)
        fireEvent.click(await screen.findByRole('button', { name: 'Export diagnostics' }))
        expect(await screen.findByTestId('diagnostics-result')).toHaveTextContent(
            'The export failed (Untrusted sender.).'
        )
    })

    it('the button is disabled while the export runs, so it cannot be started twice', async () => {
        let release: (r: ActionResult) => void = () => undefined
        const run = installBridge(() => new Promise<ActionResult>((r) => (release = r)))
        render(<App />)
        fireEvent.click(await screen.findByRole('button', { name: 'Export diagnostics' }))
        const busy = await screen.findByRole('button', { name: 'Exporting...' })
        expect(busy).toBeDisabled()
        fireEvent.click(busy)
        expect(run).toHaveBeenCalledTimes(1)
        await act(async () => {
            release({ ok: true, message: 'Saved the diagnostics bundle.' })
            await Promise.resolve()
        })
        expect(await screen.findByRole('button', { name: 'Export diagnostics' })).toBeEnabled()
    })
})
