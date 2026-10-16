import type { BackupRole } from './backup-types'
import type { ErrorCode } from './farmer-types'

// Phase 20: types of the restore check, the preview and the safety copy of the current files ("pre-restore snapshot").
// Phase 21 adds: applying a restore (after an explicit confirmation), the record of the last restore, and undo.
// RULE: nothing in this file can hold a secret. Names, sizes, counts, plain sentences. No file content, no e-mail address,
// no folder path of the user. Phase 20 changes NO user file: it only reads, and writes the safety copy into the app's own
// private backup area. Only `apply` and `undo` (Phase 21) ever change a user file, and only after `confirmed === true`.

export const RESTORE_IPC = {
    preview: 'restore:preview',
    prepare: 'restore:prepare',
    apply: 'restore:apply',
    history: 'restore:history',
    undo: 'restore:undo'
} as const

// Why a restore was refused. Decides the text. The first group says the BACKUP cannot be used; the others say the restore
// cannot go on right now.
export type RestoreProblemKind =
    | 'bad-name'
    | 'not-found'
    | 'incomplete'
    | 'manifest'
    | 'wrong-version'
    | 'file-missing'
    | 'damaged'
    | 'app-too-new'
    | 'version-unknown'
    | 'content-invalid'
    | 'run-active'
    | 'no-target'
    | 'snapshot-failed'

export interface RestoreProblem {
    readonly kind: RestoreProblemKind
    // Fixed backup file name (for example accounts.env), or null when it is about the whole backup.
    readonly file: string | null
    // Plain language. No folder path, no secret value.
    readonly text: string
}

// What would happen to ONE file. The restore never deletes a file: a file that is not in the backup stays as it is.
export type RestoreAction =
    // The current file exists and differs from the backup: it would be replaced.
    | 'replace'
    // The current file does not exist: it would be created.
    | 'create'
    // The current file is byte for byte the file in the backup: nothing to do.
    | 'unchanged'
    // The backup has no such file (it was not saved then): the current file stays as it is.
    | 'keep'
    // The file is in the backup but cannot be put back right now (no place to put it). The whole restore waits.
    | 'cannot-restore'

export interface RestoreFilePlan {
    readonly role: BackupRole
    // Fixed label, for example "Accounts file".
    readonly label: string
    readonly action: RestoreAction
    // One sentence saying what happens and why.
    readonly text: string
    readonly containsSecrets: boolean
    // Size of the file in the backup. null when the backup has no such file.
    readonly backupBytes: number | null
    // Size of the current file. null when there is none (or it could not be read).
    readonly currentBytes: number | null
    // Accounts file only: number of accounts in the backup and in the current file. Counts only, never an e-mail.
    readonly backupAccountCount: number | null
    readonly currentAccountCount: number | null
}

export interface RestoreBackupFacts {
    readonly id: string
    readonly createdAt: string
    readonly appVersion: string
    readonly platform: string
}

export interface RestorePreview {
    readonly backup: RestoreBackupFacts
    // One entry per role, always in the same order (engine settings, accounts file, app settings).
    readonly files: readonly RestoreFilePlan[]
    // Files that would be replaced or created.
    readonly changeCount: number
    // Things that stop the restore from going on right now (a run is active, no place for a file). Empty = can go on.
    readonly blockers: readonly string[]
    // Not blocking, but worth reading before going on.
    readonly warnings: readonly string[]
    // true = nothing is blocking AND at least one file would change.
    readonly canContinue: boolean
}

// The safety copy of the CURRENT files, made before anything could change. Kept apart from the normal backups.
export type PreRestoreSnapshot =
    | {
          readonly status: 'created'
          readonly id: string
          readonly createdAt: string
          readonly fileCount: number
          readonly totalBytes: number
          // Files that did not exist now, so they are not in the safety copy (an undo removes what the restore created).
          readonly notSaved: readonly string[]
          // The copy was read back from the disk and every size and SHA-256 checksum matched.
          readonly checked: true
      }
    // None of the three files exists now: there is nothing to lose, so there is nothing to copy.
    | { readonly status: 'nothing-to-save' }
    // Nothing would change, so no safety copy was made.
    | { readonly status: 'not-needed' }

export interface RestoreFailure {
    readonly ok: false
    // Where it stopped. 'rejected' = the backup cannot be used. 'blocked' = the backup is fine, but not now.
    // 'snapshot-failed' = the safety copy could not be made, so the restore did not go on.
    readonly stage: 'rejected' | 'blocked' | 'snapshot-failed'
    readonly code: ErrorCode
    readonly message: string
    // Plain-language next step. Never empty.
    readonly fix: string
    readonly problems: readonly RestoreProblem[]
    // The plan, when the backup was good enough to make one (a blocked restore still shows what would change).
    readonly preview: RestorePreview | null
    // Always true in Phase 20: no user file is ever changed here.
    readonly userFilesUntouched: true
}

export type RestorePreviewResult = { readonly ok: true; readonly preview: RestorePreview } | RestoreFailure

export type RestorePrepareResult =
    | {
          readonly ok: true
          readonly message: string
          readonly preview: RestorePreview
          readonly snapshot: PreRestoreSnapshot
          readonly userFilesUntouched: true
      }
    | RestoreFailure

// ---- Phase 21: apply, record of the last restore, undo ----------------------------------------------------------------------

// Where the user's files stand after a restore (or an undo) that was refused or failed.
//   'untouched'   = not one file was changed.
//   'rolled-back' = some files were written, then ALL were put back as they were, and the app checked that.
//   'needs-undo'  = files may be partly changed and the automatic put-back did not work. Undo is the way back.
export type FilesState = 'untouched' | 'rolled-back' | 'needs-undo'

// Where a restore that did not happen stopped.
//   'not-confirmed' = the explicit confirmation was missing (nothing was even read).
//   'rejected'      = the backup cannot be used.   'blocked' = the backup is fine, but not now.
//   'interrupted-earlier' = an earlier restore was interrupted and must be undone first.
//   'snapshot-failed' = the safety copy could not be made.   'write-failed' = a file could not be written.
export type RestoreApplyStage =
    'not-confirmed' | 'rejected' | 'blocked' | 'interrupted-earlier' | 'snapshot-failed' | 'write-failed'

export interface RestoreApplyFailure {
    readonly ok: false
    readonly stage: RestoreApplyStage
    readonly code: ErrorCode
    readonly message: string
    // Plain-language next step. Never empty.
    readonly fix: string
    readonly problems: readonly RestoreProblem[]
    readonly preview: RestorePreview | null
    readonly filesState: FilesState
}

export interface RestoredFileOutcome {
    readonly role: BackupRole
    readonly label: string
    readonly action: 'replaced' | 'created'
    // Size of the file now. Read back from the disk after writing.
    readonly bytes: number
}

export type RestoreApplyResult =
    | {
          readonly ok: true
          readonly message: string
          readonly backupId: string
          readonly finishedAt: string
          readonly snapshot: PreRestoreSnapshot
          // Every written file was read back from the disk and its SHA-256 matches the backup.
          readonly files: readonly RestoredFileOutcome[]
          readonly undoAvailable: boolean
          // Plain-language remarks (for example: the engine was restarted on the restored files).
          readonly notes: readonly string[]
      }
    | RestoreApplyFailure

// The record of the last restore, as the Backups page shows it. Written by the app before the first file is touched, so an
// interrupted restore (power cut, crash) is found again the next time the app starts.
//   'none'             = no restore was ever done (or the record is gone).
//   'undo-available'   = the last restore finished; it can be undone.
//   'interrupted'      = the last restore did not finish. Files may be partly restored. Undo puts everything back.
//   'undo-interrupted' = an undo did not finish. Running it again finishes it.
//   'undone'           = the last restore was undone. Nothing more to do.
//   'record-damaged'   = the record cannot be read. A new restore is still possible (it makes its own safety copy).
export type RestoreHistoryStatus =
    'none' | 'undo-available' | 'interrupted' | 'undo-interrupted' | 'undone' | 'record-damaged'

export interface RestoreHistoryFile {
    readonly role: BackupRole
    readonly label: string
    readonly action: 'replace' | 'create'
}

export interface RestoreHistory {
    readonly status: RestoreHistoryStatus
    // One or two plain sentences for the page.
    readonly message: string
    readonly backupId: string | null
    readonly startedAt: string | null
    readonly finishedAt: string | null
    // The files the restore changed (names only).
    readonly files: readonly RestoreHistoryFile[]
    readonly canUndo: boolean
    // Why Undo is disabled (rule 17). null when it can be used or when there is nothing to undo.
    readonly undoBlockedReason: string | null
}

export type RestoreUndoStage =
    'not-confirmed' | 'nothing-to-undo' | 'blocked' | 'safety-failed' | 'write-failed'

export interface RestoreUndoFailure {
    readonly ok: false
    readonly stage: RestoreUndoStage
    readonly code: ErrorCode
    readonly message: string
    readonly fix: string
    readonly filesState: Exclude<FilesState, 'rolled-back'>
}

export interface UndoneFileOutcome {
    readonly role: BackupRole
    readonly label: string
    // 'put-back' = the file from before the restore was written back. 'removed' = the restore had created it, so it is removed.
    readonly action: 'put-back' | 'removed'
}

export type RestoreUndoResult =
    | {
          readonly ok: true
          readonly message: string
          readonly files: readonly UndoneFileOutcome[]
          // The copy of the files as they were just BEFORE the undo (so even an undo loses nothing). null = no file existed.
          readonly safetyCopyId: string | null
          readonly notes: readonly string[]
      }
    | RestoreUndoFailure

// The bridge for the restore dialog. `previewRestore` and `prepareRestore` take ONE backup id and nothing else (no path, no
// file name, no file content). `applyRestore` takes the id and the confirmation; `undoRestore` takes only the confirmation.
export interface RestoreApi {
    // Read-only. Checks the backup and says what a restore would change. Writes nothing.
    previewRestore(id: string): Promise<RestorePreviewResult>
    // Checks again from scratch, then saves a safety copy of the current files. Changes no user file.
    prepareRestore(id: string): Promise<RestorePrepareResult>
    // Phase 21. Checks everything again, makes a fresh safety copy, then puts the files of the backup back. Refused unless
    // `confirmed` is exactly true. The only call (with undoRestore) that changes a user file.
    applyRestore(id: string, confirmed: boolean): Promise<RestoreApplyResult>
    // Phase 21. Reads the record of the last restore. Read-only.
    getRestoreHistory(): Promise<RestoreHistory>
    // Phase 21. Puts the files back as they were before the last restore. Refused unless `confirmed` is exactly true.
    undoRestore(confirmed: boolean): Promise<RestoreUndoResult>
}
