// Duration text used in the engine config (for example "6min", "50sec", "1.5h"). The engine reads it with the `ms` library
// (engine/src/util/Validator.ts: DurationValue). This app is stricter on purpose: a unit is REQUIRED, so "90" can never
// be mistaken for 90 seconds when the engine would read it as 90 milliseconds.

const UNIT_MS: Readonly<Record<string, number>> = {
    ms: 1,
    msec: 1,
    msecs: 1,
    millisecond: 1,
    milliseconds: 1,
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,
    m: 60_000,
    min: 60_000,
    mins: 60_000,
    minute: 60_000,
    minutes: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    hrs: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    days: 86_400_000
}

const PATTERN = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/i

// Milliseconds, or null when the text is not "<number><unit>".
export function parseDuration(text: string): number | null {
    const m = PATTERN.exec(text.trim())
    if (m === null) return null
    const unit = UNIT_MS[(m[2] ?? '').toLowerCase()]
    if (unit === undefined) return null
    const value = Number(m[1]) * unit
    return Number.isFinite(value) ? value : null
}

// A number in the config file is milliseconds (engine Validator: durationToMs).
export function durationFromConfig(raw: unknown): string | null {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? `${String(raw)}ms` : null
    if (typeof raw === 'string') return parseDuration(raw) === null ? null : raw.trim()
    return null
}

export const DURATION_HELP = 'Number and unit, for example 30sec, 5min, 1h.'
