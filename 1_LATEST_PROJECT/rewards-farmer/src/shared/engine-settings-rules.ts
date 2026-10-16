import { DURATION_HELP, durationFromConfig, parseDuration } from './duration'
import type {
    BrowserChoice,
    EngineSettingsValues,
    LogLevelChoice,
    SettingErrors,
    SettingKey,
    SettingValue
} from './engine-settings-types'

// Single source of truth: which control writes which field of the engine config.json (docs/configuration-reference.md).
// A control that has no row here does not exist as an enabled control (rule 17).

type Path = readonly string[]

interface BoolField {
    readonly key: SettingKey
    readonly kind: 'bool'
    readonly path: Path
}
interface ChoiceField {
    readonly key: SettingKey
    readonly kind: 'choice'
    readonly path: Path
    readonly options: readonly string[]
    // Value used when the choice is not written in the config (engine default).
    readonly fallback: string
    // Config value <-> choice text.
    readonly toConfig: (choice: string) => unknown
    readonly fromConfig: (raw: unknown) => string | null
}
interface IntField {
    readonly key: SettingKey
    readonly kind: 'int'
    readonly path: Path
    // App limit (the engine itself only requires a number). Documented in docs/configuration-reference.md.
    readonly min: number
    readonly max: number
}
interface DurationField {
    readonly key: SettingKey
    readonly kind: 'duration'
    readonly path: Path
    // App limits in milliseconds (the engine only requires a non-negative duration).
    readonly minMs: number
    readonly maxMs: number
}
interface ListField {
    readonly key: SettingKey
    readonly kind: 'list'
    readonly path: Path
}
export type FieldDef = BoolField | ChoiceField | IntField | DurationField | ListField

const bool = (key: SettingKey, path: Path): BoolField => ({ key, kind: 'bool', path })
const DAY_MS = 86_400_000
const duration = (key: SettingKey, path: Path, minMs = 0): DurationField => ({
    key,
    kind: 'duration',
    path,
    minMs,
    maxMs: DAY_MS
})

// Sources the engine accepts for search words (engine/src/util/Validator.ts: QueryEngineSchema). Entries like
// "rss.<site>" are also valid in the engine; this app keeps them if they are already in config.json but does not offer them.
export const QUERY_ENGINE_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
    { value: 'china', label: 'China trending (gmya.net)' },
    { value: 'local', label: 'Local word list' },
    { value: 'google', label: 'Google trends' },
    { value: 'wikipedia', label: 'Wikipedia' },
    { value: 'wikirandom', label: 'Wikipedia random' },
    { value: 'hackernews', label: 'Hacker News' },
    { value: 'reddit', label: 'Reddit' }
]
const RSS_SELECTOR = /^rss(\.[A-Za-z0-9_-]+){0,2}$/
export const isKnownEngine = (v: string): boolean =>
    QUERY_ENGINE_OPTIONS.some((o) => o.value === v) || RSS_SELECTOR.test(v)

export const FIELDS: readonly FieldDef[] = [
    {
        key: 'logLevel',
        kind: 'choice',
        path: ['debugLogs'],
        options: ['info', 'debug'],
        fallback: 'info',
        // The engine has one switch: debug lines on or off (engine/src/logging/Logger.ts). So the dropdown has two honest values.
        toConfig: (c) => c === 'debug',
        fromConfig: (r) => (typeof r === 'boolean' ? (r ? 'debug' : 'info') : null)
    },
    {
        key: 'browser',
        kind: 'choice',
        path: ['browserChannel'],
        options: ['chromium', 'msedge'],
        fallback: 'chromium',
        toConfig: (c) => c,
        fromConfig: (r) => (r === 'chromium' || r === 'msedge' ? r : null)
    },
    bool('headless', ['headless']),
    bool('useProxyForSearchQueries', ['proxy', 'queryEngine']),
    bool('disableImages', ['experimental', 'blockMedia']),
    bool('parallelSearching', ['searchSettings', 'parallelSearching']),
    bool('dailyQuests', ['workers', 'doDailySet']),
    bool('punchCards', ['workers', 'doPunchCards']),
    bool('moreActivities', ['workers', 'doMorePromotions']),
    bool('exploreOnBing', ['activities', 'searchOnBing']),
    bool('pcSearch', ['workers', 'doDesktopSearch']),
    bool('mobileSearch', ['workers', 'doMobileSearch']),
    bool('readToEarn', ['workers', 'doReadToEarn']),
    bool('visualSearch', ['workers', 'doVisualSearch']),
    // ---- Phase 9: login, check-in and rewards ----
    bool('prewarmDesktopLogin', ['prewarmDesktopLogin']),
    bool('dailyCheckIn', ['workers', 'doDailyCheckIn']),
    bool('streakProtection', ['ensureStreakProtection']),
    bool('claimBonusPoints', ['workers', 'doClaimBonusPoints']),
    bool('activateSearchPerk', ['workers', 'doActivateSearchPerk']),
    bool('appPromotions', ['workers', 'doAppPromotions']),
    bool('urlRewards', ['activities', 'urlReward']),
    bool('autoClaimPunchCards', ['autoClaimPunchcardRewards']),
    bool('skipNonPointTasks', ['skipNonPointTasks']),
    // ---- Phase 9: timing ----
    duration('accountDelayMin', ['accountDelay', 'min']),
    duration('accountDelayMax', ['accountDelay', 'max']),
    // Hard floor of 1 sec: a search or article read never starts again at once (decision: floor + note below the default).
    duration('searchDelayMin', ['searchSettings', 'searchDelay', 'min'], 1000),
    duration('searchDelayMax', ['searchSettings', 'searchDelay', 'max']),
    duration('readDelayMin', ['searchSettings', 'readDelay', 'min'], 1000),
    duration('readDelayMax', ['searchSettings', 'readDelay', 'max']),
    // 0 would mean "no timeout" for the browser, so at least one second.
    duration('globalTimeout', ['globalTimeout'], 1000),
    duration('searchResultVisitTime', ['searchSettings', 'searchResultVisitTime']),
    // ---- Phase 9: search options ----
    bool('bonusSearches', ['workers', 'doBonusSearches']),
    { key: 'maxBonusSearches', kind: 'int', path: ['searchSettings', 'maxBonusSearches'], min: 0, max: 1000 },
    bool('runOnZeroPoints', ['searchSettings', 'runOnZeroPoints']),
    bool('clusterSearch', ['searchSettings', 'clusterSearch']),
    bool('localBingQueries', ['searchOnBingLocalQueries']),
    { key: 'queryEngines', kind: 'list', path: ['searchSettings', 'queryEngines'] },
    // ---- Phase 9 (user decision): advanced and experimental ----
    // App limit 1 to 8 (the engine accepts any whole number from 0). Several processes = several accounts at once.
    { key: 'clusters', kind: 'int', path: ['clusters'], min: 1, max: 8 },
    bool('ignoreCertificateErrors', ['proxy', 'ignoreCertificateErrors']),
    bool('apiSearch', ['experimental', 'apiSearch']),
    bool('apiSearchOnBing', ['experimental', 'apiSearchOnBing'])
]

// Pairs that must satisfy min <= max (the engine refuses the config otherwise: Validator.ts DelaySchema).
export const DELAY_PAIRS: readonly (readonly [SettingKey, SettingKey])[] = [
    ['accountDelayMin', 'accountDelayMax'],
    ['searchDelayMin', 'searchDelayMax'],
    ['readDelayMin', 'readDelayMax']
]

export const BROWSER_OPTIONS: readonly { readonly value: BrowserChoice; readonly label: string }[] = [
    { value: 'chromium', label: 'Chromium (default)' },
    { value: 'msedge', label: 'Microsoft Edge' }
]
export const LOG_LEVEL_OPTIONS: readonly { readonly value: LogLevelChoice; readonly label: string }[] = [
    { value: 'info', label: 'Info' },
    { value: 'debug', label: 'Debug' }
]

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readPath(root: unknown, path: Path): unknown {
    let cur: unknown = root
    for (const part of path) {
        if (!isObject(cur) || !(part in cur)) return undefined
        cur = cur[part]
    }
    return cur
}

export interface Extracted {
    readonly values: EngineSettingsValues
    // Fields not present in the config (the fallback was used).
    readonly missing: readonly SettingKey[]
}

// Reads the mapped fields out of a parsed config. A field with the WRONG type is an error (never silently "fixed").
// A field that is absent uses `fallbacks` (the engine example values) or, for the first read of the example, the choice fallback.
export function extractValues(
    config: unknown,
    fallbacks: EngineSettingsValues | null
): { ok: true; value: Extracted } | { ok: false; message: string } {
    if (!isObject(config)) return { ok: false, message: 'The engine config is not a JSON object.' }
    const out: Record<string, SettingValue> = {}
    const missing: SettingKey[] = []
    for (const f of FIELDS) {
        const raw = readPath(config, f.path)
        if (raw === undefined) {
            missing.push(f.key)
            if (fallbacks !== null) out[f.key] = fallbacks[f.key]
            else if (f.kind === 'choice') out[f.key] = f.fallback
            else if (f.kind === 'duration') out[f.key] = '0ms'
            else if (f.kind === 'int') out[f.key] = 0
            else if (f.kind === 'list') out[f.key] = []
            else out[f.key] = false
            continue
        }
        const where = f.path.join('.')
        if (f.kind === 'bool') {
            if (typeof raw !== 'boolean')
                return { ok: false, message: `${where} must be true or false in config.json.` }
            out[f.key] = raw
        } else if (f.kind === 'choice') {
            const choice = f.fromConfig(raw)
            if (choice === null) return { ok: false, message: `${where} has a value this app does not know.` }
            out[f.key] = choice
        } else if (f.kind === 'int') {
            // Wrong TYPE is an error. A number outside the app limit is shown and flagged by validateValues instead.
            if (typeof raw !== 'number' || !Number.isFinite(raw)) {
                return { ok: false, message: `${where} must be a number in config.json.` }
            }
            out[f.key] = raw
        } else if (f.kind === 'duration') {
            const text = durationFromConfig(raw)
            if (text === null)
                return { ok: false, message: `${where} is not a duration like "5min" in config.json.` }
            out[f.key] = text
        } else {
            if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) {
                return { ok: false, message: `${where} must be a list of names in config.json.` }
            }
            out[f.key] = [...(raw as string[])]
        }
    }
    return { ok: true, value: { values: out as unknown as EngineSettingsValues, missing } }
}

// The renderer is untrusted: anything that is not exactly the expected shape is refused (threat model T5, T11).
export function parseSettingsInput(raw: unknown): EngineSettingsValues | null {
    if (!isObject(raw)) return null
    const keys = Object.keys(raw)
    if (keys.length !== FIELDS.length) return null
    const out: Record<string, SettingValue> = {}
    for (const f of FIELDS) {
        const v = raw[f.key]
        if (f.kind === 'bool') {
            if (typeof v !== 'boolean') return null
            out[f.key] = v
        } else if (f.kind === 'choice') {
            if (typeof v !== 'string' || !f.options.includes(v)) return null
            out[f.key] = v
        } else if (f.kind === 'int') {
            if (typeof v !== 'number' || !Number.isInteger(v)) return null
            out[f.key] = v
        } else if (f.kind === 'duration') {
            if (typeof v !== 'string') return null
            out[f.key] = v.trim()
        } else {
            if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return null
            out[f.key] = [...(v as string[])]
        }
    }
    const values = out as unknown as EngineSettingsValues
    // Limits are checked here too, not only on screen (the renderer is untrusted).
    return Object.keys(validateValues(values)).length === 0 ? values : null
}

const sameValue = (a: SettingValue, b: SettingValue): boolean =>
    Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b

export function formatMs(ms: number): string {
    if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${String(ms / 3_600_000)} h`
    if (ms >= 60_000 && ms % 60_000 === 0) return `${String(ms / 60_000)} min`
    if (ms >= 1000 && ms % 1000 === 0) return `${String(ms / 1000)} sec`
    return `${String(ms)} ms`
}

// Message per control that cannot be saved. {} = everything is valid.
export function validateValues(values: EngineSettingsValues): SettingErrors {
    const errors: Record<string, string> = {}
    for (const f of FIELDS) {
        const v = values[f.key]
        if (f.kind === 'int') {
            if (typeof v !== 'number' || !Number.isInteger(v)) errors[f.key] = 'Enter a whole number.'
            else if (v < f.min || v > f.max)
                errors[f.key] = `Enter a number from ${String(f.min)} to ${String(f.max)}.`
        } else if (f.kind === 'duration') {
            const ms = typeof v === 'string' ? parseDuration(v) : null
            if (ms === null) errors[f.key] = DURATION_HELP
            else if (ms < f.minMs || ms > f.maxMs) {
                errors[f.key] = `Use a time from ${formatMs(f.minMs)} to ${formatMs(f.maxMs)}.`
            }
        } else if (f.kind === 'list') {
            const list = Array.isArray(v) ? (v as readonly string[]) : []
            if (list.length === 0) errors[f.key] = 'Choose at least one source.'
            else if (!list.every(isKnownEngine)) errors[f.key] = 'One source name is not valid.'
            else if (new Set(list).size !== list.length) errors[f.key] = 'A source is listed twice.'
        }
    }
    for (const [lo, hi] of DELAY_PAIRS) {
        if (errors[lo] !== undefined || errors[hi] !== undefined) continue
        const a = parseDuration(String(values[lo]))
        const b = parseDuration(String(values[hi]))
        if (a !== null && b !== null && b < a)
            errors[hi] = 'The maximum must not be shorter than the minimum.'
    }
    return errors as SettingErrors
}

// Soft notes (not errors): a delay shorter than the engine example value. Shown, never blocked.
export function shorterThanDefault(
    values: EngineSettingsValues,
    defaults: EngineSettingsValues | null
): SettingKey[] {
    if (defaults === null) return []
    return FIELDS.filter(
        (f) => f.kind === 'duration' && f.key !== 'globalTimeout' && f.key !== 'searchResultVisitTime'
    )
        .filter((f) => {
            const now = parseDuration(String(values[f.key]))
            const base = parseDuration(String(defaults[f.key]))
            return now !== null && base !== null && now < base
        })
        .map((f) => f.key)
}

export function changedKeys(before: EngineSettingsValues, after: EngineSettingsValues): SettingKey[] {
    return FIELDS.filter((f) => !sameValue(before[f.key], after[f.key])).map((f) => f.key)
}

// Deep object holding only the given keys, ready for PATCH /config (the engine deep-merges it into config.json).
export function buildPatch(
    values: EngineSettingsValues,
    keys: readonly SettingKey[]
): Record<string, unknown> {
    const patch: Record<string, unknown> = {}
    for (const key of keys) {
        const f = FIELDS.find((x) => x.key === key)
        if (f === undefined) continue
        const value =
            f.kind === 'choice'
                ? f.toConfig(String(values[key]))
                : f.kind === 'list'
                  ? [...(values[key] as readonly string[])]
                  : values[key]
        let cur = patch
        f.path.forEach((part, i) => {
            if (i === f.path.length - 1) cur[part] = value
            else {
                const next = isObject(cur[part]) ? (cur[part] as Record<string, unknown>) : {}
                cur[part] = next
                cur = next
            }
        })
    }
    return patch
}

export function sameValues(a: EngineSettingsValues, b: EngineSettingsValues): boolean {
    return changedKeys(a, b).length === 0
}
