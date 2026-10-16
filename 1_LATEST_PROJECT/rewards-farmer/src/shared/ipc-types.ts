import type { AccountsApi } from './accounts-types'
import type { BackupsApi } from './backup-types'
import type { RestoreApi } from './restore-types'
import type { DiagnosticsApi } from './diagnostics-types'
import type { EngineSettingsApi } from './engine-settings-types'
import type { HealthApi } from './health-types'
import type { LogsApi } from './logs-types'
import type { NotificationsApi } from './notifications-types'
import type { SecretsApi } from './secrets-types'
import type { WizardApi } from './wizard-types'
import type { AppInfo } from './app-info'
import type { ActionResult, FarmerState, PersistedSettings, ThemeModeSetting } from './farmer-types'

// Every IPC channel is named here. No generic "invoke anything" passthrough (docs/architecture.md section 8).
export const IPC = {
    appGetInfo: 'app:get-info',
    farmerGetState: 'farmer:get-state',
    farmerPickAccountsFile: 'farmer:pick-accounts-file',
    farmerStart: 'farmer:start',
    farmerStop: 'farmer:stop',
    farmerCreateConfig: 'farmer:create-config',
    farmerRepairConfig: 'farmer:repair-config',
    farmerRestartEngine: 'farmer:restart-engine',
    farmerSetTimer: 'farmer:set-timer',
    farmerStateChanged: 'farmer:state-changed',
    settingsGet: 'settings:get',
    settingsSetTheme: 'settings:set-theme',
    settingsSetShutdown: 'settings:set-shutdown-after-run'
} as const

export interface PickResult {
    // true when the user closed the file dialog without choosing.
    readonly cancelled: boolean
    readonly result: ActionResult
}

export interface FarmerShellApi
    extends
        AccountsApi,
        EngineSettingsApi,
        SecretsApi,
        NotificationsApi,
        LogsApi,
        HealthApi,
        DiagnosticsApi,
        BackupsApi,
        RestoreApi,
        WizardApi {
    getAppInfo(): Promise<AppInfo>
    getFarmerState(): Promise<FarmerState>
    // Opens the native file dialog in the main process. The renderer never sends a file path.
    pickAccountsFile(): Promise<PickResult>
    startRun(): Promise<ActionResult>
    stopRun(): Promise<ActionResult>
    createEngineConfig(): Promise<ActionResult>
    repairEngineConfig(): Promise<ActionResult>
    restartEngine(): Promise<ActionResult>
    setTimer(enabled: boolean, time: string): Promise<ActionResult>
    // Returns an unsubscribe function.
    onFarmerState(callback: (state: FarmerState) => void): () => void
    getSettings(): Promise<PersistedSettings>
    setThemeMode(mode: ThemeModeSetting): Promise<void>
    setShutdownAfterRun(enabled: boolean): Promise<ActionResult>
}

declare global {
    interface Window {
        // Present only when the page runs inside the Electron window (preload exposes it).
        farmerShell?: FarmerShellApi
    }
}
