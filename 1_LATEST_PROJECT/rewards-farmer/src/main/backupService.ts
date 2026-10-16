import { randomBytes, createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
    BACKUP_FORMAT,
    BACKUP_MANIFEST_VERSION,
    BACKUP_ROLES,
    MANIFEST_FILE_NAME,
    MAX_BACKUP_SOURCE_BYTES,
    TEMP_PREFIX,
    backupIdFor,
    countAccountSlots,
    failureFix,
    formatBytes,
    isBackupId,
    manifestToText,
    parseManifest,
    reasonFromErrno,
    requiredFreeBytes,
    roleDef,
    verifyEntry
} from '../shared/backup-rules'
import type { BackupRoleDef } from '../shared/backup-rules'
import type {
    BackupCreateResult,
    BackupFailReason,
    BackupFileEntry,
    BackupInspectResult,
    BackupListResult,
    BackupManifest,
    BackupRole,
    BackupSkippedEntry,
    BackupSummary,
    BackupVerification,
    BackupVerifyProblem
} from '../shared/backup-types'
import type { ActionResult, ErrorCode } from '../shared/farmer-types'
import type { Redactor } from './engine/redact'
import type { JsonlLog } from './jsonlLog'
import { restrictToCurrentUser } from './privatePerms'
import type { PermsResult } from './privatePerms'

// Backup service (Phase 18). Makes ONE backup of the user's own data:
//   - engine settings (the engine's config.json; it can hold webhook tokens),
//   - the accounts file (it holds passwords and 2FA secrets),
//   - the app settings file (no secrets).
// What is NOT in a backup: browser sessions, logs, the engine program, node_modules. (Sessions can be rebuilt by logging in
// again; logs can hold personal data and are not user settings.)
//
// Secrets (Phase 10 rules, threat model T6): the files are stored exactly as they are (a restore needs the real values), so
// the backup folder is private to the current user (POSIX 700 / 600, Windows icacls) from the first byte. A secret VALUE is
// never logged, never returned and never written into the manifest. The manifest only has names, sizes and checksums.
//
// "Never a half-written backup" (rule 4 of this phase):
//   1. everything is written inside a hidden temporary folder (".tmp-..."), which is never listed or used as a backup,
//   2. each file is flushed to disk and read back; its checksum must match what was meant to be written,
//   3. the manifest is written LAST and read back through the strict parser,
//   4. only then the folder is renamed to its final name in one step. A crash before the rename leaves only ".tmp-...".
//
// Phase 19 adds the check AFTER writing. Once the folder has its final name, every file is read again from the disk and
// compared with the manifest (manifest valid and the right id, every file present, size, SHA-256). If anything is wrong the
// folder is renamed to a hidden ".tmp-failed-..." name (never deleted: it is the user's own data, rule 10), so it can never
// look like a good backup. list() and inspect() run the same check every time, so a backup that is damaged LATER (a file
// deleted by an antivirus, a changed byte) is shown as "Damaged" instead of being trusted. The service refuses to start a
// backup when the drive has less free space than the backup needs, before a single byte is written.

export interface BackupSources {
    // Full path of the engine config.json.
    readonly engineConfigPath: string
    // Full path of app-settings.json in the user-data folder.
    readonly appSettingsPath: string
    // The accounts file the user chose. null = none chosen yet.
    readonly accountsPath: () => string | null
}

export interface DirEntryInfo {
    readonly name: string
    readonly isDirectory: boolean
}

// The file operations the service uses. Production = real disk. Tests replace single operations to simulate a failing disk.
export interface BackupFs {
    stat(path: string): Promise<{ readonly size: number; readonly isFile: boolean }>
    readFile(path: string): Promise<Buffer>
    mkdir(path: string, mode: number): Promise<void>
    // Writes the bytes, flushes them to the disk, closes the file. The file is created with mode 600.
    writeFileSynced(path: string, data: Buffer): Promise<void>
    rename(from: string, to: string): Promise<void>
    rm(path: string): Promise<void>
    readdir(path: string): Promise<readonly DirEntryInfo[]>
    exists(path: string): Promise<boolean>
    // Best effort (some systems cannot flush a folder).
    syncDir(path: string): Promise<void>
    // Free bytes on the drive that holds `path` (or the nearest folder that exists above it). null = cannot be read.
    freeBytes(path: string): Promise<number | null>
}

export const realBackupFs: BackupFs = {
    async stat(path) {
        const s = await stat(path)
        return { size: s.size, isFile: s.isFile() }
    },
    readFile: (path) => readFile(path),
    async mkdir(path, mode) {
        await mkdir(path, { recursive: true, mode })
    },
    async writeFileSynced(path, data) {
        const handle = await open(path, 'wx', 0o600)
        try {
            await handle.writeFile(data)
            await handle.sync()
        } finally {
            await handle.close()
        }
    },
    rename: (from, to) => rename(from, to),
    rm: (path) => rm(path, { recursive: true, force: true }),
    async readdir(path) {
        const list = await readdir(path, { withFileTypes: true })
        return list.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }))
    },
    async exists(path) {
        try {
            await stat(path)
            return true
        } catch {
            return false
        }
    },
    async syncDir(path) {
        try {
            const handle = await open(path, 'r')
            try {
                await handle.sync()
            } finally {
                await handle.close()
            }
        } catch {
            // Windows cannot open a folder like this. The rename is still atomic there.
        }
    },
    async freeBytes(path) {
        // The backup folder may not exist yet: ask the nearest folder above it that does.
        let probe = path
        for (let i = 0; i < 64; i++) {
            try {
                await stat(probe)
                const info = await statfs(probe)
                const free = Number(info.bavail) * Number(info.bsize)
                return Number.isFinite(free) ? free : null
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return null
                const up = dirname(probe)
                if (up === probe) return null
                probe = up
            }
        }
        return null
    }
}

export interface BackupDeps {
    readonly sources: BackupSources
    // Folder that holds all backups, for example <userData>/backups/full. Private to the current user.
    readonly backupRoot: string
    readonly appVersion: string
    readonly redactor: Redactor
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    readonly now?: () => Date
    readonly restrict?: (path: string, isDir: boolean) => Promise<PermsResult>
    readonly fs?: Partial<BackupFs>
    readonly platform?: string
    // Opens a folder in the file explorer (Electron shell.openPath). Resolves to '' on success or an error text.
    // Not given = the "open folder" action says it is not available.
    readonly openPath?: (path: string) => Promise<string>
}

// Phase 20: what a restore gets from the backup folder. `files` holds the exact bytes that passed the check (only files that
// matched the manifest, so a damaged file is never in it). Never leaves the main process.
export type LoadedBackup =
    | { readonly kind: 'bad-name' }
    | { readonly kind: 'not-found' }
    | {
          readonly kind: 'checked'
          // null = the folder has no usable manifest.
          readonly manifest: BackupManifest | null
          readonly verification: BackupVerification
          readonly files: ReadonlyMap<BackupRole, Buffer>
      }

// A problem that already has a plain-language text (shown as it is).
class StepProblem extends Error {
    constructor(
        message: string,
        readonly reason: BackupFailReason
    ) {
        super(message)
    }
}

// Plain words for a file system error code. Never the path (it can hold the Windows user name).
export function ioProblem(error: unknown): string {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    switch (code) {
        case 'EACCES':
        case 'EPERM':
            return 'permission denied'
        case 'ENOSPC':
            return 'the disk is full'
        case 'EROFS':
            return 'the folder is read-only'
        case 'ENOENT':
            return 'a file or folder is missing'
        case 'EISDIR':
            return 'a folder was found where a file was expected'
        case 'EMFILE':
            return 'too many files are open'
        default:
            return typeof code === 'string' ? `error ${code}` : 'unknown error'
    }
}

const fail = (code: ErrorCode, message: string, reason: BackupFailReason): BackupCreateResult => ({
    ok: false,
    code,
    message,
    reason,
    fix: failureFix(reason)
})

function sha256(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex')
}

interface Checked {
    // null = the folder has no usable manifest (so it is not a backup at all).
    readonly manifest: BackupManifest | null
    readonly verification: BackupVerification
}

interface Collected {
    readonly def: BackupRoleDef
    readonly data: Buffer
}

export class BackupService {
    private queue: Promise<unknown> = Promise.resolve()
    private readonly fs: BackupFs

    constructor(private readonly deps: BackupDeps) {
        this.fs = { ...realBackupFs, ...deps.fs }
    }

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date()
    }

    private restrict(path: string, isDir: boolean): Promise<PermsResult> {
        return (this.deps.restrict ?? restrictToCurrentUser)(path, isDir)
    }

    // One backup at a time. A second request waits for the first one.
    create(): Promise<BackupCreateResult> {
        const next = this.queue.then(
            () => this.run(),
            () => this.run()
        )
        this.queue = next.catch(() => undefined)
        return next
    }

    // ---- list, inspect, open folder (Phase 19; all read-only) --------------------------------------------------------

    // Every listed backup carries a FRESH check of what is on the disk right now. A folder without a usable manifest is not
    // a backup (it is only counted as unfinished). A folder with a manifest but a missing or changed file IS listed, marked
    // as failed, so the user sees that it is damaged and nothing trusts it.
    async list(): Promise<BackupListResult> {
        let entries: readonly DirEntryInfo[]
        try {
            entries = await this.fs.readdir(this.deps.backupRoot)
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return { ok: true, message: null, backups: [], unfinishedCount: 0 }
            return {
                ok: false,
                message: `The backup folder could not be read (${ioProblem(e)}).`,
                backups: [],
                unfinishedCount: 0
            }
        }
        const backups: BackupSummary[] = []
        let unfinished = 0
        for (const entry of entries) {
            if (!entry.isDirectory) continue
            if (entry.name.startsWith(TEMP_PREFIX)) {
                unfinished += 1
                continue
            }
            if (!isBackupId(entry.name)) continue
            const checked = await this.verifyFolder(entry.name)
            if (checked.manifest === null) {
                unfinished += 1
                continue
            }
            backups.push(this.summary(checked.manifest, checked.verification))
        }
        backups.sort((a, b) =>
            a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)
        )
        return { ok: true, message: null, backups, unfinishedCount: unfinished }
    }

    // Details of ONE backup with a fresh check. The id comes from the renderer, so it is checked against the strict id format
    // first (no path can get through) and the folder is looked up inside the backup folder only.
    async inspect(id: unknown): Promise<BackupInspectResult> {
        if (!isBackupId(id)) {
            return { ok: false, code: 'BAD_REQUEST', message: 'That is not a valid backup name.' }
        }
        if (!(await this.fs.exists(join(this.deps.backupRoot, id)))) {
            return {
                ok: false,
                code: 'NOT_FOUND',
                message: 'This backup no longer exists. Press Check again to refresh the list.'
            }
        }
        const checked = await this.verifyFolder(id)
        if (checked.manifest === null) {
            const first = checked.verification.problems[0]?.text ?? 'The manifest is not usable.'
            return {
                ok: false,
                code: 'READ_FAILED',
                message: `This folder is not a finished backup. ${first}`
            }
        }
        const m = checked.manifest
        return {
            ok: true,
            detail: {
                id: m.id,
                createdAt: m.createdAt,
                appVersion: m.appVersion,
                platform: m.platform,
                totalBytes: m.totalBytes,
                accountCount: m.accountCount,
                files: m.files,
                skipped: m.skipped,
                verification: checked.verification
            }
        }
    }

    // Phase 20 (restore): ONE backup with a fresh check AND the exact bytes that were checked, so the restore works with what
    // was verified and never reads a file twice. Read-only. The id is checked against the strict id format first (no path can
    // get through). The bytes stay in the main process: no bridge call returns them.
    async loadVerified(id: unknown): Promise<LoadedBackup> {
        if (!isBackupId(id)) return { kind: 'bad-name' }
        if (!(await this.fs.exists(join(this.deps.backupRoot, id)))) return { kind: 'not-found' }
        const files = new Map<BackupRole, Buffer>()
        const checked = await this.verifyFolder(id, files)
        return { kind: 'checked', manifest: checked.manifest, verification: checked.verification, files }
    }

    // Opens the backup folder in the file explorer. The path never leaves this process (no argument, no path in the answer).
    async openFolder(): Promise<ActionResult> {
        if (!(await this.fs.exists(this.deps.backupRoot))) {
            return { ok: false, message: 'There is no backup folder yet. Create a backup first.' }
        }
        if (this.deps.openPath === undefined) {
            return { ok: false, message: 'Opening the backup folder is not available here.' }
        }
        try {
            const problem = await this.deps.openPath(this.deps.backupRoot)
            return problem === ''
                ? { ok: true, message: 'The backup folder was opened.' }
                : { ok: false, message: 'The backup folder could not be opened.' }
        } catch {
            return { ok: false, message: 'The backup folder could not be opened.' }
        }
    }

    // The check itself. Reads the folder as it is on the disk NOW and trusts nothing from memory:
    //   1. manifest.json exists, passes the strict parser and carries the same id as the folder,
    //   2. every file it lists is present, is a file, has the listed size and the listed SHA-256.
    // Items the manifest does not list are only a note (a restore uses the listed files only).
    // `keep` (Phase 20, restore): when given, the bytes of every file that was read for the check are stored in it, so a restore
    // works with exactly the bytes that were checked and never reads a file a second time.
    private async verifyFolder(id: string, keep?: Map<BackupRole, Buffer>): Promise<Checked> {
        const dir = join(this.deps.backupRoot, id)
        const problems: BackupVerifyProblem[] = []
        const notes: string[] = []
        const done = (manifest: BackupManifest | null, filesChecked: number): Checked => ({
            manifest,
            verification: {
                status: problems.length === 0 ? 'ok' : 'failed',
                checkedAt: this.now().toISOString(),
                filesChecked,
                problems,
                notes
            }
        })

        let text: string
        try {
            text = (await this.fs.readFile(join(dir, MANIFEST_FILE_NAME))).toString('utf8')
        } catch (e) {
            const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
            problems.push({
                kind: missing ? 'manifest-missing' : 'unreadable',
                file: MANIFEST_FILE_NAME,
                text: missing
                    ? 'The manifest file is missing, so this folder is not a finished backup.'
                    : `The manifest file could not be read (${ioProblem(e)}).`
            })
            return done(null, 0)
        }
        const parsed = parseManifest(text)
        if (!parsed.ok) {
            problems.push({ kind: 'manifest-invalid', file: MANIFEST_FILE_NAME, text: parsed.message })
            return done(null, 0)
        }
        if (parsed.manifest.id !== id) {
            problems.push({
                kind: 'manifest-wrong-id',
                file: MANIFEST_FILE_NAME,
                text: 'The manifest belongs to a different backup (it was copied or renamed by hand).'
            })
            return done(null, 0)
        }
        const manifest = parsed.manifest

        for (const entry of manifest.files) {
            const label = roleDef(entry.role).label
            const path = join(dir, entry.name)
            let info: { readonly size: number; readonly isFile: boolean }
            try {
                info = await this.fs.stat(path)
            } catch (e) {
                const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
                problems.push({
                    kind: missing ? 'file-missing' : 'unreadable',
                    file: entry.name,
                    text: missing
                        ? `${label} (${entry.name}) is missing from the backup.`
                        : `${label} (${entry.name}) could not be checked (${ioProblem(e)}).`
                })
                continue
            }
            if (!info.isFile) {
                problems.push({
                    kind: 'not-a-file',
                    file: entry.name,
                    text: `${label} (${entry.name}) is not a file any more.`
                })
                continue
            }
            let data: Buffer
            try {
                data = await this.fs.readFile(path)
            } catch (e) {
                problems.push({
                    kind: 'unreadable',
                    file: entry.name,
                    text: `${label} (${entry.name}) could not be read (${ioProblem(e)}).`
                })
                continue
            }
            const problem = verifyEntry(entry, { size: data.length, sha256: sha256(data) })
            if (problem !== null) problems.push(problem)
            else keep?.set(entry.role, data)
        }

        try {
            const expected = new Set<string>([MANIFEST_FILE_NAME, ...manifest.files.map((f) => f.name)])
            const extra = (await this.fs.readdir(dir)).filter((d) => !expected.has(d.name)).length
            if (extra > 0) {
                notes.push(
                    `${String(extra)} item(s) in the backup folder are not listed in the manifest. They are ignored.`
                )
            }
        } catch {
            // The listed files were already checked one by one; a folder that cannot be listed adds nothing.
        }
        return done(manifest, manifest.files.length)
    }

    private summary(m: BackupManifest, verification: BackupVerification): BackupSummary {
        return {
            id: m.id,
            createdAt: m.createdAt,
            appVersion: m.appVersion,
            fileCount: m.files.length,
            totalBytes: m.totalBytes,
            skipped: m.skipped,
            verification
        }
    }

    // ---- create --------------------------------------------------------------------------------------------------------

    private sourcePath(role: BackupRole): string | null {
        switch (role) {
            case 'engine-config':
                return this.deps.sources.engineConfigPath
            case 'app-settings':
                return this.deps.sources.appSettingsPath
            case 'accounts':
                return this.deps.sources.accountsPath()
        }
    }

    private async run(): Promise<BackupCreateResult> {
        const startedAt = this.now()

        // 1. Read every source once, in memory. Only "file does not exist" is a normal skip. Any other problem stops the
        //    whole backup: a silent gap would look like a complete backup.
        const collected: Collected[] = []
        const skipped: BackupSkippedEntry[] = []
        for (const def of BACKUP_ROLES) {
            const path = this.sourcePath(def.role)
            if (path === null) {
                skipped.push({ role: def.role, reason: 'No accounts file is chosen yet.' })
                continue
            }
            try {
                const info = await this.fs.stat(path)
                if (!info.isFile) {
                    return this.failed(
                        'READ_FAILED',
                        `${def.label} is not a file. No backup was made.`,
                        'source-not-file'
                    )
                }
                if (info.size > MAX_BACKUP_SOURCE_BYTES) {
                    return this.failed(
                        'READ_FAILED',
                        `${def.label} is larger than ${formatBytes(MAX_BACKUP_SOURCE_BYTES)}, which is not a normal size for this file. No backup was made.`,
                        'source-too-large'
                    )
                }
                collected.push({ def, data: await this.fs.readFile(path) })
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
                    skipped.push({ role: def.role, reason: `${def.label} does not exist yet.` })
                    continue
                }
                return this.failed(
                    'READ_FAILED',
                    `${def.label} could not be read (${ioProblem(e)}). No backup was made.`,
                    'source-unreadable'
                )
            }
        }
        if (collected.length === 0) {
            return this.failed(
                'BACKUP_EMPTY',
                `There is nothing to back up yet. ${skipped.map((s) => s.reason).join(' ')}`,
                'nothing-to-back-up'
            )
        }

        // 1b. Enough room on the drive? Refused BEFORE anything is written, so a full disk never gets a half-full backup.
        const totalBytes = collected.reduce((n, c) => n + c.data.length, 0)
        const needBytes = requiredFreeBytes(totalBytes)
        let freeNow: number | null
        try {
            freeNow = await this.fs.freeBytes(this.deps.backupRoot)
        } catch {
            freeNow = null // cannot be read: do not block, a real full disk is still caught while writing
        }
        if (freeNow !== null && freeNow < needBytes) {
            return this.failed(
                'WRITE_FAILED',
                `There is not enough free disk space for a backup (about ${formatBytes(needBytes)} are needed, ${formatBytes(Math.max(0, freeNow))} are free). No backup was created.`,
                'low-space'
            )
        }

        // 2. Choose the final name now: the manifest must carry the same id as the folder.
        const notes: string[] = []
        let id: string
        let tempDir = ''
        try {
            id = await this.freeId(backupIdFor(startedAt))
            await this.fs.mkdir(this.deps.backupRoot, 0o700)
            const rootPerms = await this.restrict(this.deps.backupRoot, true)
            if (!rootPerms.ok) notes.push('The permissions of the backup folder could not be tightened.')

            // 3. Hidden temporary folder, private from the start (before any secret byte is written).
            tempDir = join(this.deps.backupRoot, `${TEMP_PREFIX}${id}-${randomBytes(3).toString('hex')}`)
            await this.fs.mkdir(tempDir, 0o700)
            const tempPerms = await this.restrict(tempDir, true)
            if (!tempPerms.ok) {
                notes.push('The permissions of the new backup folder could not be tightened.')
                this.audit('warn', 'permissions', `${id}: ${tempPerms.detail}`)
            }

            // 4. Write each file, flush it, read it back and compare the checksum.
            const entries: BackupFileEntry[] = []
            for (const { def, data } of collected) {
                const target = join(tempDir, def.name)
                const digest = sha256(data)
                await this.fs.writeFileSynced(target, data)
                const back = await this.fs.readFile(target)
                if (back.length !== data.length || sha256(back) !== digest) {
                    throw new StepProblem(
                        `${def.label} was not written correctly (the copy differs from the original).`,
                        'copy-differs'
                    )
                }
                entries.push({
                    role: def.role,
                    name: def.name,
                    sizeBytes: data.length,
                    sha256: digest,
                    containsSecrets: def.containsSecrets
                })
            }

            // 5. Manifest last, then read it back through the strict parser.
            const accounts = collected.find((c) => c.def.role === 'accounts')
            const manifest: BackupManifest = {
                format: BACKUP_FORMAT,
                manifestVersion: BACKUP_MANIFEST_VERSION,
                id,
                appVersion: this.deps.appVersion,
                createdAt: startedAt.toISOString(),
                platform: this.deps.platform ?? process.platform,
                files: entries,
                skipped,
                totalBytes: entries.reduce((n, f) => n + f.sizeBytes, 0),
                accountCount:
                    accounts === undefined ? null : countAccountSlots(accounts.data.toString('utf8'))
            }
            const manifestPath = join(tempDir, MANIFEST_FILE_NAME)
            await this.fs.writeFileSynced(manifestPath, Buffer.from(manifestToText(manifest), 'utf8'))
            const checked = parseManifest((await this.fs.readFile(manifestPath)).toString('utf8'))
            if (!checked.ok || checked.manifest.id !== id) {
                throw new StepProblem('The manifest was not written correctly.', 'copy-differs')
            }

            // 6. Flush the folder, then ONE rename makes it a backup.
            await this.fs.syncDir(tempDir)
            await this.fs.rename(tempDir, join(this.deps.backupRoot, id))
            await this.fs.syncDir(this.deps.backupRoot)

            // 7. The check AFTER writing: read the finished folder again from the disk and compare it with the manifest.
            //    Anything wrong = the folder is set aside under a hidden name and the backup is reported as failed.
            const after = await this.verifyFolder(id)
            if (after.manifest === null || after.verification.status !== 'ok') {
                return await this.setAside(id, after.verification)
            }

            const summary = this.summary(manifest, after.verification)
            const skippedText =
                skipped.length === 0
                    ? ''
                    : ` Not included: ${skipped.map((s) => s.reason.replace(/\.$/, '')).join('; ')}.`
            this.audit(
                'info',
                'ok',
                `${id}: ${String(summary.fileCount)} file(s), ${formatBytes(summary.totalBytes)}, ${String(skipped.length)} skipped, checked after writing: all files match (contents not logged).`
            )
            return {
                ok: true,
                message: `Backup ${id} created and checked: ${String(summary.fileCount)} file(s), ${formatBytes(summary.totalBytes)}, every checksum matches.${skippedText}`,
                backup: summary,
                notes
            }
        } catch (e) {
            // Our own scratch folder only. If it cannot be removed it stays hidden and is never counted as a backup.
            let leftover = false
            if (tempDir !== '') {
                try {
                    await this.fs.rm(tempDir)
                } catch {
                    leftover = true
                    this.deps.appLog.write({
                        level: 'warn',
                        component: 'Backup',
                        action: 'backup-create',
                        result: 'cleanup-failed',
                        message:
                            'An unfinished backup folder could not be removed. It is never used as a backup.'
                    })
                }
            }
            const reason: BackupFailReason =
                e instanceof StepProblem ? e.reason : reasonFromErrno((e as NodeJS.ErrnoException).code)
            const why =
                e instanceof StepProblem ? e.message : `the backup could not be written (${ioProblem(e)})`
            const text = `${why.charAt(0).toUpperCase()}${why.slice(1)}${/[.)]$/.test(why) ? '' : '.'} No backup was created.${leftover ? ' An unfinished temporary folder was left behind. It is never shown or used as a backup.' : ''}`
            this.audit('error', 'write-failed', `Backup failed: ${why}.`)
            return fail('WRITE_FAILED', text, reason)
        }
    }

    // The check after writing failed. The folder gets a hidden ".tmp-failed-" name (never deleted: rule 10) so it can never
    // look like a good backup. If even that rename fails, list() still shows it as Damaged.
    private async setAside(id: string, verification: BackupVerification): Promise<BackupCreateResult> {
        const first = verification.problems[0]?.text ?? 'The check found a problem.'
        let asideOk = true
        try {
            await this.fs.rename(
                join(this.deps.backupRoot, id),
                join(this.deps.backupRoot, `${TEMP_PREFIX}failed-${id}-${randomBytes(3).toString('hex')}`)
            )
        } catch {
            asideOk = false
            this.deps.appLog.write({
                level: 'warn',
                component: 'Backup',
                action: 'backup-create',
                result: 'set-aside-failed',
                message: 'A backup that failed its check could not be set aside. It is listed as Damaged.'
            })
        }
        const text = `The backup was written, but the check afterwards found a problem: ${first} ${asideOk ? 'The app set it aside, so it can never be used as a backup.' : 'The app could not set it aside, so it is listed as Damaged. Do not use it.'}`
        this.audit('error', 'verify-failed', text)
        return fail('WRITE_FAILED', text, 'verify-failed')
    }

    // First free name: backup-...-mmm, or backup-...-mmm-2, -3 ... when two backups start in the same millisecond.
    private async freeId(base: string): Promise<string> {
        let candidate = base
        for (let n = 2; n < 100; n++) {
            if (!(await this.fs.exists(join(this.deps.backupRoot, candidate)))) return candidate
            candidate = `${base}-${String(n)}`
        }
        throw new StepProblem('No free name for the backup folder was found.', 'unknown')
    }

    // `reason` is also the short result word of the audit line.
    private failed(code: ErrorCode, message: string, reason: BackupFailReason): BackupCreateResult {
        this.audit('error', reason, message)
        return fail(code, message, reason)
    }

    private audit(level: 'info' | 'warn' | 'error', result: string, message: string): void {
        this.deps.audit.write({
            level,
            component: 'Backup',
            action: 'backup-create',
            result,
            message: this.deps.redactor.redact(message)
        })
    }
}
