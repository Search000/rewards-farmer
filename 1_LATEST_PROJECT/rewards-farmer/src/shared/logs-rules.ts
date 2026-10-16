import { DEFAULT_LOGS_FILTER } from './logs-types'
import type { LevelFilter, LogLevel, LogLine, LogsFilter } from './logs-types'

// Pure helpers shared by main (export) and renderer (view). No I/O.

const RANK: Record<LogLevel, number> = { unknown: 0, debug: 1, info: 2, warn: 3, error: 4 }
const MIN_RANK: Record<LevelFilter, number> = { all: 0, debug: 1, info: 2, warn: 3, error: 4 }
export const LEVEL_FILTERS: readonly LevelFilter[] = ['all', 'debug', 'info', 'warn', 'error']
export const MAX_FILTER_TEXT = 200

// The engine writes level names in its own format (docs: debug, info, warn, error). Anything else stays 'unknown'.
export function normalizeLevel(value: unknown): LogLevel {
    if (typeof value !== 'string') return 'unknown'
    const v = value.trim().toLowerCase()
    if (v === 'debug') return 'debug'
    if (v === 'info') return 'info'
    if (v === 'warn' || v === 'warning') return 'warn'
    if (v === 'error' || v === 'err') return 'error'
    return 'unknown'
}

export function levelRank(level: LogLevel): number {
    return RANK[level]
}

export function matchesFilter(line: LogLine, filter: LogsFilter): boolean {
    if (RANK[line.level] < MIN_RANK[filter.level]) return false
    const needle = filter.text.trim().toLowerCase()
    if (needle === '') return true
    return [line.title ?? '', line.message, line.user ?? ''].some((s) => s.toLowerCase().includes(needle))
}

export function filterLines(lines: readonly LogLine[], filter: LogsFilter): LogLine[] {
    return lines.filter((l) => matchesFilter(l, filter))
}

// One plain-text line, used by Copy and Export.
export function formatLine(line: LogLine): string {
    const when = line.at ?? '-'
    const head = `${when} [${line.level.toUpperCase()}]`
    const user = line.user === null || line.user === '' ? '' : ` [${line.user}]`
    const title = line.title === null || line.title === '' ? '' : ` ${line.title}:`
    return `${head}${user}${title} ${line.message}`.replace(/[\r\n]+/g, ' ')
}

// The renderer is untrusted: anything that is not exactly the expected shape is refused.
export function parseFilter(input: unknown): LogsFilter | null {
    if (typeof input !== 'object' || input === null) return null
    const { level, text } = input as { level?: unknown; text?: unknown }
    if (typeof level !== 'string' || !(LEVEL_FILTERS as readonly string[]).includes(level)) return null
    if (typeof text !== 'string' || text.length > MAX_FILTER_TEXT) return null
    return { ...DEFAULT_LOGS_FILTER, level: level as LevelFilter, text }
}
