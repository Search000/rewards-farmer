import { formatBytes } from './backup-rules'
import type { BackupVerification } from './backup-types'
import type {
    FilesState,
    RestoreAction,
    RestoreApplyFailure,
    RestoreFailure,
    RestoreFilePlan,
    RestoreHistory,
    RestoreHistoryStatus,
    RestorePreview,
    RestoreUndoFailure
} from './restore-types'

// Phases 20 and 21: the texts and small decisions of the Restore dialog and of the "Last restore" part of the Backups page,
// kept here (no React, no file access) so the tests can check them. Nothing in here can hold a secret: names, sizes, counts
// and plain sentences only.

export const RESTORE_INTRO =
    'A restore puts the files of this backup back. The window first checks the backup and shows what would change. Nothing is changed until you make a safety copy, tick the confirmation and press Restore now.'

export const SAFETY_NOTE =
    'Before anything could be changed, the app saves a safety copy of your current files. The safety copy holds real passwords and webhook addresses and is NOT encrypted; it is kept in a folder that only your Windows account can open, apart from your backups.'

export const NEVER_DELETES_NOTE =
    'A restore never deletes a file. A file that is not in the backup stays as it is.'

// What the user will be asked to confirm in the step that applies a restore.
export const CONFIRM_TEXT =
    'I understand that the files marked "Will be replaced" or "Will be created" are replaced by the files of this backup, and that my current files are kept in the safety copy.'

// Why the last button is disabled (rule 17). Shown next to it until the box is ticked.
export const RESTORE_NOW_NEEDS_CONFIRM_REASON =
    'Tick the confirmation box first. Until then this button does nothing, and nothing is restored.'

export const CONFIRM_LABEL = 'I understand and I want to restore these files'

export const UNDO_NOTE =
    'After a restore, Undo on the Backups page puts your files back as they were just before. Undo itself keeps a safety copy of the files as they are at that moment.'

export type ActionTone = 'warning' | 'default' | 'error'

export function actionTone(action: RestoreAction): ActionTone {
    switch (action) {
        case 'replace':
        case 'create':
            return 'warning'
        case 'cannot-restore':
            return 'error'
        case 'unchanged':
        case 'keep':
            return 'default'
    }
}

// One sentence above the plan. Tells the truth about "nothing would change" and about a blocked restore.
export function previewSummary(p: RestorePreview): string {
    if (p.blockers.length > 0) {
        return p.changeCount === 0
            ? 'The restore cannot go on right now (see below), and it would not change anything anyway.'
            : `A restore would change ${String(p.changeCount)} of your files, but it cannot go on right now (see below).`
    }
    if (p.changeCount === 0)
        return 'Your current files already match this backup. A restore would change nothing.'
    return `A restore would change ${p.changeCount === 1 ? '1 of your files' : `${String(p.changeCount)} of your files`}. Nothing has been changed yet.`
}

// Counts and sizes of one file in plain words. Never a name, an e-mail address or a path.
export function fileFacts(f: RestoreFilePlan): string {
    const parts: string[] = []
    if (f.backupBytes !== null) parts.push(`In the backup: ${formatBytes(f.backupBytes)}`)
    if (f.currentBytes !== null) parts.push(`Now: ${formatBytes(f.currentBytes)}`)
    else if (f.backupBytes !== null && f.action !== 'cannot-restore') parts.push('Now: no file')
    if (f.backupAccountCount !== null) {
        const now = f.currentAccountCount === null ? '' : `, ${String(f.currentAccountCount)} now`
        parts.push(`Accounts: ${String(f.backupAccountCount)} in the backup${now}`)
    }
    return parts.join('. ')
}

export function failureTitle(f: RestoreFailure): string {
    switch (f.stage) {
        case 'rejected':
            return 'This backup cannot be restored'
        case 'blocked':
            return 'The restore cannot go on right now'
        case 'snapshot-failed':
            return 'The safety copy could not be made'
    }
}

// Only a backup that passed its check can be restored. The button on a damaged one is disabled with this reason (rule 17).
export function restoreButtonView(v: BackupVerification): {
    readonly enabled: boolean
    readonly reason: string | null
} {
    return v.status === 'ok'
        ? { enabled: true, reason: null }
        : { enabled: false, reason: 'This backup failed its check, so it cannot be restored.' }
}

// The bridge itself failed (not a restore problem).
export function bridgeFailureText(detail: string | null): string {
    return `The backup could not be checked${detail === null ? '' : ` (${detail})`}. Nothing was changed. Close the app and open it again with START.bat, then try again.`
}

// ---- Phase 21: result of Restore now -------------------------------------------------------------------------------------

// Where the files stand after a restore that did not happen or did not finish. Plain words, no jargon.
export function filesStateText(state: FilesState): string {
    switch (state) {
        case 'untouched':
            return 'None of your files was changed.'
        case 'rolled-back':
            return 'Some files were written and then ALL of them were put back as they were. The app checked that.'
        case 'needs-undo':
            return 'Some of your files may be restored and some not. Press Undo on the Backups page to put everything back.'
    }
}

export function applyFailureTitle(f: RestoreApplyFailure): string {
    switch (f.stage) {
        case 'not-confirmed':
            return 'The restore was not confirmed'
        case 'rejected':
            return 'This backup cannot be restored'
        case 'blocked':
            return 'The restore cannot go on right now'
        case 'interrupted-earlier':
            return 'An earlier restore did not finish'
        case 'snapshot-failed':
            return 'The safety copy could not be made'
        case 'write-failed':
            return f.filesState === 'rolled-back'
                ? 'The restore stopped and was rolled back'
                : 'The restore stopped'
    }
}

// The alert tone: a failure that left files in a mixed state is an error; one that put everything back is a warning.
export function applyFailureTone(f: RestoreApplyFailure): 'error' | 'warning' {
    return f.filesState === 'needs-undo' ? 'error' : 'warning'
}

export function undoFailureTitle(f: RestoreUndoFailure): string {
    switch (f.stage) {
        case 'not-confirmed':
            return 'The undo was not confirmed'
        case 'nothing-to-undo':
            return 'There is nothing to undo'
        case 'blocked':
            return 'The undo cannot go on right now'
        case 'safety-failed':
            return 'The safety copy could not be made'
        case 'write-failed':
            return 'The undo stopped'
    }
}

// Restore now is enabled only after the safety copy exists AND the box is ticked AND nothing is running (rule 17).
export function restoreNowView(o: { readonly confirmed: boolean; readonly applying: boolean }): {
    readonly enabled: boolean
    readonly reason: string | null
} {
    if (o.applying) return { enabled: false, reason: 'The restore is running. Wait until it has finished.' }
    if (!o.confirmed) return { enabled: false, reason: RESTORE_NOW_NEEDS_CONFIRM_REASON }
    return { enabled: true, reason: null }
}

// ---- Phase 21: the "Last restore" part of the Backups page ----------------------------------------------------------------

export const UNDO_CONFIRM_TITLE = 'Undo the last restore?'
export const UNDO_CONFIRM_MESSAGE =
    'This puts the files that the last restore changed back as they were before it. First the app saves a safety copy of the files as they are now, so nothing is lost. A file that the restore created is removed.'

export interface HistoryView {
    readonly title: string
    readonly tone: 'info' | 'success' | 'warning' | 'error'
    // Whether to show the part at all (nothing to say = nothing shown).
    readonly visible: boolean
}

export function historyView(status: RestoreHistoryStatus): HistoryView {
    switch (status) {
        case 'none':
            return { title: 'No restore yet', tone: 'info', visible: false }
        case 'undo-available':
            return { title: 'Last restore finished', tone: 'success', visible: true }
        case 'interrupted':
            return { title: 'A restore did not finish', tone: 'error', visible: true }
        case 'undo-interrupted':
            return { title: 'An undo did not finish', tone: 'error', visible: true }
        case 'undone':
            return { title: 'Last restore was undone', tone: 'info', visible: true }
        case 'record-damaged':
            return { title: 'The record of the last restore is damaged', tone: 'warning', visible: true }
    }
}

// Undo is offered only when the record says it can work. Disabled with the reason otherwise (rule 17).
export function undoButtonView(h: RestoreHistory): {
    readonly show: boolean
    readonly enabled: boolean
    readonly reason: string | null
} {
    const showable =
        h.status === 'undo-available' || h.status === 'interrupted' || h.status === 'undo-interrupted'
    if (!showable) return { show: false, enabled: false, reason: null }
    if (h.canUndo) return { show: true, enabled: true, reason: null }
    return { show: true, enabled: false, reason: h.undoBlockedReason ?? 'Undo cannot be used right now.' }
}

// A restore or an undo that did not finish needs the user's attention at the top of the page.
export function needsAttention(h: RestoreHistory): boolean {
    return h.status === 'interrupted' || h.status === 'undo-interrupted'
}

export function historyBridgeFailureText(detail: string | null): string {
    return `The record of the last restore could not be read${detail === null ? '' : ` (${detail})`}. No file was changed. Close the app and open it again with START.bat.`
}
