import type { ActionResult } from './farmer-types'

// Phase 11: engine logs and status. Every line here is a REAL engine log entry (GET /events or GET /logs), redacted in the
// main process before it gets here. Nothing is made up: no synthetic "success" line, no guessed level.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'unknown'
// 'all' shows everything (including lines whose level the engine did not give).
export type LevelFilter = 'all' | 'debug' | 'info' | 'warn' | 'error'

export interface LogLine {
    // Local, strictly increasing number. Unique for the whole app run (engine ids restart when the engine restarts).
    readonly seq: number
    // Counts engine launches seen by this app run. A new number = the engine was restarted, so engine ids start again.
    readonly session: number
    // Id given by the engine, or null when the engine entry had none.
    readonly id: number | null
    // The engine's `receivedAt` (ISO, UTC), or null when the entry had none.
    readonly at: string | null
    readonly level: LogLevel
    readonly title: string | null
    readonly message: string
    // The engine's `user` field of the log entry (the label printed in square brackets), not guaranteed to be an e-mail.
    readonly user: string | null
}

// idle = engine not running. live = SSE stream open. polling = stream failed, reading GET /logs. disconnected = both failed.
export type LogConnection = 'idle' | 'live' | 'polling' | 'disconnected'

export interface LogsState {
    // ok = there is something real to show. unavailable = nothing yet; `reason` says why.
    readonly status: 'ok' | 'unavailable'
    readonly reason: string | null
    readonly connection: LogConnection
    // Newest last. Only the newest VIEW_MAX lines; Export covers the whole in-memory buffer.
    readonly lines: readonly LogLine[]
    readonly bufferedTotal: number
    // Lines dropped from the in-memory buffer because it is full (they stay in engine.log on disk).
    readonly dropped: number
    // Lines the engine produced but this app never received (gap in engine ids, for example after the engine buffer overflowed).
    readonly missed: number
    // Problem writing engine.log / errors.log on disk (disk full, permission denied). null = writing works.
    readonly fileError: string | null
    readonly updatedAt: string
}

export interface LogsFilter {
    readonly level: LevelFilter
    // Case-insensitive text that must appear in the title, message or user.
    readonly text: string
}

export const DEFAULT_LOGS_FILTER: LogsFilter = { level: 'all', text: '' }

export const LOGS_IPC = {
    getState: 'logs:get-state',
    refresh: 'logs:refresh',
    export: 'logs:export'
} as const

export interface LogsApi {
    getLogsState(): Promise<LogsState>
    // Reads the engine's own buffer again (GET /logs) and merges lines that were missed.
    refreshLogs(): Promise<ActionResult>
    // Main shows the save dialog and writes the redacted lines that match the filter. The renderer never sends a path.
    exportLogs(filter: LogsFilter): Promise<ActionResult>
}
