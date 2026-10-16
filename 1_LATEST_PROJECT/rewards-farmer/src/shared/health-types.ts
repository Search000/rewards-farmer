// Phase 12: health panel. Every row is the result of a REAL check run just now (a command, a file test, a call to the
// engine API). Nothing here is a fixed value: a check that cannot be run is `unknown` with the reason, never `ok`.

export type HealthStatus = 'ok' | 'warning' | 'error' | 'unknown'
export type HealthGroup = 'runtime' | 'config' | 'engine' | 'system'

export type HealthCheckId =
    | 'app'
    | 'node'
    | 'git'
    | 'engine-files'
    | 'engine-packages'
    | 'engine-built'
    | 'config-file'
    | 'config-valid'
    | 'accounts-file'
    | 'engine-process'
    | 'engine-api'
    | 'engine-config'
    | 'engine-version'
    | 'disk-space'
    | 'folder-data'
    | 'folder-engine'
    | 'network'

export interface HealthCheck {
    readonly id: HealthCheckId
    readonly group: HealthGroup
    // Short row title shown to the user, for example "Node.js".
    readonly title: string
    readonly status: HealthStatus
    // What was found. Plain language. Never contains a secret (config contents are never read into a message).
    readonly detail: string
    // What the user should do. Required when the status is `warning` or `error` (acceptance rule of Phase 12).
    // Only double-click / click instructions: the user does not type commands (master prompt rule 27).
    readonly fix: string | null
    // ISO time (UTC) at which THIS row was checked.
    readonly checkedAt: string
}

export interface HealthState {
    // never-run = the panel was never asked. done = `checks` is the result of the run that finished at `finishedAt`.
    readonly status: 'never-run' | 'done'
    readonly checks: readonly HealthCheck[]
    readonly startedAt: string | null
    readonly finishedAt: string | null
}

export const HEALTH_IPC = {
    run: 'health:run'
} as const

export interface HealthApi {
    // Runs every check now and returns the fresh result. Takes no argument: the renderer cannot choose a path or a command.
    runHealthChecks(): Promise<HealthState>
}

export const EMPTY_HEALTH_STATE: HealthState = {
    status: 'never-run',
    checks: [],
    startedAt: null,
    finishedAt: null
}
