import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineSettingsState, EngineSettingsValues } from '../../src/shared/engine-settings-types'
import type { ActionResult, FarmerState } from '../../src/shared/farmer-types'
import type { FarmerShellApi } from '../../src/shared/ipc-types'
import { App } from '../../src/renderer/App'

// Stand-in for the Electron preload bridge (rule 18). The real config file, backup, PATCH and read-back are covered by
// tests/main/engineSettings.integration.test.ts.

const OK: ActionResult = { ok: true, message: 'Settings saved.' }

const VALUES: EngineSettingsValues = {
    logLevel: 'debug',
    browser: 'chromium',
    headless: false,
    useProxyForSearchQueries: false,
    disableImages: false,
    parallelSearching: false,
    dailyQuests: true,
    punchCards: true,
    moreActivities: true,
    exploreOnBing: true,
    pcSearch: true,
    mobileSearch: true,
    readToEarn: true,
    visualSearch: false,
    prewarmDesktopLogin: false,
    dailyCheckIn: true,
    streakProtection: true,
    claimBonusPoints: true,
    activateSearchPerk: true,
    appPromotions: true,
    urlRewards: true,
    autoClaimPunchCards: false,
    skipNonPointTasks: true,
    accountDelayMin: '1min',
    accountDelayMax: '3min',
    searchDelayMin: '6min',
    searchDelayMax: '12min',
    readDelayMin: '6min',
    readDelayMax: '11min',
    globalTimeout: '50sec',
    searchResultVisitTime: '20sec',
    bonusSearches: false,
    maxBonusSearches: 110,
    runOnZeroPoints: false,
    clusterSearch: true,
    localBingQueries: false,
    queryEngines: ['china', 'local'],
    clusters: 1,
    ignoreCertificateErrors: false,
    apiSearch: false,
    apiSearchOnBing: false
}

function farmerState(): FarmerState {
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
        updatedAt: '2026-10-11T10:00:00.000Z'
    }
}

function settingsState(over: Partial<EngineSettingsState> = {}): EngineSettingsState {
    return {
        status: 'ok',
        reason: null,
        values: VALUES,
        defaults: VALUES,
        missingKeys: [],
        editDisabledReason: null,
        lastBackupAt: null,
        updatedAt: '2026-10-11T10:00:00.000Z',
        ...over
    }
}

function installBridge(initial: EngineSettingsState) {
    const fns = {
        get: vi.fn(() => Promise.resolve(initial)),
        save: vi.fn(() => Promise.resolve(OK)),
        reset: vi.fn(() => Promise.resolve(OK)),
        shutdown: vi.fn(() => Promise.resolve({ ok: true, message: 'Shutdown on.' } as ActionResult))
    }
    const api: FarmerShellApi = {
        getAppInfo: () => Promise.reject(new Error('not used')),
        getFarmerState: () => Promise.resolve(farmerState()),
        pickAccountsFile: () => Promise.reject(new Error('not used')),
        startRun: () => Promise.reject(new Error('not used')),
        stopRun: () => Promise.reject(new Error('not used')),
        createEngineConfig: () => Promise.reject(new Error('not used')),
        repairEngineConfig: () => Promise.reject(new Error('not used')),
        restartEngine: () => Promise.reject(new Error('not used')),
        setTimer: () => Promise.reject(new Error('not used')),
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
        getAccountsState: () => Promise.reject(new Error('not used')),
        addAccount: () => Promise.reject(new Error('not used')),
        updateAccount: () => Promise.reject(new Error('not used')),
        removeAccount: () => Promise.reject(new Error('not used')),
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
        getEngineSettingsState: fns.get,
        saveEngineSettings: fns.save,
        resetEngineSettings: fns.reset,
        setShutdownAfterRun: fns.shutdown
    }
    window.farmerShell = api
    return fns
}

describe('Settings page (Phase 8 renderer)', () => {
    beforeEach(() => {
        window.location.hash = '#/settings'
    })
    afterEach(() => {
        delete window.farmerShell
    })

    it('outside Electron it says so and offers no Save button', () => {
        render(<App />)
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent(/not running inside the desktop app/i)
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('shows the real values, a disabled Save with the reason, and the not-built controls greyed out and empty', async () => {
        installBridge(settingsState())
        render(<App />)
        expect(await screen.findByLabelText('Daily quests')).toBeChecked()
        expect(screen.getByLabelText('Visual Search')).not.toBeChecked()
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
        expect(screen.getByLabelText('PC User Agent')).toBeDisabled()
        expect(screen.getByLabelText('PC User Agent')).toHaveValue('')
        expect(screen.getByLabelText('Randomization (not included)')).toBeDisabled()
    })

    it('a changed toggle warns about unsaved changes and Save sends exactly the edited values', async () => {
        const fns = installBridge(settingsState())
        const user = userEvent.setup()
        render(<App />)
        await user.click(await screen.findByLabelText('Headless'))
        expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(fns.save).toHaveBeenCalledTimes(1))
        expect(fns.save).toHaveBeenCalledWith({ ...VALUES, headless: true })
    })

    it('while a run is active the controls and Save are disabled and the reason is shown', async () => {
        installBridge(settingsState({ editDisabledReason: 'A run is active.' }))
        render(<App />)
        expect(await screen.findByText(/Settings are read-only now: A run is active\./)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
    })

    it('Reset asks first, and only calls the bridge after the user confirms', async () => {
        const fns = installBridge(settingsState())
        const user = userEvent.setup()
        render(<App />)
        await user.click(await screen.findByRole('button', { name: 'Reset to defaults' }))
        expect(fns.reset).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: 'Reset' }))
        await waitFor(() => expect(fns.reset).toHaveBeenCalledTimes(1))
    })

    it('Shutdown is a real switch that is saved at once, without Save, and is not part of the engine settings', async () => {
        const fns = installBridge(settingsState())
        const user = userEvent.setup()
        render(<App />)
        const sw = await screen.findByLabelText('Shutdown')
        await waitFor(() => expect(sw).toBeEnabled())
        expect(sw).not.toBeChecked()
        await user.click(sw)
        await waitFor(() => expect(fns.shutdown).toHaveBeenCalledWith(true))
        expect(fns.save).not.toHaveBeenCalled()
        expect(screen.getByLabelText('Shutdown')).toBeChecked()
    })

    it('a failed save shows the reason and keeps the edit', async () => {
        const fns = installBridge(settingsState())
        fns.save.mockResolvedValueOnce({ ok: false, message: 'The engine rejected the config.' })
        const user = userEvent.setup()
        render(<App />)
        await user.click(await screen.findByLabelText('Punch cards'))
        await user.click(screen.getByRole('button', { name: 'Save' }))
        expect(await screen.findByText('The engine rejected the config.')).toBeInTheDocument()
        expect(screen.getByLabelText('Punch cards')).not.toBeChecked()
    })
})

describe('Settings page (Phase 9 renderer): login, timing, search options', () => {
    beforeEach(() => {
        window.location.hash = '#/settings'
    })
    afterEach(() => {
        delete window.farmerShell
    })

    it('shows the real Phase 9 values in three sections', async () => {
        installBridge(settingsState())
        render(<App />)
        expect(await screen.findByLabelText('Daily check-in')).toBeChecked()
        expect(screen.getByLabelText('Prewarm desktop login')).not.toBeChecked()
        expect(screen.getByLabelText('Between accounts: min')).toHaveValue('1min')
        expect(screen.getByLabelText('Between searches: max')).toHaveValue('12min')
        expect(screen.getByLabelText('Page timeout')).toHaveValue('50sec')
        expect(screen.getByLabelText('Max bonus searches')).toHaveValue('110')
        expect(screen.getByLabelText('China trending (gmya.net)')).toBeChecked()
        expect(screen.getByLabelText('Reddit')).not.toBeChecked()
        expect(screen.getByText(/Used in this order: china > local/)).toBeInTheDocument()
    })

    it('a time without a unit is marked as an error, Save is disabled with the reason, and fixing it enables Save', async () => {
        const fns = installBridge(settingsState())
        const user = userEvent.setup()
        render(<App />)
        const field = await screen.findByLabelText('Between searches: min')
        await user.clear(field)
        await user.type(field, '90')
        expect(field).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
        await user.clear(field)
        await user.type(field, '90sec')
        expect(field).toHaveAttribute('aria-invalid', 'false')
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
        await user.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(fns.save).toHaveBeenCalledTimes(1))
        expect(fns.save).toHaveBeenCalledWith({ ...VALUES, searchDelayMin: '90sec' })
    })

    it('a maximum shorter than the minimum is an error on the maximum field', async () => {
        installBridge(settingsState())
        const user = userEvent.setup()
        render(<App />)
        const max = await screen.findByLabelText('Between accounts: max')
        await user.clear(max)
        await user.type(max, '10sec')
        expect(max).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByText('The maximum must not be shorter than the minimum.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('a delay shorter than the engine default shows a note but can still be saved', async () => {
        installBridge(settingsState())
        const user = userEvent.setup()
        render(<App />)
        const min = await screen.findByLabelText('Between searches: min')
        await user.clear(min)
        await user.type(min, '2min')
        expect(screen.getAllByText(/Shorter than the engine default/).length).toBeGreaterThan(0)
        expect(min).toHaveAttribute('aria-invalid', 'false')
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('Max bonus searches accepts only digits; an empty box is an error', async () => {
        installBridge(settingsState())
        const user = userEvent.setup()
        render(<App />)
        const field = await screen.findByLabelText('Max bonus searches')
        await user.clear(field)
        expect(field).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
        await user.type(field, '4a2')
        expect(field).toHaveValue('42')
        expect(field).toHaveAttribute('aria-invalid', 'false')
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('search sources keep the order they were ticked in, and at least one is required', async () => {
        const fns = installBridge(settingsState())
        const user = userEvent.setup()
        render(<App />)
        await user.click(await screen.findByLabelText('Reddit'))
        expect(screen.getByText(/Used in this order: china > local > reddit/)).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(fns.save).toHaveBeenCalledTimes(1))
        expect(fns.save).toHaveBeenCalledWith({ ...VALUES, queryEngines: ['china', 'local', 'reddit'] })
        await user.click(screen.getByLabelText('China trending (gmya.net)'))
        await user.click(screen.getByLabelText('Local word list'))
        await user.click(screen.getByLabelText('Reddit'))
        expect(screen.getByText('Choose at least one source.')).toBeInTheDocument()
    })

    it('Discard brings every Phase 9 edit back to the saved values', async () => {
        installBridge(settingsState())
        const user = userEvent.setup()
        render(<App />)
        await user.click(await screen.findByLabelText('Daily check-in'))
        const field = screen.getByLabelText('Page timeout')
        await user.clear(field)
        await user.type(field, '2min')
        expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Discard' }))
        expect(screen.getByLabelText('Daily check-in')).toBeChecked()
        expect(screen.getByLabelText('Page timeout')).toHaveValue('50sec')
        expect(screen.queryByText('You have unsaved changes.')).not.toBeInTheDocument()
    })

    it('while a run is active the Phase 9 controls are disabled', async () => {
        installBridge(settingsState({ editDisabledReason: 'A run is active.' }))
        render(<App />)
        expect(await screen.findByLabelText(/^Daily check-in/)).toBeDisabled()
        expect(screen.getByLabelText(/^Between accounts: min/)).toBeDisabled()
        expect(screen.getByLabelText(/^Max bonus searches/)).toBeDisabled()
        expect(screen.getByLabelText(/^Reddit/)).toBeDisabled()
    })

    it('screenshot controls without one engine setting stay greyed out with their reason, and excluded options are not on the page', async () => {
        installBridge(settingsState())
        render(<App />)
        expect(await screen.findByLabelText('Delay after search')).toBeDisabled()
        expect(screen.getByLabelText(/Open search results/)).toBeDisabled()
        for (const banned of [
            /continue on bot warning/i,
            /humanize/i,
            /random results/i,
            /ignore certificate/i,
            /quiet hours/i
        ]) {
            expect(screen.queryByLabelText(banned)).not.toBeInTheDocument()
        }
    })
})
