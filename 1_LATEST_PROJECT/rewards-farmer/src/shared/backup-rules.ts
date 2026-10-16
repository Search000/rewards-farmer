import type {
    BackupFailReason,
    BackupFileEntry,
    BackupManifest,
    BackupRole,
    BackupSkippedEntry,
    BackupVerifyProblem
} from './backup-types'

// Phase 18: pure rules for backups (no file access here, so the page and the tests can use them too).
// Phase 19 adds: the comparison used by the check after writing, the "what to do" texts, the free-space rule.

export const BACKUP_FORMAT = 'rewards-farmer-backup'
export const BACKUP_MANIFEST_VERSION = 1
export const MANIFEST_FILE_NAME = 'manifest.json'
// One source file larger than this is refused (an accounts file or config.json is a few KB; this guards against a wrong path).
export const MAX_BACKUP_SOURCE_BYTES = 20 * 1024 * 1024
// Unfinished work lives in a folder that starts with this text. Such a folder is never a backup.
export const TEMP_PREFIX = '.tmp-'
// Phase 20: the exact text parseManifest gives for a manifest of another version. The restore check recognises it by this
// constant (never by guessing at words), so "made by a different manifest version" is told apart from "damaged".
export const MANIFEST_VERSION_MESSAGE = 'The manifest version is not supported by this app.'

export interface BackupRoleDef {
    readonly role: BackupRole
    readonly name: string
    readonly label: string
    readonly containsSecrets: boolean
}

// Fixed file names. A role never takes its file name from the user's folder path (no path tricks possible).
export const BACKUP_ROLES: readonly BackupRoleDef[] = [
    {
        role: 'engine-config',
        name: 'engine-config.json',
        label: 'Engine settings (config.json)',
        containsSecrets: true
    },
    { role: 'accounts', name: 'accounts.env', label: 'Accounts file', containsSecrets: true },
    { role: 'app-settings', name: 'app-settings.json', label: 'App settings', containsSecrets: false }
]

export function roleDef(role: BackupRole): BackupRoleDef {
    const def = BACKUP_ROLES.find((r) => r.role === role)
    if (def === undefined) throw new Error('Unknown backup role.')
    return def
}

const ID_RE = /^backup-\d{8}-\d{6}-\d{3}(?:-\d{1,3})?$/

export function isBackupId(value: unknown): value is string {
    return typeof value === 'string' && ID_RE.test(value)
}

// backup-YYYYMMDD-HHMMSS-mmm in local time (same style as the other backup copies in this app).
export function backupIdFor(d: Date): string {
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    return `backup-${String(d.getFullYear())}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}

// Counts the accounts in an accounts file by their ACCOUNT_N_EMAIL lines. Reads no value, keeps no e-mail.
export function countAccountSlots(text: string): number {
    const slots = new Set<string>()
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*ACCOUNT_(\d+)_EMAIL\s*=/.exec(line)
        if (m?.[1] !== undefined) slots.add(m[1])
    }
    return slots.size
}

const SHA256_RE = /^[0-9a-f]{64}$/

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonNegInt(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

export type ManifestCheck =
    | { readonly ok: true; readonly manifest: BackupManifest }
    | { readonly ok: false; readonly message: string }

const reject = (message: string): ManifestCheck => ({ ok: false, message })

// Strict check of a manifest read from disk. Anything unexpected is rejected, nothing is guessed.
export function parseManifest(text: string): ManifestCheck {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return reject('The manifest is not valid JSON.')
    }
    if (!isObject(raw)) return reject('The manifest is not an object.')
    if (raw['format'] !== BACKUP_FORMAT) return reject('This is not a Rewards Farmer backup manifest.')
    if (raw['manifestVersion'] !== BACKUP_MANIFEST_VERSION) return reject(MANIFEST_VERSION_MESSAGE)
    const id = raw['id']
    if (!isBackupId(id)) return reject('The manifest has no valid backup id.')
    const appVersion = raw['appVersion']
    if (typeof appVersion !== 'string' || appVersion === '') return reject('The manifest has no app version.')
    const createdAt = raw['createdAt']
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt)))
        return reject('The manifest has no valid time.')
    const platform = raw['platform']
    if (typeof platform !== 'string') return reject('The manifest has no platform.')
    const totalBytes = raw['totalBytes']
    if (!isNonNegInt(totalBytes)) return reject('The manifest has no valid total size.')
    const accountCount = raw['accountCount']
    if (accountCount !== null && !isNonNegInt(accountCount))
        return reject('The manifest has no valid account count.')

    const filesRaw = raw['files']
    if (!Array.isArray(filesRaw) || filesRaw.length === 0) return reject('The manifest lists no files.')
    const files: BackupFileEntry[] = []
    const seen = new Set<string>()
    for (const f of filesRaw as unknown[]) {
        if (!isObject(f)) return reject('A file entry in the manifest is not valid.')
        const def = BACKUP_ROLES.find((r) => r.role === f['role'])
        if (def === undefined) return reject('A file entry has an unknown role.')
        if (seen.has(def.role)) return reject('A role is listed twice in the manifest.')
        seen.add(def.role)
        if (f['name'] !== def.name) return reject(`The file name for "${def.role}" is not the expected one.`)
        const sizeBytes = f['sizeBytes']
        if (!isNonNegInt(sizeBytes)) return reject(`The size of "${def.name}" is not valid.`)
        const sha256 = f['sha256']
        if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256))
            return reject(`The checksum of "${def.name}" is not valid.`)
        if (f['containsSecrets'] !== def.containsSecrets)
            return reject(`The secrets flag of "${def.name}" is not the expected one.`)
        files.push({
            role: def.role,
            name: def.name,
            sizeBytes,
            sha256,
            containsSecrets: def.containsSecrets
        })
    }
    if (files.reduce((n, f) => n + f.sizeBytes, 0) !== totalBytes)
        return reject('The total size does not match the listed files.')
    const hasAccounts = files.some((f) => f.role === 'accounts')
    if (hasAccounts !== (accountCount !== null))
        return reject('The account count does not match the listed files.')

    const skippedRaw = raw['skipped']
    if (!Array.isArray(skippedRaw)) return reject('The manifest has no skipped list.')
    const skipped: BackupSkippedEntry[] = []
    for (const s of skippedRaw as unknown[]) {
        if (!isObject(s)) return reject('A skipped entry in the manifest is not valid.')
        const def = BACKUP_ROLES.find((r) => r.role === s['role'])
        if (def === undefined) return reject('A skipped entry has an unknown role.')
        if (typeof s['reason'] !== 'string' || s['reason'] === '')
            return reject('A skipped entry has no reason.')
        if (seen.has(def.role)) return reject('A role is both saved and skipped.')
        skipped.push({ role: def.role, reason: s['reason'] })
    }

    return {
        ok: true,
        manifest: {
            format: BACKUP_FORMAT,
            manifestVersion: BACKUP_MANIFEST_VERSION,
            id,
            appVersion,
            createdAt,
            platform,
            files,
            skipped,
            totalBytes,
            accountCount
        }
    }
}

export function manifestToText(manifest: BackupManifest): string {
    return `${JSON.stringify(manifest, null, 4)}\n`
}

// ---- Phase 19 ---------------------------------------------------------------------------------------------------------

// A backup needs its files plus a little room for the manifest and the folder itself. Less free space than this and the
// backup is refused BEFORE anything is written (clear message instead of a half-full disk).
export const MIN_FREE_RESERVE_BYTES = 1024 * 1024

export function requiredFreeBytes(totalBytes: number): number {
    return totalBytes + MIN_FREE_RESERVE_BYTES
}

export function formatBytes(n: number): string {
    if (n < 1024) return `${String(n)} bytes`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// Compares ONE stored file with its manifest entry. `actual` is what was really read from the disk just now.
// Returns the problem, or null when the file is exactly what the manifest says.
export function verifyEntry(
    entry: BackupFileEntry,
    actual: { readonly size: number; readonly sha256: string }
): BackupVerifyProblem | null {
    const label = roleDef(entry.role).label
    if (actual.size !== entry.sizeBytes) {
        return {
            kind: 'size-differs',
            file: entry.name,
            text: `${label} (${entry.name}) has a different size than when the backup was made (${formatBytes(actual.size)} instead of ${formatBytes(entry.sizeBytes)}).`
        }
    }
    if (actual.sha256 !== entry.sha256) {
        return {
            kind: 'checksum-differs',
            file: entry.name,
            text: `${label} (${entry.name}) was changed after the backup was made (its checksum does not match).`
        }
    }
    return null
}

// The reason for a file system error code. Never a path.
export function reasonFromErrno(code: string | undefined): BackupFailReason {
    switch (code) {
        case 'EACCES':
        case 'EPERM':
            return 'permission-denied'
        case 'ENOSPC':
            return 'disk-full'
        case 'EROFS':
            return 'read-only'
        default:
            return 'unknown'
    }
}

// "What to do" for each reason. Plain words, exact names of buttons and pages, no typed commands (rule 27).
export function failureFix(reason: BackupFailReason): string {
    switch (reason) {
        case 'permission-denied':
            return 'Windows did not let the app use a file or folder. Close any program that may be holding it (a backup or sync tool, an antivirus scan), then press Create backup again. If it keeps failing, open the Health page and look at the row "App data folder (read and write)".'
        case 'disk-full':
        case 'low-space':
            return 'The drive that holds the app data is full or nearly full. Free some space (empty the Recycle Bin, delete files you no longer need), then press Create backup again. The Health page row "Free disk space" shows how much is free.'
        case 'read-only':
            return 'The folder that holds the backups is read-only. Check that the drive is not write-protected or full, then press Create backup again.'
        case 'source-unreadable':
            return 'One of your own files could not be read, so nothing was saved (a backup with a gap would look complete when it is not). Close any program that is using the file, then press Create backup again. The Health page shows which files the app can read.'
        case 'source-not-file':
        case 'source-too-large':
            return 'One of the files to back up is not what the app expects (a folder instead of a file, or far too large). Open the Home page and check which accounts file is chosen, then press Create backup again.'
        case 'nothing-to-back-up':
            return 'There is nothing to back up yet. On the Home page choose your accounts file and press Create config if the engine settings do not exist, then press Create backup again.'
        case 'copy-differs':
            return 'The copy on the disk did not match the original. This can be a failing drive or a program that changes files. Press Create backup again. If it happens again, try another drive or pause your antivirus for this folder.'
        case 'verify-failed':
            return 'The backup was written, but the check afterwards found a problem, so the app set it aside. It will never be used. Press Create backup again. If it happens again, close other programs that touch the app data folder and check the drive.'
        case 'unknown':
            return 'Press Create backup again. If it fails again, open the Health page and export the diagnostics bundle for the person who helps you.'
    }
}
