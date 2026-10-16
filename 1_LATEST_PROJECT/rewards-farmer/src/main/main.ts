import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../shared/app-info'
import { DEFAULT_SETTINGS } from '../shared/farmer-types'
import { IPC } from '../shared/ipc-types'
import { AccountsService } from './accounts'
import { AppSettingsStore } from './appSettings'
import { BackupService } from './backupService'
import { RestoreService } from './restoreService'
import { DiagnosticsService } from './diagnosticsService'
import { EngineSettingsService } from './engineSettings'
import { Redactor } from './engine/redact'
import { EngineSupervisor } from './engine/supervisor'
import { FarmerService } from './farmer'
import { registerIpc } from './ipc'
import { HealthService } from './healthService'
import { LogService } from './logService'
import { NotificationsService } from './notifications'
import { SecretsService } from './secrets'
import { SetupWizardService } from './setupWizard'
import { JsonlLog } from './jsonlLog'
import { createMainWindow } from './window'

app.setName(APP_NAME)

// Single instance lock (docs/architecture.md section 4, step 1).
if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    let main: BrowserWindow | null = null
    let quitting = false

    const userData = app.getPath('userData')
    const logsDir = join(userData, 'logs')
    const redactor = new Redactor()
    const redact = (text: string) => redactor.redact(text)
    const appLog = new JsonlLog(logsDir, 'app.log', 'app', redact)
    const audit = new JsonlLog(logsDir, 'audit.log', 'audit', redact)
    const engineLog = new JsonlLog(logsDir, 'engine.log', 'engine', redact)
    const errorsLog = new JsonlLog(logsDir, 'errors.log', 'engine', redact)
    const settings = new AppSettingsStore(userData)
    // Development: <project>/engine. Packaged builds (Phase 14) will ship it under resources/engine.
    const engineRoot = app.isPackaged
        ? join(process.resourcesPath, 'engine')
        : join(app.getAppPath(), 'engine')

    const supervisor = new EngineSupervisor({
        engineRoot,
        redact,
        pidFile: join(userData, 'engine.pid'),
        log: (level, message) => appLog.write({ level, component: 'EngineSupervisor', message }),
        shutdownGraceMs: 20000 // engine waits up to 15 s for its bot to stop
    })

    // One file dialog for the Home page and for the setup wizard. The path never comes from the screen.
    const pickAccountsFile = async (): Promise<string | null> => {
        const options = {
            title: 'Choose your accounts file (.env)',
            properties: ['openFile' as const],
            filters: [
                { name: 'Accounts file (.env)', extensions: ['env'] },
                { name: 'All files', extensions: ['*'] }
            ]
        }
        const result =
            main !== null ? await dialog.showOpenDialog(main, options) : await dialog.showOpenDialog(options)
        return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0]
    }

    const farmer = new FarmerService({
        engineRoot,
        settings,
        supervisor,
        audit,
        appLog,
        redactor,
        // "Shutdown" setting: close this app after a clean run (the before-quit hook below stops the engine first).
        onShutdownRequested: () => app.quit(),
        defaultAccountsPath: join(userData, 'accounts.env'),
        pickAccountsFile
    })

    const accounts = new AccountsService({
        host: {
            accountsPath: () => farmer.accountsPath(),
            editBlock: () => farmer.accountsEditBlock(),
            editAccounts: (work) => farmer.editAccounts(work)
        },
        redactor,
        audit,
        appLog,
        // Backup copies of the accounts file. They contain secrets, so they stay in the app's private user-data folder.
        backupDir: join(userData, 'backups', 'accounts')
    })

    const engineSettings = new EngineSettingsService({
        host: {
            api: () => farmer.engineApi(),
            editBlock: () => farmer.settingsEditBlock(),
            run: (work) => farmer.editEngineConfig(work)
        },
        engineRoot,
        audit,
        appLog,
        // Backup copies of the engine config.json. It can hold secrets (webhook tokens), so it stays in the private user-data folder.
        backupDir: join(userData, 'backups', 'config')
    })

    const secrets = new SecretsService({
        host: {
            api: () => farmer.engineApi(),
            editBlock: () => farmer.settingsEditBlock(),
            run: (work) => farmer.editEngineConfig(work)
        },
        engineRoot,
        redactor,
        audit,
        appLog,
        backupDir: join(userData, 'backups', 'config')
    })

    // Notifications (Phase 16). Reads the same config.json as Secrets. It sends nothing on its own: only a test the user asks for.
    const notifications = new NotificationsService({
        host: {
            api: () => farmer.engineApi(),
            editBlock: () => farmer.settingsEditBlock(),
            run: (work) => farmer.editEngineConfig(work)
        },
        engineRoot,
        redactor,
        audit,
        appLog,
        backupDir: join(userData, 'backups', 'config')
    })

    const logs = new LogService({
        api: () => farmer.engineApi(),
        redact,
        engineLog,
        errorsLog,
        audit,
        appLog,
        pickSavePath: async (defaultName) => {
            const options = {
                title: 'Export logs',
                defaultPath: join(app.getPath('documents'), defaultName),
                filters: [{ name: 'Text file', extensions: ['txt'] }]
            }
            const result =
                main !== null
                    ? await dialog.showSaveDialog(main, options)
                    : await dialog.showSaveDialog(options)
            return result.canceled || result.filePath === undefined || result.filePath === ''
                ? null
                : result.filePath
        }
    })

    const health = new HealthService({
        engineRoot,
        dataDir: userData,
        appInfo: () => ({
            name: APP_NAME,
            version: app.getVersion(),
            electron: process.versions.electron,
            platform: process.platform
        }),
        accounts: () => farmer.getState().accounts,
        engine: () => supervisor.snapshot(),
        api: () => farmer.engineApi(),
        redact,
        appLog
    })

    const diagnostics = new DiagnosticsService({
        appInfo: () => ({
            name: APP_NAME,
            version: app.getVersion(),
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            isPackaged: app.isPackaged
        }),
        engineRoot,
        logsDir,
        // The engine commit this app was made for. Shipped next to the app files (Phase 43 will decide the packaged place).
        enginePinPath: app.isPackaged ? null : join(app.getAppPath(), 'ENGINE_PIN'),
        settings: () => settings.value,
        farmerState: () => farmer.getState(),
        runHealth: () => health.runChecks(),
        redact,
        containsKnownSecret: (text) => redactor.containsKnownSecret(text),
        audit,
        appLog,
        pickSavePath: async (defaultName) => {
            const options = {
                title: 'Export diagnostics bundle',
                defaultPath: join(app.getPath('documents'), defaultName),
                filters: [{ name: 'ZIP file', extensions: ['zip'] }]
            }
            const result =
                main !== null
                    ? await dialog.showSaveDialog(main, options)
                    : await dialog.showSaveDialog(options)
            return result.canceled || result.filePath === undefined || result.filePath === ''
                ? null
                : result.filePath
        }
    })

    // Backups (Phase 19). Reads three of the user's own files and writes only inside <userData>/backups/full (private to the
    // current user). Nothing runs on its own: only the Create backup button starts a backup.
    const backups = new BackupService({
        sources: {
            engineConfigPath: join(engineRoot, 'config.json'),
            appSettingsPath: join(userData, 'app-settings.json'),
            accountsPath: () => farmer.accountsPath()
        },
        backupRoot: join(userData, 'backups', 'full'),
        appVersion: app.getVersion(),
        redactor,
        audit,
        appLog,
        openPath: (path) => shell.openPath(path)
    })

    // Restore (Phases 20 and 21). Checks a backup, shows the plan and saves a safety copy of the current files into
    // <userData>/backups/pre-restore (private to the current user, apart from the normal backups). Phase 21 adds `apply`
    // and `undo`, the only two calls that write a user file; both need an explicit confirmation and run while the app is
    // marked busy.
    const preRestore = new BackupService({
        sources: {
            engineConfigPath: join(engineRoot, 'config.json'),
            appSettingsPath: join(userData, 'app-settings.json'),
            accountsPath: () => farmer.accountsPath()
        },
        backupRoot: join(userData, 'backups', 'pre-restore'),
        appVersion: app.getVersion(),
        redactor,
        audit,
        appLog
    })
    const restore = new RestoreService({
        backups,
        snapshots: preRestore,
        targets: {
            engineConfigPath: join(engineRoot, 'config.json'),
            appSettingsPath: join(userData, 'app-settings.json'),
            accountsPath: () => farmer.accountsPath()
        },
        // Phase 21: the record of the last restore (no secret in it), next to the two backup folders.
        journalPath: join(userData, 'backups', 'restore-journal.json'),
        appVersion: app.getVersion(),
        settingsSchema: DEFAULT_SETTINGS.schemaVersion,
        runBlock: () => farmer.restoreBlock(),
        exclusive: (work, refused) => farmer.runRestoreExclusive(work, refused),
        afterFilesChanged: () => farmer.reloadAfterRestore(),
        redactor,
        audit,
        appLog
    })

    // First-run setup wizard (Phase 22). It applies its choices only through the app's own functions (FarmerService, the timer,
    // the settings store, EngineSettingsService) and only after the user confirms on the last step.
    const wizard = new SetupWizardService({
        health: { runChecks: () => health.runChecks() },
        pickAccountsFile,
        defaultAccountsPath: join(userData, 'accounts.env'),
        currentAccountsPath: () => farmer.accountsPath(),
        markerPath: join(userData, 'setup-wizard.json'),
        host: {
            useAccountsFile: (path) => farmer.useAccountsFile(path),
            setTimer: (enabled, time) => farmer.setTimer(enabled, time),
            setTheme: async (mode) => {
                try {
                    await settings.update({ themeMode: mode })
                    return { ok: true, message: 'Theme saved.' }
                } catch (e) {
                    return {
                        ok: false,
                        code: 'WRITE_FAILED',
                        message: `Could not save the theme (${e instanceof Error ? e.message : 'unknown error'}).`
                    }
                }
            },
            setHeadless: (headless) => engineSettings.setHeadless(headless)
        },
        runBlock: () => farmer.wizardBlock(),
        redactor,
        audit,
        appLog
    })

    farmer.onChange((state) => {
        if (main !== null && !main.isDestroyed()) main.webContents.send(IPC.farmerStateChanged, state)
    })

    app.on('second-instance', () => {
        if (main === null) return
        if (main.isMinimized()) main.restore()
        main.focus()
    })

    // Never leave an orphan engine or bot behind (docs/architecture.md section 4 step 7, threat model T8).
    app.on('before-quit', (event) => {
        if (quitting) return
        quitting = true
        event.preventDefault()
        // Engine first (its last log lines arrive while it stops), then the log reader.
        void farmer
            .dispose()
            .catch(() => undefined)
            .then(() => logs.stop())
            .catch(() => undefined)
            .finally(() => app.quit())
    })

    void app.whenReady().then(async () => {
        registerIpc({
            farmer,
            accounts,
            engineSettings,
            secrets,
            notifications,
            logs,
            health,
            diagnostics,
            backups,
            restore,
            wizard,
            settings,
            getWindow: () => main
        })
        main = createMainWindow()
        main.on('closed', () => {
            main = null
        })
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) main = createMainWindow()
        })
        appLog.write({ level: 'info', component: 'App', message: `started (engine root: ${engineRoot})` })
        logs.start()
        // BEFORE init: init creates the app's own accounts file, after which every start would look like a used app.
        await wizard.detectFirstRun().catch(() => false)
        await farmer.init()
    })

    app.on('window-all-closed', () => app.quit())
}
