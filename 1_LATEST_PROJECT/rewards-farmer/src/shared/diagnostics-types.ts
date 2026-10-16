import type { ActionResult } from './farmer-types'

// Phase 14: diagnostics bundle. One ZIP file the user can send to a person who helps them. It holds versions, settings with
// every secret hidden, the health results and the newest lines of the app, engine and error logs. Everything is cleaned in the
// main process and checked once more before the file is written; if the check finds anything secret, nothing is saved.

export const DIAGNOSTICS_IPC = {
    export: 'diagnostics:export'
} as const

export interface DiagnosticsApi {
    // Main shows the save dialog, builds the cleaned bundle, checks it and writes it. Takes NO argument: the renderer cannot
    // choose a path, a file to include, or what to leave out.
    exportDiagnostics(): Promise<ActionResult>
}

// The exact text main answers with when the user closes the save dialog. The screen shows no message for it.
export const EXPORT_CANCELLED_MESSAGE = 'Export cancelled.'
