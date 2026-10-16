import type { HealthCheck, HealthCheckId, HealthGroup, HealthStatus } from './health-types'

// Pure rules of the health panel (no file, no process, no clock). The checks themselves live in main/healthService.ts.

export const MIN_NODE_MAJOR = 24

export const NODE_DOWNLOAD = 'https://nodejs.org/'
export const GIT_DOWNLOAD = 'https://git-scm.com/download/win'

// Title and group of every row. The order here is the order on screen.
export const CHECK_DEFS: readonly {
    readonly id: HealthCheckId
    readonly group: HealthGroup
    readonly title: string
}[] = [
    { id: 'app', group: 'runtime', title: 'This app' },
    { id: 'node', group: 'runtime', title: 'Node.js (runs the engine)' },
    { id: 'git', group: 'runtime', title: 'Git (downloads the engine)' },
    { id: 'engine-files', group: 'config', title: 'Engine files' },
    { id: 'engine-packages', group: 'config', title: 'Engine packages' },
    { id: 'engine-built', group: 'config', title: 'Engine build' },
    { id: 'config-file', group: 'config', title: 'Engine config.json' },
    { id: 'config-valid', group: 'config', title: 'config.json content' },
    { id: 'accounts-file', group: 'config', title: 'Accounts file' },
    { id: 'engine-process', group: 'engine', title: 'Engine process' },
    { id: 'engine-api', group: 'engine', title: 'Engine API answers' },
    { id: 'engine-config', group: 'engine', title: 'Engine reads its config' },
    { id: 'engine-version', group: 'engine', title: 'Engine version' },
    { id: 'disk-space', group: 'system', title: 'Free disk space' },
    { id: 'folder-data', group: 'system', title: 'App data folder (read and write)' },
    { id: 'folder-engine', group: 'system', title: 'Engine folder (read and write)' },
    { id: 'network', group: 'system', title: 'Internet connection' }
]

export const GROUP_TITLES: Readonly<Record<HealthGroup, string>> = {
    runtime: 'Runtime',
    config: 'Configuration',
    engine: 'Engine',
    system: 'This computer'
}

export function defOf(id: HealthCheckId): { readonly group: HealthGroup; readonly title: string } {
    const def = CHECK_DEFS.find((d) => d.id === id)
    // CHECK_DEFS is the complete list of ids (a test proves it), so this cannot happen.
    if (def === undefined) throw new Error(`Unknown health check id: ${id}`)
    return def
}

export function makeCheck(
    id: HealthCheckId,
    status: HealthStatus,
    detail: string,
    fix: string | null,
    checkedAt: string
): HealthCheck {
    const def = defOf(id)
    // A failed row must always tell the user what to do (Phase 12 acceptance). A missing fix is a programming error.
    const needsFix = status === 'warning' || status === 'error'
    if (needsFix && (fix === null || fix.trim() === ''))
        throw new Error(`Health check ${id} is ${status} but has no fix text.`)
    return { id, group: def.group, title: def.title, status, detail, fix: needsFix ? fix : null, checkedAt }
}

// "v24.21.0" -> 24. Anything else -> null (never guess).
export function parseNodeMajor(output: string): number | null {
    const m = /^v(\d+)\.\d+\.\d+/.exec(output.trim())
    return m?.[1] === undefined ? null : Number(m[1])
}

export function parseNodeVersion(output: string): string | null {
    const m = /^v(\d+\.\d+\.\d+)/.exec(output.trim())
    return m?.[1] ?? null
}

// "git version 2.45.1.windows.1" -> "2.45.1.windows.1"
export function parseGitVersion(output: string): string | null {
    const m = /^git version (\S+)/.exec(output.trim())
    return m?.[1] ?? null
}

// Compares "1.2.3" style versions. Returns null when either side is not a plain dotted number version.
export function sameVersion(a: string, b: string): boolean | null {
    const re = /^\d+(\.\d+)*$/
    const x = a.trim().replace(/^v/, '')
    const y = b.trim().replace(/^v/, '')
    if (!re.test(x) || !re.test(y)) return null
    return x === y
}

export interface HealthCounts {
    readonly ok: number
    readonly warning: number
    readonly error: number
    readonly unknown: number
}

export function countChecks(checks: readonly HealthCheck[]): HealthCounts {
    const c = { ok: 0, warning: 0, error: 0, unknown: 0 }
    for (const check of checks) c[check.status] += 1
    return c
}

// One sentence for the top of the panel. Honest: "unknown" is never counted as good.
export function summaryText(checks: readonly HealthCheck[]): string {
    if (checks.length === 0) return 'No check has run yet.'
    const c = countChecks(checks)
    if (c.error === 0 && c.warning === 0 && c.unknown === 0)
        return `All ${String(checks.length)} checks passed.`
    const parts: string[] = []
    if (c.error > 0) parts.push(`${String(c.error)} problem${c.error === 1 ? '' : 's'}`)
    if (c.warning > 0) parts.push(`${String(c.warning)} warning${c.warning === 1 ? '' : 's'}`)
    if (c.unknown > 0) parts.push(`${String(c.unknown)} could not be checked`)
    return `${parts.join(', ')}. ${String(c.ok)} of ${String(checks.length)} checks passed.`
}

// Worst status first, for the colour of the summary.
export function overallStatus(checks: readonly HealthCheck[]): HealthStatus {
    if (checks.some((c) => c.status === 'error')) return 'error'
    if (checks.some((c) => c.status === 'warning')) return 'warning'
    if (checks.some((c) => c.status === 'unknown')) return 'unknown'
    return 'ok'
}

// ---- Phase 13: disk, folders, network, re-check ------------------------------------------------------------------------

// Below ERROR the engine cannot reliably save logs, browser data or backups. Below WARNING it will soon run out.
export const DISK_ERROR_BYTES = 200 * 1024 * 1024
export const DISK_WARNING_BYTES = 1024 * 1024 * 1024

// The engine talks to this host to farm points. Only a connection is opened to test it; no request is sent.
export const NETWORK_HOST = 'rewards.bing.com'
export const NETWORK_PORT = 443

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return 'unknown'
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let i = 0
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024
        i += 1
    }
    return i === 0
        ? `${String(Math.round(value))} bytes`
        : `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i] ?? ''}`
}

export function evaluateDisk(freeBytes: number): 'ok' | 'warning' | 'error' {
    if (freeBytes < DISK_ERROR_BYTES) return 'error'
    if (freeBytes < DISK_WARNING_BYTES) return 'warning'
    return 'ok'
}

// "C:/Users/me" or "C:\\Users\\me" -> "C:". Anything without a drive letter -> null.
export function driveOf(path: string): string | null {
    const m = /^([A-Za-z]:)[\\/]/.exec(path)
    return m?.[1]?.toUpperCase() ?? null
}

// The part of the app state that makes a re-check worthwhile. When this text changes, something the checks look at
// (engine process, accounts file) has changed. It is kept in memory only and never shown or sent anywhere.
export function recheckKey(state: {
    readonly engine: { readonly link: string }
    readonly accounts: { readonly status: string; readonly count: number | null }
}): string {
    return `${state.engine.link}|${state.accounts.status}|${state.accounts.count === null ? '-' : String(state.accounts.count)}`
}

// Auto re-checks: wait this long after the last trigger (so a burst of events runs the checks once)...
export const RECHECK_DEBOUNCE_MS = 1500
// ...and never start an automatic run sooner than this after the previous one finished. The manual button ignores it.
export const RECHECK_MIN_GAP_MS = 5000
