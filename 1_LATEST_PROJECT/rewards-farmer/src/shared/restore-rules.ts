import type { BackupRole, BackupVerifyProblem } from './backup-types'
import { BACKUP_ROLES, MANIFEST_VERSION_MESSAGE, backupIdFor } from './backup-rules'
import type { RestoreAction, RestoreHistory, RestoreProblem, RestoreProblemKind } from './restore-types'

// Phase 20: pure rules of the restore check (no file access, no React), so the service, the dialog and the tests share one
// truth. Nothing here can hold a secret.

// ---- version compatibility ----------------------------------------------------------------------------------------------

export interface AppVersion {
    readonly major: number
    readonly minor: number
    readonly patch: number
}

const VERSION_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.+-]*)?$/

export function parseAppVersion(text: string): AppVersion | null {
    const m = VERSION_RE.exec(text.trim())
    if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return null
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

// <0 = a is older than b, 0 = same, >0 = a is newer. A pre-release tag after the numbers is ignored.
export function compareVersions(a: AppVersion, b: AppVersion): number {
    return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

// A backup made by a NEWER app may hold things this app does not know, so it is refused. A backup from an OLDER (or the same)
// version is accepted: the files are checked on their own anyway (see contentProblem in the service) and old settings files are
// upgraded by the app when it reads them. A version nobody can read is refused too: "unknown" is never "fine".
export function versionProblem(backupVersion: string, appVersion: string): RestoreProblem | null {
    const backup = parseAppVersion(backupVersion)
    if (backup === null) {
        return {
            kind: 'version-unknown',
            file: null,
            text: 'The app version written in this backup cannot be read, so the app cannot tell if the backup is safe to use.'
        }
    }
    const app = parseAppVersion(appVersion)
    if (app === null) {
        return {
            kind: 'version-unknown',
            file: null,
            text: 'The version of this app cannot be read, so the app cannot tell if the backup is safe to use.'
        }
    }
    if (compareVersions(backup, app) > 0) {
        return {
            kind: 'app-too-new',
            file: null,
            text: `This backup was made by a newer version of the app (${backupVersion}). This app is version ${appVersion} and could misread it.`
        }
    }
    return null
}

// The version of the manifest format itself. The strict manifest parser gives one fixed sentence for it (MANIFEST_VERSION_MESSAGE).
export function isManifestVersionProblem(p: BackupVerifyProblem): boolean {
    return p.kind === 'manifest-invalid' && p.text === MANIFEST_VERSION_MESSAGE
}

// ---- what the check found in the backup folder -> why the restore is refused ------------------------------------------------

// Turns the problems of the backup check (Phase 19) into restore problems. A backup with ANY problem is refused: a restore
// never starts from a backup that is not exactly what it was when it was made.
export function problemsFromVerification(problems: readonly BackupVerifyProblem[]): RestoreProblem[] {
    return problems.map((p): RestoreProblem => {
        let kind: RestoreProblemKind
        switch (p.kind) {
            case 'manifest-missing':
                kind = 'incomplete'
                break
            case 'manifest-invalid':
                kind = isManifestVersionProblem(p) ? 'wrong-version' : 'manifest'
                break
            case 'manifest-wrong-id':
                kind = 'manifest'
                break
            case 'file-missing':
                kind = 'file-missing'
                break
            case 'not-a-file':
            case 'size-differs':
            case 'checksum-differs':
            case 'unreadable':
                kind = 'damaged'
                break
        }
        return { kind, file: p.file, text: p.text }
    })
}

// ---- the schema of the app settings file inside a backup ------------------------------------------------------------------

// `current` = the schema this app writes (DEFAULT_SETTINGS.schemaVersion). An older schema is fine (the app upgrades it and keeps a
// copy, see appSettings.ts). A NEWER one is refused. A file without a usable schema number is refused.
export function settingsSchemaProblem(
    parsed: unknown,
    current: number,
    fileName: string
): RestoreProblem | null {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {
            kind: 'content-invalid',
            file: fileName,
            text: 'The app settings in this backup are not a settings file.'
        }
    }
    const schema = (parsed as Record<string, unknown>)['schemaVersion']
    if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
        return {
            kind: 'content-invalid',
            file: fileName,
            text: 'The app settings in this backup have no readable version number.'
        }
    }
    if (schema > current) {
        return {
            kind: 'app-too-new',
            file: fileName,
            text: `The app settings in this backup are from a newer app (settings version ${String(schema)}; this app knows up to ${String(current)}).`
        }
    }
    return null
}

// ---- what happens to one file ---------------------------------------------------------------------------------------------

export type CurrentFile =
    // There is no file at the place the backup would be put back.
    | { readonly state: 'absent' }
    | { readonly state: 'present'; readonly sha256: string }
    // The file is there but could not be read (permission, in use).
    | { readonly state: 'unreadable' }

export function planAction(
    backup: { readonly sha256: string } | null,
    current: CurrentFile,
    hasPlace: boolean
): RestoreAction {
    if (backup === null) return 'keep'
    if (!hasPlace) return 'cannot-restore'
    switch (current.state) {
        case 'absent':
            return 'create'
        case 'unreadable':
            // Not being able to read the current file means the safety copy could not hold it either: wait.
            return 'cannot-restore'
        case 'present':
            return current.sha256 === backup.sha256 ? 'unchanged' : 'replace'
    }
}

// Same place on disk? Windows paths do not care about upper or lower case. Used only to say "the backup remembers another
// accounts file place"; the paths themselves are never shown.
export function samePlace(a: string, b: string, platform: string): boolean {
    const norm = (p: string): string => {
        const slashed = platform === 'win32' ? p.replace(/\//g, '\\') : p
        const trimmed = slashed.length > 1 ? slashed.replace(/[\\/]+$/, '') : slashed
        return platform === 'win32' ? trimmed.toLowerCase() : trimmed
    }
    return norm(a) === norm(b)
}

// ---- the app settings file as it WOULD be written ----------------------------------------------------------------------------

// The app settings hold the PLACE of the accounts file the user chose. A backup may remember another place (the file was moved,
// or the backup comes from another PC). Putting the old place back would make the app read a different file than the one the
// restore just filled. The rule (decision for the user, see the phase report): the restore keeps the user's CURRENT accounts
// file choice, puts the saved accounts into that file, and writes every other saved setting as it was.
// Returns the text that would be written, and whether the place had to be kept. If the place is the same, the backup bytes are
// used untouched (a restore must put back exactly what was saved).
export function settingsForRestore(
    backupText: string,
    currentAccountsPath: string | null,
    platform: string
): { readonly text: string; readonly keepsCurrentPlace: boolean } {
    const parsed = JSON.parse(backupText) as Record<string, unknown>
    const raw = parsed['accountsPath']
    const savedPlace = typeof raw === 'string' && raw !== '' ? raw : null
    const same =
        savedPlace === null || currentAccountsPath === null
            ? savedPlace === currentAccountsPath
            : samePlace(savedPlace, currentAccountsPath, platform)
    if (same) return { text: backupText, keepsCurrentPlace: false }
    return {
        text: `${JSON.stringify({ ...parsed, accountsPath: currentAccountsPath }, null, 4)}\n`,
        keepsCurrentPlace: true
    }
}

// ---- texts ---------------------------------------------------------------------------------------------------------------

export function actionLabel(action: RestoreAction): string {
    switch (action) {
        case 'replace':
            return 'Will be replaced'
        case 'create':
            return 'Will be created'
        case 'unchanged':
            return 'Already the same'
        case 'keep':
            return 'Stays as it is'
        case 'cannot-restore':
            return 'Cannot be restored now'
    }
}

// "What to do" for every kind of problem. Plain words, exact names of buttons and pages, no typed commands (rule 27).
export function restoreFix(kind: RestoreProblemKind): string {
    switch (kind) {
        case 'bad-name':
        case 'not-found':
            return 'Press Check again on the Backups page to refresh the list, then choose a backup from the list. Nothing was changed.'
        case 'incomplete':
        case 'manifest':
        case 'file-missing':
        case 'damaged':
            return 'This backup is not what it was when it was made, so it was not used. Nothing was changed. Choose another backup from the list. If none is left, press Create backup to save your current files again.'
        case 'wrong-version':
        case 'app-too-new':
            return 'This backup was made by a different (newer) version of the app. Use this backup with the app version that made it, or newer. Nothing was changed.'
        case 'version-unknown':
            return 'The app cannot tell if this backup is safe, so it was not used. Nothing was changed. Choose another backup from the list.'
        case 'content-invalid':
            return 'A file inside this backup is not usable (it was already broken when the backup was made), so it was not used. Nothing was changed. Choose another backup from the list.'
        case 'run-active':
            return 'Open the Home page, press Stop, wait until the run has stopped, then open Restore again.'
        case 'no-target':
            return 'Open the Home page and choose your accounts file (Accounts Path / Open). If the engine files are missing, open the Health page and read the rows under "Engine". Then open Restore again.'
        case 'snapshot-failed':
            return 'The safety copy of your current files could not be made, so the restore did not go on and nothing was changed. Free some space or close programs that use the app data folder, then try again.'
    }
}

// ---- Phase 21: the record of a restore (the "journal") ------------------------------------------------------------------------
//
// Written by the app BEFORE the first user file is touched and updated at every step, so a restore that was cut short (power
// cut, crash, the app killed) is found again at the next start. It holds NO secret: names, SHA-256 checksums, times, ids. The
// accounts file place is kept only as a SHA-256 of the normalised path (never the path), to notice later that the user chose
// another accounts file, so an undo never writes old accounts into the wrong file.
//
// States:
//   applying -> applied                (the restore ran to the end and every file was read back and checked)
//   applying -> undone                 (a write failed and the app put everything back by itself)
//   applying | applied -> undoing -> undone   (the user pressed Undo)

export const JOURNAL_FORMAT = 'rewards-farmer-restore-journal'
export const JOURNAL_VERSION = 1
export const JOURNAL_FILE_NAME = 'restore-journal.json'

export type JournalState = 'applying' | 'applied' | 'undoing' | 'undone'
export type JournalEnd = 'finished' | 'rolled-back' | 'undone'

export interface JournalFile {
    readonly role: BackupRole
    // Only files that the restore writes are listed (replace or create). A file that stays as it is is not in the record.
    readonly action: 'replace' | 'create'
    // SHA-256 of the file before the restore. null = the file did not exist (the restore creates it).
    readonly beforeSha256: string | null
    // SHA-256 of the file as the restore writes it.
    readonly afterSha256: string
}

export type JournalSnapshot =
    // The safety copy (in the pre-restore folder) that holds the files as they were before the restore.
    | { readonly status: 'created'; readonly id: string }
    // No user file existed, so there was nothing to copy. Undo then only removes what the restore created.
    | { readonly status: 'nothing-to-save' }

export interface RestoreJournal {
    readonly format: typeof JOURNAL_FORMAT
    readonly version: typeof JOURNAL_VERSION
    readonly id: string
    readonly state: JournalState
    readonly startedAt: string
    readonly updatedAt: string
    readonly backupId: string
    readonly appVersion: string
    readonly snapshot: JournalSnapshot
    // SHA-256 of the normalised path of the accounts file at the time of the restore. null = no accounts file was chosen.
    readonly accountsPlaceSha256: string | null
    readonly files: readonly JournalFile[]
    // The safety copy made just before an undo (so an undo loses nothing). null until an undo has started.
    readonly undoSafetyCopyId: string | null
    // How the record ended. null while it is still going on.
    readonly end: JournalEnd | null
}

const SHA256_RE = /^[0-9a-f]{64}$/
const JOURNAL_ID_RE = /^restore-[0-9-]{1,30}$/
const BACKUP_ID_RE = /^backup-[0-9-]{1,30}$/
const STATES: readonly JournalState[] = ['applying', 'applied', 'undoing', 'undone']
const ENDS: readonly JournalEnd[] = ['finished', 'rolled-back', 'undone']

export function restoreIdFor(d: Date): string {
    return backupIdFor(d).replace(/^backup-/, 'restore-')
}

const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

export type JournalCheck =
    { readonly ok: true; readonly journal: RestoreJournal } | { readonly ok: false; readonly message: string }

// Strict: anything that is not exactly what the app writes is "damaged". A damaged record is never trusted.
export function parseJournal(text: string): JournalCheck {
    const bad = (message: string): JournalCheck => ({ ok: false, message })
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return bad('The record is not valid JSON.')
    }
    if (!isObj(raw)) return bad('The record is not an object.')
    if (raw['format'] !== JOURNAL_FORMAT) return bad('This is not a restore record of this app.')
    if (raw['version'] !== JOURNAL_VERSION) return bad('The record version is not supported by this app.')
    const id = raw['id']
    if (typeof id !== 'string' || !JOURNAL_ID_RE.test(id)) return bad('The record has no valid id.')
    const state = raw['state']
    if (typeof state !== 'string' || !STATES.includes(state as JournalState))
        return bad('The record has no valid state.')
    const startedAt = raw['startedAt']
    const updatedAt = raw['updatedAt']
    if (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt)))
        return bad('The record has no valid start time.')
    if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt)))
        return bad('The record has no valid update time.')
    const backupId = raw['backupId']
    if (typeof backupId !== 'string' || !BACKUP_ID_RE.test(backupId))
        return bad('The record has no valid backup id.')
    const appVersion = raw['appVersion']
    if (typeof appVersion !== 'string' || appVersion === '') return bad('The record has no app version.')

    const snap = raw['snapshot']
    let snapshot: JournalSnapshot
    if (!isObj(snap)) return bad('The record has no safety copy entry.')
    if (snap['status'] === 'nothing-to-save') snapshot = { status: 'nothing-to-save' }
    else if (snap['status'] === 'created' && typeof snap['id'] === 'string' && BACKUP_ID_RE.test(snap['id']))
        snapshot = { status: 'created', id: snap['id'] }
    else return bad('The safety copy entry in the record is not valid.')

    const place = raw['accountsPlaceSha256']
    if (place !== null && (typeof place !== 'string' || !SHA256_RE.test(place)))
        return bad('The accounts place entry in the record is not valid.')

    const filesRaw = raw['files']
    if (!Array.isArray(filesRaw) || filesRaw.length === 0 || filesRaw.length > BACKUP_ROLES.length)
        return bad('The record lists no files.')
    const files: JournalFile[] = []
    const seen = new Set<string>()
    for (const f of filesRaw as unknown[]) {
        if (!isObj(f)) return bad('A file entry in the record is not valid.')
        const def = BACKUP_ROLES.find((r) => r.role === f['role'])
        if (def === undefined) return bad('A file entry has an unknown role.')
        if (seen.has(def.role)) return bad('A role is listed twice in the record.')
        seen.add(def.role)
        const action = f['action']
        if (action !== 'replace' && action !== 'create') return bad('A file entry has an unknown action.')
        const before = f['beforeSha256']
        if (before !== null && (typeof before !== 'string' || !SHA256_RE.test(before)))
            return bad('A file entry has an invalid checksum.')
        if ((action === 'create') !== (before === null)) return bad('A file entry does not match its action.')
        const after = f['afterSha256']
        if (typeof after !== 'string' || !SHA256_RE.test(after))
            return bad('A file entry has an invalid checksum.')
        files.push({ role: def.role, action, beforeSha256: before, afterSha256: after })
    }
    // A record that says "replace" needs a safety copy to put the old file back from.
    if (snapshot.status === 'nothing-to-save' && files.some((f) => f.action === 'replace'))
        return bad('The record says a file was replaced but no safety copy was made.')

    const undoCopy = raw['undoSafetyCopyId']
    if (undoCopy !== null && (typeof undoCopy !== 'string' || !BACKUP_ID_RE.test(undoCopy)))
        return bad('The undo safety copy entry in the record is not valid.')
    const end = raw['end']
    if (end !== null && (typeof end !== 'string' || !ENDS.includes(end as JournalEnd)))
        return bad('The record has no valid end entry.')
    return {
        ok: true,
        journal: {
            format: JOURNAL_FORMAT,
            version: JOURNAL_VERSION,
            id,
            state: state as JournalState,
            startedAt,
            updatedAt,
            backupId,
            appVersion,
            snapshot,
            accountsPlaceSha256: place,
            files,
            undoSafetyCopyId: undoCopy,
            end: end as JournalEnd | null
        }
    }
}

export function journalToText(journal: RestoreJournal): string {
    return `${JSON.stringify(journal, null, 4)}\n`
}

// The accounts file place as a fingerprint (never the path). Same normalisation as samePlace: on Windows case and slash style
// do not matter.
export function placeFingerprint(
    path: string | null,
    platform: string,
    sha256Hex: (text: string) => string
): string | null {
    if (path === null) return null
    const slashed = platform === 'win32' ? path.replace(/\//g, '\\') : path
    const trimmed = slashed.length > 1 ? slashed.replace(/[\\/]+$/, '') : slashed
    return sha256Hex(platform === 'win32' ? trimmed.toLowerCase() : trimmed)
}

// What the Backups page says about the last restore. `blockedReason` = why Undo cannot be used right now (a run is active, the
// accounts file was changed since). null = it can be used.
export function historyFromJournal(journal: RestoreJournal, blockedReason: string | null): RestoreHistory {
    const files = journal.files.map((f) => ({
        role: f.role,
        label: roleLabel(f.role),
        action: f.action
    }))
    const base = {
        backupId: journal.backupId,
        startedAt: journal.startedAt,
        finishedAt: journal.state === 'applying' || journal.state === 'undoing' ? null : journal.updatedAt,
        files
    }
    switch (journal.state) {
        case 'applied':
            return {
                ...base,
                status: 'undo-available',
                message:
                    'The last restore finished. If you do not like the result, Undo puts your files back as they were just before it.',
                canUndo: blockedReason === null,
                undoBlockedReason: blockedReason
            }
        case 'applying':
            return {
                ...base,
                status: 'interrupted',
                message:
                    'A restore was interrupted (the app was closed, crashed or the PC lost power while it was working). Some of your files may be restored and some not. Press Undo to put every file back as it was before that restore.',
                canUndo: blockedReason === null,
                undoBlockedReason: blockedReason
            }
        case 'undoing':
            return {
                ...base,
                status: 'undo-interrupted',
                message:
                    'An undo was interrupted. Some of your files may be put back and some not. Press Undo again to finish it.',
                canUndo: blockedReason === null,
                undoBlockedReason: blockedReason
            }
        case 'undone':
            return {
                ...base,
                status: 'undone',
                message:
                    journal.end === 'rolled-back'
                        ? 'The last restore could not be finished. The app put every file back as it was. Nothing is left to undo.'
                        : 'The last restore was undone. Your files are as they were before it. Nothing is left to undo.',
                canUndo: false,
                undoBlockedReason: null
            }
    }
}

export function roleLabel(role: BackupRole): string {
    return BACKUP_ROLES.find((r) => r.role === role)?.label ?? role
}

// "What to do" texts for the steps of Phase 21 (plain words, exact names of buttons, no typed commands - rule 27).
export const APPLY_FIX = {
    notConfirmed:
        'Tick the box that says you understand, then press Restore now again. Nothing was read or changed.',
    interruptedEarlier:
        'Close this window, press Undo in the box "Last restore" on the Backups page, and then restore again. Nothing was changed now.',
    writeFailedRolledBack:
        'Every file was put back as it was, and the app checked that. Close programs that may use these files (an editor, a sync tool, a virus scanner), check that the drive has free space, then try again.',
    writeFailedNeedsUndo:
        'The automatic put-back did not work. Do not start the engine. Press Undo in the box "Last restore" on the Backups page. If Undo also fails, open the Health page and export the diagnostics bundle for the person who helps you.',
    snapshotFailed:
        'The safety copy could not be made, so nothing was changed. Free some space, then try again.'
} as const

export const UNDO_FIX = {
    notConfirmed:
        'Tick the box that says you understand, then press Undo again. Nothing was read or changed.',
    nothingToUndo: 'There is no restore to undo. Nothing was changed.',
    safetyFailed:
        'The safety copy of your files as they are now could not be made, so the undo did not go on and nothing was changed. Free some space, then try again.',
    writeFailed:
        'Some files may be put back and some not. Press Undo again to finish it. Do not start the engine before that. If it fails again, open the Health page and export the diagnostics bundle for the person who helps you.',
    safetyCopyDamaged:
        'The safety copy from before the restore is not in the state it was made in, so the app will not use it. Nothing was changed. Your normal backups on the Backups page are still there: choose one and restore it.',
    accountsMoved:
        'You chose another accounts file after the restore. An undo would write the old accounts into that other file, so it is refused. Nothing was changed. Choose the old accounts file again on Home, then press Undo.'
} as const
