import type { ActionResult } from './farmer-types'

// Types shared by main, preload and renderer for the Settings screen (Phase 8, screenshots 3-4).
// Every value here is a real field of the engine's config.json (docs/configuration-reference.md). Nothing is made up.
// Secrets (webhook tokens, API keys) are NOT part of Phase 8 or 9; they come in Phase 10 with their own masked handling.
// Phase 9 adds login / check-in, timing and search options (still no secrets, still no protection-evasion fields).

export const ENGINE_SETTINGS_IPC = {
    getState: 'engine-settings:get-state',
    save: 'engine-settings:save',
    reset: 'engine-settings:reset'
} as const

export type LogLevelChoice = 'info' | 'debug'
export type BrowserChoice = 'chromium' | 'msedge'

// One property per control on the screen. The config path of each one is in engine-settings-rules.ts (FIELDS).
export interface EngineSettingsValues {
    readonly logLevel: LogLevelChoice
    readonly browser: BrowserChoice
    readonly headless: boolean
    readonly useProxyForSearchQueries: boolean
    readonly disableImages: boolean
    readonly parallelSearching: boolean
    readonly dailyQuests: boolean
    readonly punchCards: boolean
    readonly moreActivities: boolean
    readonly exploreOnBing: boolean
    readonly pcSearch: boolean
    readonly mobileSearch: boolean
    readonly readToEarn: boolean
    readonly visualSearch: boolean
    // ---- Phase 9: login, check-in and rewards ----
    readonly prewarmDesktopLogin: boolean
    readonly dailyCheckIn: boolean
    readonly streakProtection: boolean
    readonly claimBonusPoints: boolean
    readonly activateSearchPerk: boolean
    readonly appPromotions: boolean
    readonly urlRewards: boolean
    readonly autoClaimPunchCards: boolean
    readonly skipNonPointTasks: boolean
    // ---- Phase 9: timing. Text like "6min" or "50sec" (unit required). ----
    readonly accountDelayMin: string
    readonly accountDelayMax: string
    readonly searchDelayMin: string
    readonly searchDelayMax: string
    readonly readDelayMin: string
    readonly readDelayMax: string
    readonly globalTimeout: string
    readonly searchResultVisitTime: string
    // ---- Phase 9: search options ----
    readonly bonusSearches: boolean
    // Whole number. NaN only while the user has cleared the box in the draft (never saved: validation refuses it).
    readonly maxBonusSearches: number
    readonly runOnZeroPoints: boolean
    readonly clusterSearch: boolean
    readonly localBingQueries: boolean
    // Order matters: the engine builds its search-word pool from these sources in this order.
    readonly queryEngines: readonly string[]
    // ---- Phase 9 (user decision): advanced and experimental ----
    // Number of account processes that run at the same time (engine: clusters).
    readonly clusters: number
    // Turns OFF the TLS certificate check for proxy connections (engine: proxy.ignoreCertificateErrors). Weakens security.
    readonly ignoreCertificateErrors: boolean
    // Engine experimental switches: searches over HTTP instead of the browser.
    readonly apiSearch: boolean
    readonly apiSearchOnBing: boolean
}

// One value of one control.
export type SettingValue = boolean | string | number | readonly string[]

export type SettingKey = keyof EngineSettingsValues

// Why a value cannot be saved, per control. Empty object = all values are fine.
export type SettingErrors = Partial<Record<SettingKey, string>>

export interface EngineSettingsState {
    // ok = values read from the real config. unavailable = engine not running / config missing (reason in `reason`).
    // error = the engine answered but the config could not be used.
    readonly status: 'ok' | 'unavailable' | 'error'
    readonly reason: string | null
    readonly values: EngineSettingsValues | null
    // Values of the engine's own config.example.json for the same fields. null = file unreadable (Reset is then disabled).
    readonly defaults: EngineSettingsValues | null
    // Fields that were missing in config.json, so the value shown is the engine example value, not a saved one.
    readonly missingKeys: readonly SettingKey[]
    // null = Save / Reset allowed. A string = disabled and this is why (rule 17).
    readonly editDisabledReason: string | null
    readonly lastBackupAt: string | null
    readonly updatedAt: string
}

export interface EngineSettingsApi {
    getEngineSettingsState(): Promise<EngineSettingsState>
    saveEngineSettings(values: EngineSettingsValues): Promise<ActionResult>
    resetEngineSettings(): Promise<ActionResult>
}
