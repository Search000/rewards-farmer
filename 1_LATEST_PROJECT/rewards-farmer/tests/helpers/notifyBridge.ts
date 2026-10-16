import { vi } from 'vitest'
import type { FarmerState } from '../../src/shared/farmer-types'
import type { FarmerShellApi } from '../../src/shared/ipc-types'

// Phase 17 test helper: a complete stand-in for the preload bridge (rule 18). Only the three notification calls and the
// two app-state calls are given by the test; every other call fails loudly, so a page that touches something else is
// caught. The real engine, files and network are covered by notifications.service.test.tsx and tests/main/notifications.

export function farmerState(
    over: { link?: FarmerState['engine']['link']; phase?: FarmerState['run']['phase'] } = {}
): FarmerState {
    return {
        engine: { link: over.link ?? 'ready', detail: null, version: '4.3.2.4' },
        accounts: { path: null, status: 'not-set', error: null, count: null },
        run: { phase: over.phase ?? 'idle', startedAt: null, lastExit: null },
        current: { account: null, points: null, section: null, detail: null, proxy: null },
        summary: { all: null, finished: null, failed: null },
        timer: { enabled: false, time: '00:00', nextFireAt: null },
        startDisabledReason: null,
        stopDisabledReason: 'No run in progress.',
        notices: [],
        updatedAt: '2026-10-15T10:00:00.000Z'
    }
}

type NotifyApi = Pick<
    FarmerShellApi,
    'getNotificationsState' | 'setNotificationEnabled' | 'sendTestNotification'
>

// Any set of calls a test wants to answer; every other call fails loudly.
export function installBridge(over: Partial<FarmerShellApi>, farmer: FarmerState = farmerState()): void {
    const no = () => Promise.reject(new Error('not used'))
    const api = {
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
        getLogsState: no,
        refreshLogs: no,
        exportLogs: no,
        runHealthChecks: no,
        exportDiagnostics: no,
        getBackupsState: no,
        createBackup: no,
        inspectBackup: no,
        openBackupFolder: no,
        previewRestore: no,
        prepareRestore: no,
        applyRestore: no,
        undoRestore: no,
        // The Backups page reads the record of the last restore when it opens; "no restore yet" is the quiet default.
        getRestoreHistory: () =>
            Promise.resolve({
                status: 'none',
                message: 'No restore has been done yet.',
                backupId: null,
                startedAt: null,
                finishedAt: null,
                files: [],
                canUndo: false,
                undoBlockedReason: null
            }),
        // Phase 22: the setup wizard calls. "Not the first start" is the quiet default; the wizard tests give the real stand-ins.
        wizardIsFirstRun: () => Promise.resolve(false),
        wizardGetState: no,
        wizardReset: no,
        wizardCheckPrerequisites: no,
        wizardChooseAccounts: no,
        wizardSetSettings: no,
        wizardReview: no,
        wizardFinish: no,
        setShutdownAfterRun: no,
        getSecretsState: no,
        setSecret: no,
        clearSecret: no,
        getNotificationsState: no,
        setNotificationEnabled: no,
        sendTestNotification: no,
        ...over
    } as FarmerShellApi
    window.farmerShell = api
}

export function installNotifyBridge(notify: NotifyApi, farmer: FarmerState = farmerState()): void {
    installBridge(notify, farmer)
}

export const spyNotify = (impl: NotifyApi) => ({
    get: vi.fn(impl.getNotificationsState),
    set: vi.fn(impl.setNotificationEnabled),
    test: vi.fn(impl.sendTestNotification)
})
