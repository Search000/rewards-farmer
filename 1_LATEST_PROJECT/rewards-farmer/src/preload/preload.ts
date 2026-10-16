import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { ACCOUNTS_IPC } from '../shared/accounts-types'
import type { AccountInput, AccountsState } from '../shared/accounts-types'
import { BACKUP_IPC } from '../shared/backup-types'
import { RESTORE_IPC } from '../shared/restore-types'
import { WIZARD_IPC } from '../shared/wizard-types'
import type {
    AccountsStepResult,
    BasicSettings,
    PrerequisitesResult,
    SettingsStepResult,
    WizardFinishResult,
    WizardReviewResult,
    WizardState
} from '../shared/wizard-types'
import type {
    RestoreApplyResult,
    RestoreHistory,
    RestorePrepareResult,
    RestorePreviewResult,
    RestoreUndoResult
} from '../shared/restore-types'
import type { BackupCreateResult, BackupInspectResult, BackupListResult } from '../shared/backup-types'
import type { AppInfo } from '../shared/app-info'
import { DIAGNOSTICS_IPC } from '../shared/diagnostics-types'
import { ENGINE_SETTINGS_IPC } from '../shared/engine-settings-types'
import type { EngineSettingsState, EngineSettingsValues } from '../shared/engine-settings-types'
import { HEALTH_IPC } from '../shared/health-types'
import type { HealthState } from '../shared/health-types'
import { LOGS_IPC } from '../shared/logs-types'
import type { LogsFilter, LogsState } from '../shared/logs-types'
import { NOTIFICATIONS_IPC } from '../shared/notifications-types'
import type { NotificationsState, NotifyChannelId, NotifyTestResult } from '../shared/notifications-types'
import { SECRETS_IPC } from '../shared/secrets-types'
import type { SecretId, SecretsState } from '../shared/secrets-types'
import type { ActionResult, FarmerState, PersistedSettings, ThemeModeSetting } from '../shared/farmer-types'
import { IPC } from '../shared/ipc-types'
import type { FarmerShellApi, PickResult } from '../shared/ipc-types'

// The ONLY surface the renderer gets. Each method maps to one named channel; there is no passthrough.
const api: FarmerShellApi = {
    getAppInfo: () => ipcRenderer.invoke(IPC.appGetInfo) as Promise<AppInfo>,
    getFarmerState: () => ipcRenderer.invoke(IPC.farmerGetState) as Promise<FarmerState>,
    pickAccountsFile: () => ipcRenderer.invoke(IPC.farmerPickAccountsFile) as Promise<PickResult>,
    startRun: () => ipcRenderer.invoke(IPC.farmerStart) as Promise<ActionResult>,
    stopRun: () => ipcRenderer.invoke(IPC.farmerStop) as Promise<ActionResult>,
    createEngineConfig: () => ipcRenderer.invoke(IPC.farmerCreateConfig) as Promise<ActionResult>,
    repairEngineConfig: () => ipcRenderer.invoke(IPC.farmerRepairConfig) as Promise<ActionResult>,
    restartEngine: () => ipcRenderer.invoke(IPC.farmerRestartEngine) as Promise<ActionResult>,
    setTimer: (enabled, time) =>
        ipcRenderer.invoke(IPC.farmerSetTimer, enabled, time) as Promise<ActionResult>,
    onFarmerState: (callback) => {
        const listener = (_event: IpcRendererEvent, state: FarmerState) => callback(state)
        ipcRenderer.on(IPC.farmerStateChanged, listener)
        return () => {
            ipcRenderer.removeListener(IPC.farmerStateChanged, listener)
        }
    },
    getAccountsState: () => ipcRenderer.invoke(ACCOUNTS_IPC.getState) as Promise<AccountsState>,
    addAccount: (input: AccountInput) => ipcRenderer.invoke(ACCOUNTS_IPC.add, input) as Promise<ActionResult>,
    updateAccount: (slot: number, expectedEmail: string, input: AccountInput) =>
        ipcRenderer.invoke(ACCOUNTS_IPC.update, slot, expectedEmail, input) as Promise<ActionResult>,
    removeAccount: (slot: number, expectedEmail: string) =>
        ipcRenderer.invoke(ACCOUNTS_IPC.remove, slot, expectedEmail) as Promise<ActionResult>,
    getEngineSettingsState: () =>
        ipcRenderer.invoke(ENGINE_SETTINGS_IPC.getState) as Promise<EngineSettingsState>,
    saveEngineSettings: (values: EngineSettingsValues) =>
        ipcRenderer.invoke(ENGINE_SETTINGS_IPC.save, values) as Promise<ActionResult>,
    resetEngineSettings: () => ipcRenderer.invoke(ENGINE_SETTINGS_IPC.reset) as Promise<ActionResult>,
    getSecretsState: () => ipcRenderer.invoke(SECRETS_IPC.getState) as Promise<SecretsState>,
    setSecret: (id: SecretId, value: string) =>
        ipcRenderer.invoke(SECRETS_IPC.set, id, value) as Promise<ActionResult>,
    clearSecret: (id: SecretId) => ipcRenderer.invoke(SECRETS_IPC.clear, id) as Promise<ActionResult>,
    getNotificationsState: () =>
        ipcRenderer.invoke(NOTIFICATIONS_IPC.getState) as Promise<NotificationsState>,
    setNotificationEnabled: (id: NotifyChannelId, enabled: boolean) =>
        ipcRenderer.invoke(NOTIFICATIONS_IPC.setEnabled, id, enabled) as Promise<ActionResult>,
    sendTestNotification: (id: NotifyChannelId) =>
        ipcRenderer.invoke(NOTIFICATIONS_IPC.sendTest, id) as Promise<NotifyTestResult>,
    getLogsState: () => ipcRenderer.invoke(LOGS_IPC.getState) as Promise<LogsState>,
    refreshLogs: () => ipcRenderer.invoke(LOGS_IPC.refresh) as Promise<ActionResult>,
    exportLogs: (filter: LogsFilter) => ipcRenderer.invoke(LOGS_IPC.export, filter) as Promise<ActionResult>,
    runHealthChecks: () => ipcRenderer.invoke(HEALTH_IPC.run) as Promise<HealthState>,
    exportDiagnostics: () => ipcRenderer.invoke(DIAGNOSTICS_IPC.export) as Promise<ActionResult>,
    getBackupsState: () => ipcRenderer.invoke(BACKUP_IPC.getState) as Promise<BackupListResult>,
    createBackup: () => ipcRenderer.invoke(BACKUP_IPC.create) as Promise<BackupCreateResult>,
    inspectBackup: (id: string) => ipcRenderer.invoke(BACKUP_IPC.inspect, id) as Promise<BackupInspectResult>,
    openBackupFolder: () => ipcRenderer.invoke(BACKUP_IPC.openFolder) as Promise<ActionResult>,
    previewRestore: (id: string) =>
        ipcRenderer.invoke(RESTORE_IPC.preview, id) as Promise<RestorePreviewResult>,
    prepareRestore: (id: string) =>
        ipcRenderer.invoke(RESTORE_IPC.prepare, id) as Promise<RestorePrepareResult>,
    applyRestore: (id: string, confirmed: boolean) =>
        ipcRenderer.invoke(RESTORE_IPC.apply, id, confirmed) as Promise<RestoreApplyResult>,
    getRestoreHistory: () => ipcRenderer.invoke(RESTORE_IPC.history) as Promise<RestoreHistory>,
    undoRestore: (confirmed: boolean) =>
        ipcRenderer.invoke(RESTORE_IPC.undo, confirmed) as Promise<RestoreUndoResult>,
    wizardIsFirstRun: () => ipcRenderer.invoke(WIZARD_IPC.isFirstRun) as Promise<boolean>,
    wizardGetState: () => ipcRenderer.invoke(WIZARD_IPC.getState) as Promise<WizardState>,
    wizardReset: () => ipcRenderer.invoke(WIZARD_IPC.reset) as Promise<WizardState>,
    wizardCheckPrerequisites: () =>
        ipcRenderer.invoke(WIZARD_IPC.checkPrerequisites) as Promise<PrerequisitesResult>,
    wizardChooseAccounts: (source: 'default' | 'pick') =>
        ipcRenderer.invoke(WIZARD_IPC.chooseAccounts, source) as Promise<AccountsStepResult>,
    wizardSetSettings: (settings: BasicSettings) =>
        ipcRenderer.invoke(WIZARD_IPC.setSettings, settings) as Promise<SettingsStepResult>,
    wizardReview: () => ipcRenderer.invoke(WIZARD_IPC.review) as Promise<WizardReviewResult>,
    wizardFinish: (confirmed: boolean) =>
        ipcRenderer.invoke(WIZARD_IPC.finish, confirmed) as Promise<WizardFinishResult>,
    getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<PersistedSettings>,
    setThemeMode: (mode: ThemeModeSetting) => ipcRenderer.invoke(IPC.settingsSetTheme, mode) as Promise<void>,
    setShutdownAfterRun: (enabled: boolean) =>
        ipcRenderer.invoke(IPC.settingsSetShutdown, enabled) as Promise<ActionResult>
}

contextBridge.exposeInMainWorld('farmerShell', api)
