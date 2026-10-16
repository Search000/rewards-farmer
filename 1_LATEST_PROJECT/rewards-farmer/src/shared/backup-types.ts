import type { ActionResult, ErrorCode } from './farmer-types'

// Phase 18: types of the backup service and of the backup manifest.
// RULE: a backup folder can hold secrets (config.json webhooks, accounts file passwords). Everything in THIS file is safe
// to show: names, sizes, checksums, counts. No secret VALUE, no e-mail address and no folder path of the user is here.

// Phase 19 adds: the check after writing (verification), the details of one backup (inspect), the reason and the "what to do"
// text of a failed backup, and the bridge the Backups page uses. Still nothing secret here.

export const BACKUP_IPC = {
    getState: 'backup:get-state',
    create: 'backup:create',
    inspect: 'backup:inspect',
    openFolder: 'backup:open-folder'
} as const

// What can be inside a backup. The file name inside the backup folder is fixed per role (never taken from the source path).
export type BackupRole = 'engine-config' | 'accounts' | 'app-settings'

export interface BackupFileEntry {
    readonly role: BackupRole
    // Fixed name inside the backup folder: engine-config.json, accounts.env, app-settings.json.
    readonly name: string
    readonly sizeBytes: number
    // Lower-case hex SHA-256 of the exact bytes stored in the backup file.
    readonly sha256: string
    // true = the file can hold passwords, tokens or webhook addresses. The backup folder is limited to the current user.
    readonly containsSecrets: boolean
}

// A source that was NOT put in the backup, and why (so nobody believes it is saved when it is not).
export interface BackupSkippedEntry {
    readonly role: BackupRole
    readonly reason: string
}

export interface BackupManifest {
    readonly format: 'rewards-farmer-backup'
    readonly manifestVersion: 1
    // Same as the folder name, for example backup-20261015-093000-123.
    readonly id: string
    readonly appVersion: string
    readonly createdAt: string
    readonly platform: string
    readonly files: readonly BackupFileEntry[]
    readonly skipped: readonly BackupSkippedEntry[]
    readonly totalBytes: number
    // Number of ACCOUNT_N_EMAIL lines in the saved accounts file. null = no accounts file in this backup. Never the e-mails.
    readonly accountCount: number | null
}

// What the check after writing (and the check every time the list is read) can find wrong with a backup folder.
export type VerifyProblemKind =
    | 'manifest-missing'
    | 'manifest-invalid'
    | 'manifest-wrong-id'
    | 'file-missing'
    | 'not-a-file'
    | 'size-differs'
    | 'checksum-differs'
    | 'unreadable'

export interface BackupVerifyProblem {
    readonly kind: VerifyProblemKind
    // Fixed backup file name (for example accounts.env), or null when the problem is about the whole folder.
    readonly file: string | null
    // Plain language, no folder path, no secret value.
    readonly text: string
}

// Result of ONE check of a backup folder as it is on the disk right now: manifest, file presence, size and SHA-256.
export interface BackupVerification {
    // 'ok' = the manifest is valid and every listed file is there with the listed size and checksum.
    readonly status: 'ok' | 'failed'
    readonly checkedAt: string
    readonly filesChecked: number
    readonly problems: readonly BackupVerifyProblem[]
    // Things that are not wrong but worth knowing (for example items in the folder that the manifest does not list).
    readonly notes: readonly string[]
}

// One finished backup, as the service lists it. Only folders with a valid manifest are ever listed, and each one carries
// the result of a fresh check, so a backup that was damaged later is shown as damaged.
export interface BackupSummary {
    readonly id: string
    readonly createdAt: string
    readonly appVersion: string
    readonly fileCount: number
    readonly totalBytes: number
    readonly skipped: readonly BackupSkippedEntry[]
    readonly verification: BackupVerification
}

// Why a backup could not be made. Decides the "what to do" text.
export type BackupFailReason =
    | 'permission-denied'
    | 'disk-full'
    | 'low-space'
    | 'read-only'
    | 'source-unreadable'
    | 'source-not-file'
    | 'source-too-large'
    | 'nothing-to-back-up'
    | 'copy-differs'
    | 'verify-failed'
    | 'unknown'

export type BackupCreateResult =
    | {
          readonly ok: true
          readonly message: string
          readonly backup: BackupSummary
          // Plain-language notes (for example: permissions could not be tightened).
          readonly notes: readonly string[]
      }
    | {
          readonly ok: false
          readonly code: ErrorCode
          readonly message: string
          readonly reason: BackupFailReason
          // Plain-language next step for the user ("what to do"). Never empty.
          readonly fix: string
      }

// The details of one backup: the manifest facts plus a fresh check. No file CONTENT is ever in here.
export interface BackupDetail {
    readonly id: string
    readonly createdAt: string
    readonly appVersion: string
    readonly platform: string
    readonly totalBytes: number
    readonly accountCount: number | null
    readonly files: readonly BackupFileEntry[]
    readonly skipped: readonly BackupSkippedEntry[]
    readonly verification: BackupVerification
}

export type BackupInspectResult =
    | { readonly ok: true; readonly detail: BackupDetail }
    | { readonly ok: false; readonly code: ErrorCode; readonly message: string }

export interface BackupListResult {
    readonly ok: boolean
    readonly message: string | null
    // Newest first. Finished backups only.
    readonly backups: readonly BackupSummary[]
    // Number of unfinished leftovers (a backup that was interrupted). They are never listed as a backup and never used.
    readonly unfinishedCount: number
}

// The bridge for the Backups page. No method takes a path: the backup folder is chosen by the main process only.
export interface BackupsApi {
    // Lists the finished backups, newest first, each with a fresh check. Reads only.
    getBackupsState(): Promise<BackupListResult>
    // Makes one backup, then checks it on the disk. Takes NO argument.
    createBackup(): Promise<BackupCreateResult>
    // Details of one backup (the name must be a backup id) with a fresh check.
    inspectBackup(id: string): Promise<BackupInspectResult>
    // Opens the backup folder in the file explorer.
    openBackupFolder(): Promise<ActionResult>
}
