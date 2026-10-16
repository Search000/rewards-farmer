// Types shared by the main process, the preload bridge and the renderer for the Home / Farmer screen (Phase 6).
// Rule 3: every field here is either real engine data, real local state, or null/"unknown". Never a made-up number.

export type ThemeModeSetting = 'dark' | 'light'

// App-level error codes (docs/architecture.md section 9, plus the local ones Phase 6 needs).
export type ErrorCode =
    | 'ACCOUNTS_NOT_SET'
    | 'ACCOUNTS_INVALID'
    | 'ENGINE_MISSING'
    | 'ENGINE_NOT_BUILT'
    | 'CONFIG_MISSING'
    | 'NODE_MISSING'
    | 'ENGINE_DOWN'
    | 'ENGINE_START_FAILED'
    | 'BAD_REQUEST'
    | 'AUTH'
    | 'WRITE_DISABLED'
    | 'NOT_FOUND'
    | 'RUN_ACTIVE'
    | 'NOT_RUNNING'
    | 'CONFIG_INVALID'
    | 'ENGINE_ERROR'
    | 'INVALID_TIME'
    | 'WRITE_FAILED'
    | 'EXPORT_BLOCKED'
    | 'EXPORT_FAILED'
    | 'READ_FAILED'
    | 'BACKUP_EMPTY'

export interface ActionResult {
    readonly ok: boolean
    readonly code?: ErrorCode | undefined
    readonly message: string
}

// State of the engine API child process, as seen by the supervisor.
export type EngineLink = 'not-started' | 'starting' | 'ready' | 'down' | 'failed'
// State of the bot run, copied from the engine (`/status.state`). 'unknown' = engine API not reachable.
export type RunPhase = 'unknown' | 'idle' | 'starting' | 'running' | 'stopping'

export interface LastExit {
    readonly code: number | null
    readonly signal: string | null
    readonly at: string
    readonly error?: string | undefined
}

export type NoticeAction = 'create-config' | 'restart-engine'

export interface FarmerNotice {
    readonly id: string
    readonly severity: 'info' | 'warning' | 'error'
    readonly message: string
    readonly action?: NoticeAction | undefined
}

export interface FarmerState {
    readonly engine: {
        readonly link: EngineLink
        readonly detail: string | null
        readonly version: string | null
    }
    readonly accounts: {
        readonly path: string | null
        readonly status: 'not-set' | 'ok' | 'error'
        readonly error: string | null
        // Number of ACCOUNT_N_EMAIL entries in the chosen file. Emails themselves never leave main in Phase 6.
        readonly count: number | null
    }
    readonly run: {
        readonly phase: RunPhase
        readonly startedAt: string | null
        readonly lastExit: LastExit | null
    }
    readonly current: {
        readonly account: string | null
        readonly points: number | null
        // Section/Detail = title and message of the newest engine log line of this run. null when not running.
        readonly section: string | null
        readonly detail: string | null
        readonly proxy: string | null
    }
    readonly summary: {
        readonly all: number | null
        readonly finished: number | null
        readonly failed: number | null
    }
    readonly timer: {
        readonly enabled: boolean
        readonly time: string
        readonly nextFireAt: string | null
    }
    // null = the button is allowed. A string = disabled, and this is the reason shown to the user (rule 17).
    readonly startDisabledReason: string | null
    readonly stopDisabledReason: string | null
    readonly notices: readonly FarmerNotice[]
    readonly updatedAt: string
}

// Schema 2 (Phase 8) adds `shutdownAfterRun`. A schema 1 file is backed up before it is rewritten (see appSettings.ts).
export interface PersistedSettings {
    readonly schemaVersion: 2
    readonly themeMode: ThemeModeSetting
    readonly accountsPath: string | null
    readonly timerEnabled: boolean
    readonly timerTime: string
    // Close this app after a run that finished without errors. App-side only, not an engine setting.
    readonly shutdownAfterRun: boolean
}

export const DEFAULT_SETTINGS: PersistedSettings = {
    schemaVersion: 2,
    themeMode: 'dark',
    accountsPath: null,
    timerEnabled: false,
    timerTime: '00:00',
    shutdownAfterRun: false
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export function isValidTime(value: string): boolean {
    return TIME_RE.test(value)
}
