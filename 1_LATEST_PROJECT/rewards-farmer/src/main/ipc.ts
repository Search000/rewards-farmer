import { app, ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { ACCOUNTS_IPC } from '../shared/accounts-types'
import type { AccountsState } from '../shared/accounts-types'
import { APP_NAME } from '../shared/app-info'
import { BACKUP_IPC } from '../shared/backup-types'
import { RESTORE_IPC } from '../shared/restore-types'
import type {
    RestoreApplyResult,
    RestoreHistory,
    RestorePrepareResult,
    RestorePreviewResult,
    RestoreUndoResult
} from '../shared/restore-types'
import type { BackupCreateResult, BackupInspectResult, BackupListResult } from '../shared/backup-types'
import { DIAGNOSTICS_IPC } from '../shared/diagnostics-types'
import { ENGINE_SETTINGS_IPC } from '../shared/engine-settings-types'
import type { EngineSettingsState } from '../shared/engine-settings-types'
import type { AppInfo } from '../shared/app-info'
import { isValidTime } from '../shared/farmer-types'
import type { ActionResult, PersistedSettings } from '../shared/farmer-types'
import { IPC } from '../shared/ipc-types'
import type { PickResult } from '../shared/ipc-types'
import { HEALTH_IPC } from '../shared/health-types'
import type { HealthState } from '../shared/health-types'
import { LOGS_IPC } from '../shared/logs-types'
import type { LogsState } from '../shared/logs-types'
import { NOTIFICATIONS_IPC } from '../shared/notifications-types'
import type { NotificationsState, NotifyTestResult } from '../shared/notifications-types'
import { SECRETS_IPC } from '../shared/secrets-types'
import type { SecretsState } from '../shared/secrets-types'
import { WIZARD_IPC } from '../shared/wizard-types'
import type {
    AccountsStepResult,
    PrerequisitesResult,
    SettingsStepResult,
    WizardFinishResult,
    WizardReviewResult,
    WizardState
} from '../shared/wizard-types'
import type { AccountsService } from './accounts'
import type { AppSettingsStore } from './appSettings'
import type { BackupService } from './backupService'
import type { RestoreService } from './restoreService'
import type { DiagnosticsService } from './diagnosticsService'
import type { EngineSettingsService } from './engineSettings'
import type { FarmerService } from './farmer'
import type { HealthService } from './healthService'
import type { LogService } from './logService'
import type { NotificationsService } from './notifications'
import type { SecretsService } from './secrets'
import type { SetupWizardService } from './setupWizard'

interface IpcDeps {
    readonly farmer: FarmerService
    readonly accounts: AccountsService
    readonly engineSettings: EngineSettingsService
    readonly secrets: SecretsService
    readonly notifications: NotificationsService
    readonly logs: LogService
    readonly health: HealthService
    readonly diagnostics: DiagnosticsService
    readonly backups: BackupService
    readonly restore: RestoreService
    readonly wizard: SetupWizardService
    readonly settings: AppSettingsStore
    readonly getWindow: () => BrowserWindow | null
}

const bad = (message: string): ActionResult => ({ ok: false, code: 'BAD_REQUEST', message })

// Only the app's own window may call us (threat model T5, T11).
function trusted(event: IpcMainInvokeEvent, deps: IpcDeps): boolean {
    const win = deps.getWindow()
    return win !== null && !win.isDestroyed() && event.sender === win.webContents
}

export function registerIpc(deps: IpcDeps): void {
    const guard =
        <A extends unknown[], R>(fallback: R, fn: (...args: A) => Promise<R> | R) =>
        async (event: IpcMainInvokeEvent, ...args: A): Promise<R> =>
            trusted(event, deps) ? fn(...args) : fallback

    ipcMain.handle(
        IPC.appGetInfo,
        guard<[], AppInfo>(
            { name: APP_NAME, version: '', platform: '', electron: '', chrome: '', isPackaged: false },
            () => ({
                name: APP_NAME,
                version: app.getVersion(),
                platform: process.platform,
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                isPackaged: app.isPackaged
            })
        )
    )
    ipcMain.handle(IPC.farmerGetState, (event: IpcMainInvokeEvent) => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.farmer.getState()
    })
    ipcMain.handle(
        IPC.farmerPickAccountsFile,
        guard<[], PickResult>({ cancelled: false, result: bad('Untrusted sender.') }, () =>
            deps.farmer.pickAccounts()
        )
    )
    ipcMain.handle(
        IPC.farmerStart,
        guard<[], ActionResult>(bad('Untrusted sender.'), () => deps.farmer.startRun('user'))
    )
    ipcMain.handle(
        IPC.farmerStop,
        guard<[], ActionResult>(bad('Untrusted sender.'), () => deps.farmer.stopRun())
    )
    ipcMain.handle(
        IPC.farmerCreateConfig,
        guard<[], ActionResult>(bad('Untrusted sender.'), () => deps.farmer.createConfig())
    )
    ipcMain.handle(
        IPC.farmerRepairConfig,
        guard<[], ActionResult>(bad('Untrusted sender.'), () => deps.farmer.repairConfig())
    )
    ipcMain.handle(
        IPC.farmerRestartEngine,
        guard<[], ActionResult>(bad('Untrusted sender.'), () => deps.farmer.restartEngine())
    )
    ipcMain.handle(
        IPC.farmerSetTimer,
        guard<[unknown, unknown], ActionResult>(bad('Untrusted sender.'), (enabled, time) => {
            // Input validated in main (docs/architecture.md section 8).
            if (typeof enabled !== 'boolean' || typeof time !== 'string' || !isValidTime(time))
                return bad('Invalid timer values.')
            return deps.farmer.setTimer(enabled, time)
        })
    )
    ipcMain.handle(
        IPC.settingsGet,
        guard<[], PersistedSettings>(deps.settings.value, () => deps.settings.value)
    )
    ipcMain.handle(
        IPC.settingsSetShutdown,
        guard<[unknown], ActionResult>(bad('Untrusted sender.'), (enabled) => {
            if (typeof enabled !== 'boolean') return bad('Invalid Shutdown value.')
            return deps.farmer.setShutdownAfterRun(enabled)
        })
    )
    ipcMain.handle(
        IPC.settingsSetTheme,
        guard<[unknown], void>(undefined, async (mode) => {
            if (mode === 'dark' || mode === 'light') await deps.settings.update({ themeMode: mode })
        })
    )

    // Accounts screen (Phase 7). The renderer sends untrusted data; AccountsService validates every field itself.
    ipcMain.handle(ACCOUNTS_IPC.getState, (event: IpcMainInvokeEvent): Promise<AccountsState> => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.accounts.getState()
    })
    ipcMain.handle(
        ACCOUNTS_IPC.add,
        guard<[unknown], ActionResult>(bad('Untrusted sender.'), (input) => deps.accounts.add(input))
    )
    ipcMain.handle(
        ACCOUNTS_IPC.update,
        guard<[unknown, unknown, unknown], ActionResult>(bad('Untrusted sender.'), (slot, email, input) =>
            deps.accounts.update(slot, email, input)
        )
    )
    ipcMain.handle(
        ACCOUNTS_IPC.remove,
        guard<[unknown, unknown], ActionResult>(bad('Untrusted sender.'), (slot, email) =>
            deps.accounts.remove(slot, email)
        )
    )

    // Settings screen (Phase 8). The renderer sends untrusted data; EngineSettingsService validates the exact shape itself.
    ipcMain.handle(
        ENGINE_SETTINGS_IPC.getState,
        (event: IpcMainInvokeEvent): Promise<EngineSettingsState> => {
            if (!trusted(event, deps)) throw new Error('Untrusted sender.')
            return deps.engineSettings.getState()
        }
    )
    ipcMain.handle(
        ENGINE_SETTINGS_IPC.save,
        guard<[unknown], ActionResult>(bad('Untrusted sender.'), (values) => deps.engineSettings.save(values))
    )
    ipcMain.handle(
        ENGINE_SETTINGS_IPC.reset,
        guard<[], ActionResult>(bad('Untrusted sender.'), () => deps.engineSettings.reset())
    )

    // Secrets (Phase 10). Write-only: the state carries set / not set, never a value. The renderer is untrusted, so
    // SecretsService validates the id and the value itself.
    ipcMain.handle(SECRETS_IPC.getState, (event: IpcMainInvokeEvent): Promise<SecretsState> => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.secrets.getState()
    })
    ipcMain.handle(
        SECRETS_IPC.set,
        guard<[unknown, unknown], ActionResult>(bad('Untrusted sender.'), (id, value) =>
            deps.secrets.set(id, value)
        )
    )
    ipcMain.handle(
        SECRETS_IPC.clear,
        guard<[unknown], ActionResult>(bad('Untrusted sender.'), (id) => deps.secrets.clear(id))
    )

    // Notifications (Phase 16). The state carries on / off / problems only, never an address or token. The renderer is
    // untrusted, so NotificationsService validates the channel id itself.
    ipcMain.handle(NOTIFICATIONS_IPC.getState, (event: IpcMainInvokeEvent): Promise<NotificationsState> => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.notifications.getState()
    })
    ipcMain.handle(
        NOTIFICATIONS_IPC.setEnabled,
        guard<[unknown, unknown], ActionResult>(bad('Untrusted sender.'), (id, enabled) =>
            deps.notifications.setEnabled(id, enabled)
        )
    )
    ipcMain.handle(
        NOTIFICATIONS_IPC.sendTest,
        guard<[unknown], NotifyTestResult>(
            { ...bad('Untrusted sender.'), channel: null, outcome: 'failed', requestMade: false },
            (id) => deps.notifications.sendTest(id)
        )
    )

    // Logs (Phase 11). Read-only plus Refresh and Export. Export takes a filter only; main chooses the path via a save dialog.
    ipcMain.handle(LOGS_IPC.getState, (event: IpcMainInvokeEvent): LogsState => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.logs.getState()
    })
    ipcMain.handle(
        LOGS_IPC.refresh,
        guard<[], ActionResult>(bad('Untrusted sender.'), () => deps.logs.refresh())
    )
    ipcMain.handle(
        LOGS_IPC.export,
        guard<[unknown], ActionResult>(bad('Untrusted sender.'), (filter) => deps.logs.exportLogs(filter))
    )

    // Health panel (Phase 12). Takes no argument: the renderer cannot pick a path or a command. Runs the real checks now.
    ipcMain.handle(HEALTH_IPC.run, (event: IpcMainInvokeEvent): Promise<HealthState> => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.health.runChecks()
    })

    // Diagnostics bundle (Phase 14). Takes NO argument: the renderer cannot pick a path, a file to include or what to leave out.
    // Main shows the save dialog, builds the cleaned bundle, checks it for secrets and only then writes it.
    ipcMain.handle(
        DIAGNOSTICS_IPC.export,
        guard<[], ActionResult>(bad('Untrusted sender.'), () => deps.diagnostics.exportBundle())
    )

    // Backups (Phase 19). No handler takes a path: the backup folder is fixed in main. `create` and `openFolder` take NO
    // argument; `inspect` takes one id that BackupService checks against the strict backup-id format itself (the renderer
    // is untrusted). Nothing here returns a file's content, a secret or a folder path.
    ipcMain.handle(BACKUP_IPC.getState, (event: IpcMainInvokeEvent): Promise<BackupListResult> => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.backups.list()
    })
    ipcMain.handle(
        BACKUP_IPC.create,
        guard<[], BackupCreateResult>(
            { ok: false, code: 'BAD_REQUEST', message: 'Untrusted sender.', reason: 'unknown', fix: '' },
            () => deps.backups.create()
        )
    )
    ipcMain.handle(
        BACKUP_IPC.inspect,
        guard<[unknown], BackupInspectResult>(
            { ok: false, code: 'BAD_REQUEST', message: 'Untrusted sender.' },
            (id) => deps.backups.inspect(id)
        )
    )
    ipcMain.handle(
        BACKUP_IPC.openFolder,
        guard<[], ActionResult>(bad('Untrusted sender.'), () => deps.backups.openFolder())
    )

    // Restore, part 1 (Phase 20). Both calls take ONE backup id and nothing else (no path, no file name, no content). Neither
    // changes a user file: `preview` only reads, `prepare` reads and writes the safety copy into the private pre-restore folder.
    // The id is checked against the strict backup-id format inside BackupService (the renderer is untrusted).
    const untrustedRestore = (): RestorePreviewResult & RestorePrepareResult => ({
        ok: false,
        stage: 'rejected',
        code: 'BAD_REQUEST',
        message: 'Untrusted sender.',
        fix: 'Close the app and open it again with START.bat, then try again.',
        problems: [],
        preview: null,
        userFilesUntouched: true
    })
    ipcMain.handle(
        RESTORE_IPC.preview,
        guard<[unknown], RestorePreviewResult>(untrustedRestore(), (id) => deps.restore.preview(id))
    )
    ipcMain.handle(
        RESTORE_IPC.prepare,
        guard<[unknown], RestorePrepareResult>(untrustedRestore(), (id) => deps.restore.prepare(id))
    )

    // Restore, part 2 (Phase 21). `apply` takes a backup id and the confirmation; `undo` takes only the confirmation; `history`
    // takes nothing. Still no path, no file name and no content comes from the renderer. The service itself refuses unless the
    // confirmation is exactly `true` (the renderer is untrusted), and checks everything again from scratch.
    ipcMain.handle(
        RESTORE_IPC.apply,
        guard<[unknown, unknown], RestoreApplyResult>(
            {
                ok: false,
                stage: 'rejected',
                code: 'BAD_REQUEST',
                message: 'Untrusted sender.',
                fix: 'Close the app and open it again with START.bat, then try again.',
                problems: [],
                preview: null,
                filesState: 'untouched'
            },
            (id, confirmed) => deps.restore.apply(id, confirmed)
        )
    )
    ipcMain.handle(RESTORE_IPC.history, (event: IpcMainInvokeEvent): Promise<RestoreHistory> => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.restore.history()
    })
    ipcMain.handle(
        RESTORE_IPC.undo,
        guard<[unknown], RestoreUndoResult>(
            {
                ok: false,
                stage: 'blocked',
                code: 'BAD_REQUEST',
                message: 'Untrusted sender.',
                fix: 'Close the app and open it again with START.bat, then try again.',
                filesState: 'untouched'
            },
            (confirmed) => deps.restore.undo(confirmed)
        )
    )

    // First-run setup wizard (Phase 22). No handler takes a path or a file name: `chooseAccounts` takes one word ('default' or
    // 'pick'; the file dialog is opened by main), `setSettings` takes four plain values, `finish` takes the confirmation. The
    // service checks every value again itself (the renderer is untrusted) and refuses `finish` unless the confirmation is exactly `true`.
    const untrustedWizard = {
        ok: false as const,
        stage: 'bad-request' as const,
        message: 'Untrusted sender.',
        fix: 'Close the app and open it again with START.bat, then try again.',
        cancelled: false
    }
    ipcMain.handle(WIZARD_IPC.isFirstRun, (event: IpcMainInvokeEvent): boolean => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.wizard.needsWizard()
    })
    ipcMain.handle(WIZARD_IPC.getState, (event: IpcMainInvokeEvent): WizardState => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.wizard.getState()
    })
    ipcMain.handle(WIZARD_IPC.reset, (event: IpcMainInvokeEvent): WizardState => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.wizard.reset()
    })
    ipcMain.handle(
        WIZARD_IPC.checkPrerequisites,
        (event: IpcMainInvokeEvent): Promise<PrerequisitesResult> => {
            if (!trusted(event, deps)) throw new Error('Untrusted sender.')
            return deps.wizard.checkPrerequisites()
        }
    )
    ipcMain.handle(
        WIZARD_IPC.chooseAccounts,
        guard<[unknown], AccountsStepResult>(untrustedWizard, (source) => deps.wizard.chooseAccounts(source))
    )
    ipcMain.handle(
        WIZARD_IPC.setSettings,
        guard<[unknown], SettingsStepResult>({ ...untrustedWizard, errors: {} }, (raw) =>
            deps.wizard.setBasicSettings(raw)
        )
    )
    ipcMain.handle(WIZARD_IPC.review, (event: IpcMainInvokeEvent): WizardReviewResult => {
        if (!trusted(event, deps)) throw new Error('Untrusted sender.')
        return deps.wizard.review()
    })
    ipcMain.handle(
        WIZARD_IPC.finish,
        guard<[unknown], WizardFinishResult>({ ...untrustedWizard, doneSteps: [] }, (confirmed) =>
            deps.wizard.finish(confirmed)
        )
    )
}
