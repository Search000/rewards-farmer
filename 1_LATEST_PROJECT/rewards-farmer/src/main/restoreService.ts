import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
    MAX_BACKUP_SOURCE_BYTES,
    BACKUP_ROLES,
    countAccountSlots,
    formatBytes,
    roleDef
} from '../shared/backup-rules'
import type { BackupFileEntry, BackupManifest, BackupRole } from '../shared/backup-types'
import { extractValues } from '../shared/engine-settings-rules'
import type { ErrorCode } from '../shared/farmer-types'
import {
    APPLY_FIX,
    UNDO_FIX,
    historyFromJournal,
    journalToText,
    parseJournal,
    placeFingerprint,
    planAction,
    problemsFromVerification,
    restoreFix,
    restoreIdFor,
    roleLabel,
    settingsForRestore,
    settingsSchemaProblem,
    versionProblem,
    JOURNAL_FORMAT,
    JOURNAL_VERSION
} from '../shared/restore-rules'
import type { CurrentFile, JournalFile, RestoreJournal } from '../shared/restore-rules'
import type {
    FilesState,
    PreRestoreSnapshot,
    RestoreApplyFailure,
    RestoreApplyResult,
    RestoreApplyStage,
    RestoredFileOutcome,
    RestoreFailure,
    RestoreFilePlan,
    RestoreHistory,
    RestorePreview,
    RestorePrepareResult,
    RestorePreviewResult,
    RestoreProblem,
    RestoreUndoFailure,
    RestoreUndoResult,
    RestoreUndoStage,
    UndoneFileOutcome
} from '../shared/restore-types'
import { ioProblem } from './backupService'
import type { BackupService } from './backupService'
import { MAX_ENV_FILE_BYTES, parseEnvText } from './engine/envFile'
import type { Redactor } from './engine/redact'
import type { JsonlLog } from './jsonlLog'

// Restore, part 1 (Phase 20): check the backup, show what a restore would change, and save a safety copy of the current files.
// `preview` and `prepare` CHANGE NO USER FILE: the only thing they ever write is the safety copy, and that goes through the
// BackupService of the app's own private "pre-restore" folder (the same writing, flushing, checking and one-step rename as a
// normal backup).
//
// Restore, part 2 (Phase 21): `apply` and `undo`. These two are the ONLY functions that change a user file, and only when
// `confirmed === true` (checked first, before anything is read). The way it is made safe:
//   1. everything is checked again from scratch (backup, version, content, current files); a preview is never trusted,
//   2. a FRESH safety copy of the current files is made and read back (so "undo" is exactly the state just before),
//   3. a record (the "journal") is written to the disk BEFORE the first user file is touched, then updated at each step. A
//      restore that is cut short (power cut, crash) is found again at the next start; its state is "interrupted" and Undo
//      puts every file back from the safety copy,
//   4. each file is written the safe way: a temporary file next to it, flushed, then ONE rename (a file is never half written),
//   5. every written file is read back and its SHA-256 compared with the backup,
//   6. any failure while writing puts the files already changed back from the safety copy (by itself), and says so honestly,
//   7. Undo makes yet another safety copy of the files as they are at that moment, so even an undo loses nothing.
// A restore never deletes a file. Only Undo may remove a file, and only one that the restore itself created.
//
// Order of work, always from scratch (a preview that is a minute old is never trusted):
//   1. the backup is read from the disk and checked: manifest, every file present, size and SHA-256 (Phase 19 check),
//   2. the version: a backup of a newer app is refused, one that cannot be read is refused,
//   3. each file inside is checked on its own (a valid config.json, a settings file this app understands, a usable accounts file),
//   4. the current files are read (read-only) and compared, giving the plan: replace, create, unchanged, stays as it is,
//   5. only then, on "Create safety copy": nothing blocks, something would change -> the current files are copied, checked
//      after writing, and reported. If that fails, the restore does not go on.
// Any problem in 1 to 3 refuses the restore BEFORE the current files are even read.
//
// Secrets: file contents are held in memory only while checking, never logged, never returned. Results hold names, sizes and
// counts. The audit line holds the backup name and counts only.

export interface RestoreTargets {
    // Full path of the engine config.json.
    readonly engineConfigPath: string
    // Full path of app-settings.json in the user-data folder.
    readonly appSettingsPath: string
    // The accounts file the user chose. null = none chosen yet.
    readonly accountsPath: () => string | null
}

// The file operations the service uses. Phase 20 used the first three (read-only); Phase 21 adds the ones that write, used only
// by `apply` and `undo`. Tests replace single ones to simulate a failing disk.
export interface RestoreFs {
    stat(path: string): Promise<{ readonly size: number; readonly isFile: boolean }>
    readFile(path: string): Promise<Buffer>
    exists(path: string): Promise<boolean>
    // Phase 21. Writes `data` the safe way: a temporary file in the SAME folder, flushed to the disk, then ONE rename over the
    // target. A reader sees the old file or the whole new file, never a half file. A new file gets mode 600; an existing one
    // keeps its mode. The temporary file is removed when anything fails.
    writeFileAtomic(path: string, data: Buffer): Promise<void>
    // Removes one file. A file that is not there is fine (no error).
    removeFile(path: string): Promise<void>
    mkdir(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
}

export const realRestoreFs: RestoreFs = {
    async stat(path) {
        const s = await stat(path)
        return { size: s.size, isFile: s.isFile() }
    },
    readFile: (path) => readFile(path),
    async exists(path) {
        try {
            await stat(path)
            return true
        } catch {
            return false
        }
    },
    async writeFileAtomic(path, data) {
        let mode = 0o600
        try {
            mode = (await stat(path)).mode & 0o777
        } catch {
            // a new file: private by default
        }
        const tmp = join(dirname(path), `.${basename(path)}.rf-${randomBytes(4).toString('hex')}.tmp`)
        try {
            const handle = await open(tmp, 'wx', mode)
            try {
                await handle.writeFile(data)
                await handle.sync()
            } finally {
                await handle.close()
            }
            await rename(tmp, path)
        } catch (e) {
            await rm(tmp, { force: true }).catch(() => undefined)
            throw e
        }
    },
    async removeFile(path) {
        try {
            await rm(path, { force: false })
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        }
    },
    async mkdir(path) {
        await mkdir(path, { recursive: true, mode: 0o700 })
    },
    rename: (from, to) => rename(from, to)
}

export interface RestoreDeps {
    // The normal backups. Read-only use: loadVerified.
    readonly backups: Pick<BackupService, 'loadVerified'>
    // The safety-copy area (a BackupService whose folder is <userData>/backups/pre-restore). `loadVerified` (Phase 21) reads a
    // safety copy back, checked, when files have to be put back from it.
    readonly snapshots: Pick<BackupService, 'create' | 'inspect' | 'loadVerified'>
    // Phase 21. Full path of the restore record (the journal), for example <userData>/backups/restore-journal.json. Outside
    // both backup folders; private to the current user.
    readonly journalPath: string
    readonly targets: RestoreTargets
    readonly appVersion: string
    // The settings schema this app writes (an older one is upgraded by the app, a newer one is refused).
    readonly settingsSchema: number
    // null = nothing stops a restore. A string = why not (a run is active, the app is busy).
    readonly runBlock: () => string | null
    readonly redactor: Redactor
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    readonly platform?: string
    readonly fs?: Partial<RestoreFs>
    readonly now?: () => Date
    // Phase 21. Runs `work` while the app is marked busy, so nothing else can edit the files at the same time (Start, account
    // edits and settings edits are refused meanwhile). `refused` builds the answer when the app cannot be locked now. Not given
    // = no lock (tests). Production: FarmerService.runRestoreExclusive.
    readonly exclusive?: <T>(work: () => Promise<T>, refused: (why: string) => T) => Promise<T>
    // Phase 21. Called after files were changed (or may have been), inside the lock: the app reads its settings and accounts
    // again and restarts the engine on them. Returns a plain remark for the user, or null. Never throws.
    readonly afterFilesChanged?: () => Promise<string | null>
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')
const sha256Text = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

// A step that failed with a plain-language reason of its own (never a path, never a secret).
class StepFailure extends Error {}

type JournalRead =
    | { readonly kind: 'none' }
    | { readonly kind: 'damaged'; readonly message: string }
    | { readonly kind: 'present'; readonly journal: RestoreJournal }

// Does the safety copy hold exactly the files this restore is about to replace? A file that is replaced must be in the copy
// with the checksum the plan saw; a file that is created must not be in the copy. null = yes.
function planMismatch(entries: readonly BackupFileEntry[], writes: readonly PlannedWrite[]): string | null {
    for (const w of writes) {
        const entry = entries.find((e) => e.role === w.role)
        if (w.action === 'replace' && (entry === undefined || entry.sha256 !== w.beforeSha256)) {
            return `${roleLabel(w.role)} is not the same as when it was checked`
        }
        if (w.action === 'create' && entry !== undefined) {
            return `${roleLabel(w.role)} appeared meanwhile`
        }
    }
    return null
}

// One file that a restore would write (Phase 21). The bytes are exactly what the backup holds (the app settings may differ in
// one field, see settingsForRestore). They stay in the main process.
interface PlannedWrite {
    readonly role: BackupRole
    readonly path: string
    readonly bytes: Buffer
    readonly action: 'replace' | 'create'
    readonly beforeSha256: string | null
    readonly afterSha256: string
}

interface Assessment {
    readonly preview: RestorePreview
    readonly writes: readonly PlannedWrite[]
    // Why the restore cannot go on right now (empty = it can). Same facts as preview.blockers, with a kind and a code.
    readonly blockers: readonly (RestoreProblem & { readonly code: ErrorCode })[]
}

type Assessed =
    | { readonly ok: true; readonly value: Assessment }
    | { readonly ok: false; readonly failure: RestoreFailure }

const ROLE_ORDER: readonly BackupRole[] = BACKUP_ROLES.map((r) => r.role)

const lowerFirst = (s: string): string => `${s.charAt(0).toLowerCase()}${s.slice(1)}`

export class RestoreService {
    private queue: Promise<unknown> = Promise.resolve()
    private readonly fs: RestoreFs

    constructor(private readonly deps: RestoreDeps) {
        this.fs = { ...realRestoreFs, ...deps.fs }
    }

    private get platform(): string {
        return this.deps.platform ?? process.platform
    }

    // ---- preview: read-only ------------------------------------------------------------------------------------------

    // Checks the backup and says what a restore would change. Writes NOTHING (no safety copy, no log of file content).
    async preview(id: unknown): Promise<RestorePreviewResult> {
        const a = await this.assess(id)
        if (!a.ok) {
            this.audit('warn', 'preview-refused', this.idText(id), a.failure.message)
            return a.failure
        }
        const p = a.value.preview
        this.audit(
            'info',
            'preview',
            p.backup.id,
            `Restore preview: ${String(p.changeCount)} file(s) would change, ${String(p.blockers.length)} blocker(s), ${String(p.warnings.length)} warning(s). Nothing was changed.`
        )
        return { ok: true, preview: p }
    }

    // ---- prepare: check again, then the safety copy ------------------------------------------------------------------

    // One at a time (two safety copies must not start together; a prepare must not run while a restore writes files).
    private serial<T>(work: () => Promise<T>): Promise<T> {
        const next = this.queue.then(work, work)
        this.queue = next.catch(() => undefined)
        return next
    }

    prepare(id: unknown): Promise<RestorePrepareResult> {
        return this.serial(() => this.runPrepare(id))
    }

    private async runPrepare(id: unknown): Promise<RestorePrepareResult> {
        // Everything is checked again from scratch: the earlier preview may be old.
        const a = await this.assess(id)
        if (!a.ok) {
            this.audit('warn', 'prepare-refused', this.idText(id), a.failure.message)
            return a.failure
        }
        const { preview, blockers } = a.value

        const first = blockers[0]
        if (first !== undefined) {
            const failure = this.failure(
                'blocked',
                first.code,
                `${first.text} The restore did not go on.`,
                restoreFix(first.kind),
                blockers,
                preview
            )
            this.audit('warn', 'prepare-blocked', preview.backup.id, failure.message)
            return failure
        }

        if (preview.changeCount === 0) {
            const message =
                'Your current files already match this backup, so a restore would change nothing. No safety copy was made.'
            this.audit('info', 'prepare-nothing-to-change', preview.backup.id, message)
            return {
                ok: true,
                message,
                preview,
                snapshot: { status: 'not-needed' },
                userFilesUntouched: true
            }
        }

        // The safety copy of the CURRENT files (the same write-flush-check-rename path as every backup).
        const made = await this.deps.snapshots.create()
        let snapshot: PreRestoreSnapshot
        if (made.ok) {
            // Belt and braces: the copy is read from the disk once more before it is reported as existing.
            const again = await this.deps.snapshots.inspect(made.backup.id)
            if (!again.ok || again.detail.verification.status !== 'ok') {
                const why = again.ok
                    ? (again.detail.verification.problems[0]?.text ?? 'The check found a problem.')
                    : again.message
                const failure = this.failure(
                    'snapshot-failed',
                    'WRITE_FAILED',
                    `The safety copy was written, but the check afterwards found a problem (${why}) The restore did not go on. No file of yours was changed.`,
                    restoreFix('snapshot-failed'),
                    [{ kind: 'snapshot-failed', file: null, text: why }],
                    preview
                )
                this.audit('error', 'snapshot-failed', preview.backup.id, failure.message)
                return failure
            }
            snapshot = {
                status: 'created',
                id: made.backup.id,
                createdAt: made.backup.createdAt,
                fileCount: made.backup.fileCount,
                totalBytes: made.backup.totalBytes,
                notSaved: made.backup.skipped.map((s) => s.reason),
                checked: true
            }
        } else if (made.reason === 'nothing-to-back-up') {
            // None of the three files exists now, so a restore only creates files and there is nothing to lose.
            snapshot = { status: 'nothing-to-save' }
        } else {
            const failure = this.failure(
                'snapshot-failed',
                made.code,
                `The safety copy of your current files could not be made. ${made.message} The restore did not go on. No file of yours was changed.`,
                made.fix,
                [{ kind: 'snapshot-failed', file: null, text: made.message }],
                preview
            )
            this.audit('error', 'snapshot-failed', preview.backup.id, failure.message)
            return failure
        }

        const message =
            snapshot.status === 'created'
                ? `Safety copy ${snapshot.id} of your current files was made and checked (${String(snapshot.fileCount)} file(s), ${formatBytes(snapshot.totalBytes)}). Nothing has been restored or changed yet.`
                : 'You have no current files, so there is nothing to copy. Nothing has been restored or changed yet.'
        this.audit(
            'info',
            'prepared',
            preview.backup.id,
            `${snapshot.status === 'created' ? `Safety copy ${snapshot.id} made and checked.` : 'No current file, no safety copy needed.'} ${String(preview.changeCount)} file(s) would change. No user file was changed.`
        )
        return { ok: true, message, preview, snapshot, userFilesUntouched: true }
    }

    // ---- the check and the plan --------------------------------------------------------------------------------------

    private async assess(id: unknown): Promise<Assessed> {
        // 1. The backup as it is on the disk now (strict id first, then manifest, files, sizes, checksums).
        const loaded = await this.deps.backups.loadVerified(id)
        if (loaded.kind === 'bad-name') {
            return this.reject('BAD_REQUEST', 'That is not a valid backup name.', [
                { kind: 'bad-name', file: null, text: 'That is not a valid backup name.' }
            ])
        }
        if (loaded.kind === 'not-found') {
            return this.reject('NOT_FOUND', 'This backup no longer exists.', [
                { kind: 'not-found', file: null, text: 'This backup no longer exists.' }
            ])
        }
        if (loaded.manifest === null || loaded.verification.status !== 'ok') {
            const problems = problemsFromVerification(loaded.verification.problems)
            const head =
                loaded.manifest === null
                    ? 'This folder is not a finished backup, so it was not used.'
                    : 'This backup is damaged, so it was not used.'
            return this.reject('READ_FAILED', `${head} ${problems[0]?.text ?? ''}`.trim(), problems)
        }
        const manifest = loaded.manifest

        // 2. Version compatibility of the app that made the backup.
        const problems: RestoreProblem[] = []
        const version = versionProblem(manifest.appVersion, this.deps.appVersion)
        if (version !== null) problems.push(version)

        // 3. Each file on its own: is it something this app can use? (Checked with the bytes that passed the check above.)
        const checks = this.contentChecks(manifest, loaded.files)
        problems.push(...checks.problems)
        if (problems.length > 0) {
            return this.reject(
                'READ_FAILED',
                `This backup cannot be used: ${problems[0]?.text ?? ''} Nothing was changed.`,
                problems
            )
        }

        // 4. Only now the current files are looked at (read-only).
        const plans: RestoreFilePlan[] = []
        const writes: PlannedWrite[] = []
        const blockers: (RestoreProblem & { readonly code: ErrorCode })[] = []
        const warnings: string[] = []
        const accountsPlace = this.deps.targets.accountsPath()

        for (const role of ROLE_ORDER) {
            const def = roleDef(role)
            const entry = manifest.files.find((f) => f.role === role)
            const bytes = loaded.files.get(role)
            if (entry === undefined || bytes === undefined) {
                plans.push({
                    role,
                    label: def.label,
                    action: 'keep',
                    text: 'This file was not saved in the backup, so your current file stays exactly as it is.',
                    containsSecrets: def.containsSecrets,
                    backupBytes: null,
                    currentBytes: null,
                    backupAccountCount: null,
                    currentAccountCount: null
                })
                continue
            }

            // What would really be written: the app settings keep the user's current accounts file choice (see settingsForRestore).
            let toWrite = bytes
            if (role === 'app-settings') {
                const effective = settingsForRestore(bytes.toString('utf8'), accountsPlace, this.platform)
                if (effective.keepsCurrentPlace) {
                    toWrite = Buffer.from(effective.text, 'utf8')
                    warnings.push(
                        'The backup remembers another place for the accounts file. The restore keeps the accounts file you have chosen now, puts the saved accounts into it, and restores every other saved setting.'
                    )
                }
            }

            const place = await this.placeOf(role)
            const current: { file: CurrentFile; bytes: Buffer | null } =
                place.path === null
                    ? { file: { state: 'absent' }, bytes: null }
                    : await this.readCurrent(place.path)
            const action = planAction({ sha256: sha256(toWrite) }, current.file, place.hasPlace)
            if ((action === 'replace' || action === 'create') && place.path !== null) {
                writes.push({
                    role,
                    path: place.path,
                    bytes: toWrite,
                    action,
                    beforeSha256: current.file.state === 'present' ? current.file.sha256 : null,
                    afterSha256: sha256(toWrite)
                })
            }

            const backupCount = role === 'accounts' ? countAccountSlots(bytes.toString('utf8')) : null
            const currentCount =
                role === 'accounts' && current.bytes !== null
                    ? countAccountSlots(current.bytes.toString('utf8'))
                    : null

            let text: string
            switch (action) {
                case 'replace':
                    text = `Your current ${lowerFirst(def.label)} will be replaced by the one in the backup.`
                    break
                case 'create':
                    text = `There is no ${lowerFirst(def.label)} now. It will be created from the backup.`
                    break
                case 'unchanged':
                    text = `Your current ${lowerFirst(def.label)} is already exactly the same as in the backup. Nothing to do.`
                    break
                case 'keep':
                    text =
                        'This file was not saved in the backup, so your current file stays exactly as it is.'
                    break
                case 'cannot-restore':
                    text =
                        place.why ??
                        `The current ${lowerFirst(def.label)} could not be read, so a safety copy of it cannot be made.`
                    break
            }
            if (action === 'cannot-restore') {
                blockers.push({
                    kind: 'no-target',
                    file: def.name,
                    text: `${def.label}: ${text}`,
                    code: role === 'accounts' && accountsPlace === null ? 'ACCOUNTS_NOT_SET' : 'WRITE_FAILED'
                })
            }
            if (role === 'accounts' && backupCount !== null) {
                if (backupCount === 0 && action !== 'unchanged') {
                    warnings.push(
                        'The accounts file in this backup has no account in it. After the restore the engine cannot start until you add an account.'
                    )
                } else if (currentCount !== null && backupCount < currentCount && action === 'replace') {
                    warnings.push(
                        `Your current accounts file has ${String(currentCount)} account(s), the backup has ${String(backupCount)}. ${String(currentCount - backupCount)} account(s) would no longer be in the file (they stay in the safety copy).`
                    )
                }
            }
            plans.push({
                role,
                label: def.label,
                action,
                text,
                containsSecrets: def.containsSecrets,
                backupBytes: bytes.length,
                currentBytes: current.bytes === null ? null : current.bytes.length,
                backupAccountCount: backupCount,
                currentAccountCount: currentCount
            })
        }

        if (manifest.platform !== this.platform) {
            warnings.push(
                `This backup was made on another system (${manifest.platform}); this one is ${this.platform}. The files are checked and usable, but read the plan below with care.`
            )
        }

        // A run that is active (or the app being busy) blocks the restore; it does not hide the plan.
        const run = this.deps.runBlock()
        if (run !== null) blockers.unshift({ kind: 'run-active', file: null, text: run, code: 'RUN_ACTIVE' })

        const changeCount = plans.filter((p) => p.action === 'replace' || p.action === 'create').length
        return {
            ok: true,
            value: {
                blockers,
                writes,
                preview: {
                    backup: {
                        id: manifest.id,
                        createdAt: manifest.createdAt,
                        appVersion: manifest.appVersion,
                        platform: manifest.platform
                    },
                    files: plans,
                    changeCount,
                    blockers: blockers.map((b) => b.text),
                    warnings: [...new Set(warnings)],
                    canContinue: blockers.length === 0 && changeCount > 0
                }
            }
        }
    }

    // Is each file in the backup something this app can read? Works on the bytes that passed the checksum check.
    private contentChecks(
        manifest: BackupManifest,
        files: ReadonlyMap<BackupRole, Buffer>
    ): { readonly problems: RestoreProblem[] } {
        const problems: RestoreProblem[] = []
        for (const entry of manifest.files) {
            const bytes = files.get(entry.role)
            const label = roleDef(entry.role).label
            if (bytes === undefined) {
                problems.push({
                    kind: 'damaged',
                    file: entry.name,
                    text: `${label} (${entry.name}) could not be read from the backup.`
                })
                continue
            }
            const text = bytes.toString('utf8')
            if (entry.role === 'engine-config') {
                let parsed: unknown
                try {
                    parsed = JSON.parse(text)
                } catch {
                    problems.push({
                        kind: 'content-invalid',
                        file: entry.name,
                        text: `${label} (${entry.name}) in this backup is not valid JSON. It was already broken when the backup was made.`
                    })
                    continue
                }
                const read = extractValues(parsed, null)
                if (!read.ok) {
                    problems.push({
                        kind: 'content-invalid',
                        file: entry.name,
                        text: `${label} (${entry.name}) in this backup is not usable: ${read.message}`
                    })
                }
            } else if (entry.role === 'app-settings') {
                let parsed: unknown
                try {
                    parsed = JSON.parse(text)
                } catch {
                    problems.push({
                        kind: 'content-invalid',
                        file: entry.name,
                        text: `${label} (${entry.name}) in this backup is not valid JSON. It was already broken when the backup was made.`
                    })
                    continue
                }
                const bad = settingsSchemaProblem(parsed, this.deps.settingsSchema, entry.name)
                if (bad !== null) problems.push(bad)
            } else {
                if (bytes.length > MAX_ENV_FILE_BYTES || text.includes('\u0000')) {
                    problems.push({
                        kind: 'content-invalid',
                        file: entry.name,
                        text: `${label} (${entry.name}) in this backup does not look like an accounts file (too large or not text).`
                    })
                } else {
                    // Reads the grammar the engine reads; only to be sure it is plain KEY=VALUE text. No value is kept.
                    parseEnvText(text)
                }
            }
        }
        return { problems }
    }

    // Where a file would be put back, and whether that place is usable (its folder exists).
    private async placeOf(
        role: BackupRole
    ): Promise<{ path: string | null; hasPlace: boolean; why: string | null }> {
        let path: string | null
        switch (role) {
            case 'engine-config':
                path = this.deps.targets.engineConfigPath
                break
            case 'app-settings':
                path = this.deps.targets.appSettingsPath
                break
            case 'accounts':
                path = this.deps.targets.accountsPath()
                break
        }
        if (path === null) {
            return {
                path: null,
                hasPlace: false,
                why: 'No accounts file is chosen yet, so there is no place to put the saved accounts.'
            }
        }
        if (!(await this.fs.exists(dirname(path)))) {
            return {
                path,
                hasPlace: false,
                why: 'The folder for this file was not found, so it cannot be put back.'
            }
        }
        return { path, hasPlace: true, why: null }
    }

    // Reads the current file (read-only). Anything but "not there" that stops the read means "cannot be read".
    private async readCurrent(path: string): Promise<{ file: CurrentFile; bytes: Buffer | null }> {
        try {
            const info = await this.fs.stat(path)
            if (!info.isFile || info.size > MAX_BACKUP_SOURCE_BYTES)
                return { file: { state: 'unreadable' }, bytes: null }
            const bytes = await this.fs.readFile(path)
            return { file: { state: 'present', sha256: sha256(bytes) }, bytes }
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return { file: { state: 'absent' }, bytes: null }
            return { file: { state: 'unreadable' }, bytes: null }
        }
    }

    // ---- Phase 21: apply ---------------------------------------------------------------------------------------------

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date()
    }

    private get exclusive(): NonNullable<RestoreDeps['exclusive']> {
        return this.deps.exclusive ?? ((work) => work())
    }

    // Applies a restore. `confirmed` must be exactly `true`; that is checked FIRST, before a single file is read, because the
    // renderer is untrusted and this is the call that changes the user's files. Everything else is checked again from scratch.
    apply(id: unknown, confirmed: unknown): Promise<RestoreApplyResult> {
        if (confirmed !== true) {
            const f = this.applyFailure(
                'not-confirmed',
                'BAD_REQUEST',
                'The restore was not confirmed, so it did not start. Nothing was read and nothing was changed.',
                APPLY_FIX.notConfirmed,
                [],
                null,
                'untouched'
            )
            this.auditAs('restore-apply', 'warn', 'not-confirmed', this.idText(id), f.message)
            return Promise.resolve(f)
        }
        return this.exclusive<RestoreApplyResult>(
            () => this.serial(() => this.runApply(id)),
            (why) => {
                const f = this.applyFailure(
                    'blocked',
                    'RUN_ACTIVE',
                    `${why} The restore did not start. Nothing was changed.`,
                    restoreFix('run-active'),
                    [{ kind: 'run-active', file: null, text: why }],
                    null,
                    'untouched'
                )
                this.auditAs('restore-apply', 'warn', 'blocked', this.idText(id), f.message)
                return f
            }
        )
    }

    private async runApply(id: unknown): Promise<RestoreApplyResult> {
        const backupId = this.idText(id)
        const refuse = (
            stage: RestoreApplyStage,
            code: ErrorCode,
            message: string,
            fix: string,
            problems: readonly RestoreProblem[],
            preview: RestorePreview | null
        ): RestoreApplyResult => {
            const f = this.applyFailure(stage, code, message, fix, problems, preview, 'untouched')
            this.auditAs('restore-apply', 'warn', `refused-${stage}`, backupId, f.message)
            return f
        }

        // 1. An earlier restore (or undo) that did not finish comes first: it must be undone, or its safety copy would be
        //    lost as the way back.
        const record = await this.readJournal()
        if (
            record.kind === 'present' &&
            (record.journal.state === 'applying' || record.journal.state === 'undoing')
        ) {
            return refuse(
                'interrupted-earlier',
                'BAD_REQUEST',
                'An earlier restore (or undo) did not finish, so a new restore did not start. Your files were not changed now.',
                APPLY_FIX.interruptedEarlier,
                [],
                null
            )
        }

        // 2. Everything is checked again from scratch: a preview that is a minute old is never trusted.
        const a = await this.assess(id)
        if (!a.ok) {
            const f = a.failure
            return refuse('rejected', f.code, f.message, f.fix, f.problems, f.preview)
        }
        const { preview, blockers, writes } = a.value
        const first = blockers[0]
        if (first !== undefined) {
            return refuse(
                'blocked',
                first.code,
                `${first.text} The restore did not start. Nothing was changed.`,
                restoreFix(first.kind),
                blockers,
                preview
            )
        }
        if (writes.length === 0) {
            const message =
                'Your current files already match this backup, so nothing was restored. No file was changed.'
            this.auditAs('restore-apply', 'info', 'nothing-to-change', preview.backup.id, message)
            return {
                ok: true,
                message,
                backupId: preview.backup.id,
                finishedAt: this.now().toISOString(),
                snapshot: { status: 'not-needed' },
                files: [],
                undoAvailable: false,
                notes: []
            }
        }

        // 3. A FRESH safety copy of the files as they are right now (the one from the "Make safety copy" step may be old).
        const copy = await this.safetyCopy()
        if (!copy.ok) {
            const f = this.applyFailure(
                'snapshot-failed',
                copy.code,
                `The safety copy of your current files could not be made (${copy.why}). The restore did not go on. No file of yours was changed.`,
                copy.fix,
                [{ kind: 'snapshot-failed', file: null, text: copy.why }],
                preview,
                'untouched'
            )
            this.auditAs('restore-apply', 'error', 'snapshot-failed', preview.backup.id, f.message)
            return f
        }

        // 4. The record is written BEFORE the first file is touched. If it cannot be written, nothing is changed.
        const startedAt = this.now()
        let journal: RestoreJournal = {
            format: JOURNAL_FORMAT,
            version: JOURNAL_VERSION,
            id: restoreIdFor(startedAt),
            state: 'applying',
            startedAt: startedAt.toISOString(),
            updatedAt: startedAt.toISOString(),
            backupId: preview.backup.id,
            appVersion: this.deps.appVersion,
            snapshot:
                copy.snapshot.status === 'created'
                    ? { status: 'created', id: copy.snapshot.id }
                    : { status: 'nothing-to-save' },
            accountsPlaceSha256: placeFingerprint(
                this.deps.targets.accountsPath(),
                this.platform,
                sha256Text
            ),
            files: writes.map((w): JournalFile => ({
                role: w.role,
                action: w.action,
                beforeSha256: w.beforeSha256,
                afterSha256: w.afterSha256
            })),
            undoSafetyCopyId: null,
            end: null
        }
        // The safety copy must hold exactly the files this restore is about to replace. If a file changed between the check
        // and the copy, the restore stops (one more press of the button is safe).
        const mismatch = planMismatch(copy.entries, writes)
        if (mismatch !== null || !parseJournal(journalToText(journal)).ok) {
            return refuse(
                'snapshot-failed',
                'WRITE_FAILED',
                `Your files changed while the restore was being prepared (${mismatch ?? 'the record did not match'}). The restore did not go on. No file of yours was changed.`,
                'Close programs that may use these files, then press Restore now again.',
                [],
                preview
            )
        }
        try {
            await this.writeJournal(journal)
        } catch (e) {
            return refuse(
                'write-failed',
                'WRITE_FAILED',
                `The record of the restore could not be written (${e instanceof StepFailure ? e.message : ioProblem(e)}), so the restore did not go on. No file of yours was changed.`,
                APPLY_FIX.snapshotFailed,
                [],
                preview
            )
        }
        if (record.kind === 'damaged') await this.setDamagedRecordAside()

        // 5. Write each file the safe way, then read it back and compare it with the backup.
        const done: RestoredFileOutcome[] = []
        try {
            for (const w of writes) {
                await this.fs.writeFileAtomic(w.path, w.bytes)
                const back = await this.fs.readFile(w.path)
                if (sha256(back) !== w.afterSha256) {
                    throw new StepFailure(
                        `${roleLabel(w.role)} was not written correctly (the file on the disk differs from the backup)`
                    )
                }
                done.push({
                    role: w.role,
                    label: roleLabel(w.role),
                    action: w.action === 'replace' ? 'replaced' : 'created',
                    bytes: back.length
                })
            }
        } catch (e) {
            const why = e instanceof StepFailure ? e.message : `a file could not be written (${ioProblem(e)})`
            return this.failApply(journal, why, preview)
        }

        // 6. Done and checked. The record says so; the app reads the restored files again.
        const finishedAt = this.now().toISOString()
        journal = { ...journal, state: 'applied', updatedAt: finishedAt, end: 'finished' }
        const notes: string[] = []
        if (!(await this.tryWriteJournal(journal))) {
            notes.push(
                'The record of this restore could not be updated at the end. Undo still works; the Backups page may call this restore "interrupted".'
            )
        }
        const after = await this.afterChange()
        if (after !== null) notes.push(after)
        if (record.kind === 'damaged') {
            notes.push('The old restore record was damaged. It was set aside and a new record was started.')
        }
        const message = `Restore finished and checked: ${String(done.length)} file(s) were written from ${preview.backup.id}, each one read back from the disk and equal to the backup. ${
            copy.snapshot.status === 'created'
                ? `Your files from before are kept in safety copy ${copy.snapshot.id}.`
                : 'No file existed before, so there was nothing to copy.'
        } Undo is on the Backups page.`
        this.auditAs(
            'restore-apply',
            'info',
            'applied',
            preview.backup.id,
            `${String(done.length)} file(s) written and read back (${done.map((d) => d.role).join(', ')}). ${
                copy.snapshot.status === 'created'
                    ? `Safety copy ${copy.snapshot.id}.`
                    : 'No safety copy needed.'
            } Contents not logged.`
        )
        return {
            ok: true,
            message,
            backupId: preview.backup.id,
            finishedAt,
            snapshot: copy.snapshot,
            files: done,
            undoAvailable: true,
            notes
        }
    }

    // A file could not be written. The files already written are put back from the safety copy, by the app itself, and the
    // user is told exactly what state the files are in.
    private async failApply(
        journal: RestoreJournal,
        why: string,
        preview: RestorePreview
    ): Promise<RestoreApplyResult> {
        const cap = `${why.charAt(0).toUpperCase()}${why.slice(1)}`
        const back = await this.putBack(journal)
        if (back.ok) {
            const ended: RestoreJournal = {
                ...journal,
                state: 'undone',
                updatedAt: this.now().toISOString(),
                end: 'rolled-back'
            }
            await this.tryWriteJournal(ended)
            await this.afterChange()
            const f = this.applyFailure(
                'write-failed',
                'WRITE_FAILED',
                `${cap}. The restore stopped. Every file that was already written was put back as it was, and the app checked that.`,
                APPLY_FIX.writeFailedRolledBack,
                [{ kind: 'snapshot-failed', file: null, text: why }],
                preview,
                'rolled-back'
            )
            this.auditAs('restore-apply', 'error', 'rolled-back', journal.backupId, `${f.message}`)
            return f
        }
        // Put-back failed too: the record stays "applying", so Undo (and the next start) find it.
        await this.afterChange()
        const f = this.applyFailure(
            'write-failed',
            'WRITE_FAILED',
            `${cap}. The restore stopped, and putting the files back by itself did not work either (${back.why}). Some of your files may be restored and some not.`,
            APPLY_FIX.writeFailedNeedsUndo,
            [{ kind: 'snapshot-failed', file: null, text: why }],
            preview,
            'needs-undo'
        )
        this.auditAs('restore-apply', 'error', 'needs-undo', journal.backupId, f.message)
        return f
    }

    // The safety copy of the current files, as a new one, read back from the disk. Used by apply and by undo.
    private async safetyCopy(): Promise<
        | {
              readonly ok: true
              readonly snapshot: PreRestoreSnapshot
              readonly entries: readonly BackupFileEntry[]
          }
        | { readonly ok: false; readonly code: ErrorCode; readonly why: string; readonly fix: string }
    > {
        const made = await this.deps.snapshots.create()
        if (made.ok) {
            const again = await this.deps.snapshots.inspect(made.backup.id)
            if (!again.ok || again.detail.verification.status !== 'ok') {
                const why = again.ok
                    ? (again.detail.verification.problems[0]?.text ?? 'the check found a problem')
                    : again.message
                return {
                    ok: false,
                    code: 'WRITE_FAILED',
                    why: `the check after writing found a problem: ${why}`,
                    fix: restoreFix('snapshot-failed')
                }
            }
            return {
                ok: true,
                snapshot: {
                    status: 'created',
                    id: made.backup.id,
                    createdAt: made.backup.createdAt,
                    fileCount: made.backup.fileCount,
                    totalBytes: made.backup.totalBytes,
                    notSaved: made.backup.skipped.map((s) => s.reason),
                    checked: true
                },
                entries: again.detail.files
            }
        }
        if (made.reason === 'nothing-to-back-up') {
            return { ok: true, snapshot: { status: 'nothing-to-save' }, entries: [] }
        }
        return { ok: false, code: made.code, why: made.message, fix: made.fix }
    }

    // ---- Phase 21: the record of the last restore ---------------------------------------------------------------------

    private async readJournal(): Promise<JournalRead> {
        let text: string
        try {
            text = (await this.fs.readFile(this.deps.journalPath)).toString('utf8')
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' }
            return {
                kind: 'damaged',
                message: `The record of the last restore could not be read (${ioProblem(e)}).`
            }
        }
        const parsed = parseJournal(text)
        return parsed.ok
            ? { kind: 'present', journal: parsed.journal }
            : { kind: 'damaged', message: parsed.message }
    }

    // Written the safe way (temporary file, flush, one rename) and read back. Holds no secret.
    private async writeJournal(journal: RestoreJournal): Promise<void> {
        await this.fs.mkdir(dirname(this.deps.journalPath))
        const text = journalToText(journal)
        await this.fs.writeFileAtomic(this.deps.journalPath, Buffer.from(text, 'utf8'))
        const back = (await this.fs.readFile(this.deps.journalPath)).toString('utf8')
        if (back !== text) throw new StepFailure('the record was not written correctly')
    }

    private async tryWriteJournal(journal: RestoreJournal): Promise<boolean> {
        try {
            await this.writeJournal(journal)
            return true
        } catch {
            return false
        }
    }

    private async setDamagedRecordAside(): Promise<void> {
        // Not needed when the new record has already replaced it; kept as a courtesy copy when the old name is still around.
        const aside = `${this.deps.journalPath}.damaged-${String(this.now().getTime())}`
        try {
            await this.fs.rename(this.deps.journalPath, aside)
        } catch {
            // the new record already took its place; nothing more to do
        }
    }

    // The record of the last restore, for the Backups page. Read-only.
    async history(): Promise<RestoreHistory> {
        const none: RestoreHistory = {
            status: 'none',
            message: 'No restore has been done yet.',
            backupId: null,
            startedAt: null,
            finishedAt: null,
            files: [],
            canUndo: false,
            undoBlockedReason: null
        }
        const record = await this.readJournal()
        if (record.kind === 'none') return none
        if (record.kind === 'damaged') {
            return {
                ...none,
                status: 'record-damaged',
                message: `The record of the last restore is damaged (${record.message.replace(/\.$/, '')}), so the app cannot offer Undo. This check changed no file. A new restore is still possible and makes its own safety copy.`
            }
        }
        return historyFromJournal(record.journal, this.undoBlock(record.journal))
    }

    // Why Undo cannot be used right now, or null.
    private undoBlock(journal: RestoreJournal): string | null {
        const run = this.deps.runBlock()
        if (run !== null) return run
        if (journal.files.some((f) => f.role === 'accounts')) {
            const now = placeFingerprint(this.deps.targets.accountsPath(), this.platform, sha256Text)
            if (now !== journal.accountsPlaceSha256) {
                return 'You chose another accounts file after the restore, so an undo would write the old accounts into that other file. Choose the old accounts file again on Home first.'
            }
        }
        return null
    }

    // ---- Phase 21: undo ----------------------------------------------------------------------------------------------

    // Puts the files back as they were before the last restore. `confirmed` must be exactly `true` (checked first).
    undo(confirmed: unknown): Promise<RestoreUndoResult> {
        if (confirmed !== true) {
            const f = this.undoFailure(
                'not-confirmed',
                'BAD_REQUEST',
                'The undo was not confirmed, so it did not start. Nothing was read and nothing was changed.',
                UNDO_FIX.notConfirmed,
                'untouched'
            )
            this.auditAs('restore-undo', 'warn', 'not-confirmed', 'undo', f.message)
            return Promise.resolve(f)
        }
        return this.exclusive<RestoreUndoResult>(
            () => this.serial(() => this.runUndo()),
            (why) => {
                const f = this.undoFailure(
                    'blocked',
                    'RUN_ACTIVE',
                    `${why} The undo did not start. Nothing was changed.`,
                    restoreFix('run-active'),
                    'untouched'
                )
                this.auditAs('restore-undo', 'warn', 'blocked', 'undo', f.message)
                return f
            }
        )
    }

    private async runUndo(): Promise<RestoreUndoResult> {
        const refuse = (
            stage: RestoreUndoStage,
            code: ErrorCode,
            message: string,
            fix: string
        ): RestoreUndoResult => {
            const f = this.undoFailure(stage, code, message, fix, 'untouched')
            this.auditAs('restore-undo', 'warn', `refused-${stage}`, 'undo', f.message)
            return f
        }

        const record = await this.readJournal()
        if (record.kind === 'none') {
            return refuse(
                'nothing-to-undo',
                'NOT_FOUND',
                'There is no restore to undo. Nothing was changed.',
                UNDO_FIX.nothingToUndo
            )
        }
        if (record.kind === 'damaged') {
            return refuse(
                'nothing-to-undo',
                'READ_FAILED',
                `The record of the last restore is damaged (${record.message.replace(/\.$/, '')}), so the app cannot tell what to put back. Nothing was changed.`,
                UNDO_FIX.safetyCopyDamaged
            )
        }
        const journal = record.journal
        if (journal.state === 'undone') {
            return refuse(
                'nothing-to-undo',
                'NOT_FOUND',
                'The last restore was already undone. Nothing was changed.',
                UNDO_FIX.nothingToUndo
            )
        }
        const blocked = this.undoBlock(journal)
        if (blocked !== null) {
            const accountsMoved = this.deps.runBlock() === null
            return refuse(
                'blocked',
                accountsMoved ? 'ACCOUNTS_INVALID' : 'RUN_ACTIVE',
                `${blocked} The undo did not start. Nothing was changed.`,
                accountsMoved ? UNDO_FIX.accountsMoved : restoreFix('run-active')
            )
        }

        // The files as they were before the restore must be readable AND exactly what the record says.
        if (journal.snapshot.status === 'created') {
            const loaded = await this.deps.snapshots.loadVerified(journal.snapshot.id)
            const good =
                loaded.kind === 'checked' && loaded.manifest !== null && loaded.verification.status === 'ok'
            if (!good) {
                return refuse(
                    'blocked',
                    'READ_FAILED',
                    'The safety copy from before the restore is missing or damaged, so the undo did not start. Nothing was changed.',
                    UNDO_FIX.safetyCopyDamaged
                )
            }
        }

        // Even an undo loses nothing: the files as they are NOW are copied first (they may hold changes made after the restore).
        const copy = await this.safetyCopy()
        if (!copy.ok) {
            return refuse(
                'safety-failed',
                copy.code,
                `The safety copy of your files as they are now could not be made (${copy.why}). The undo did not go on. Nothing was changed.`,
                UNDO_FIX.safetyFailed
            )
        }

        const undoing: RestoreJournal = {
            ...journal,
            state: 'undoing',
            updatedAt: this.now().toISOString(),
            undoSafetyCopyId: copy.snapshot.status === 'created' ? copy.snapshot.id : journal.undoSafetyCopyId
        }
        try {
            await this.writeJournal(undoing)
        } catch (e) {
            return refuse(
                'write-failed',
                'WRITE_FAILED',
                `The record of the undo could not be written (${e instanceof StepFailure ? e.message : ioProblem(e)}), so the undo did not go on. Nothing was changed.`,
                UNDO_FIX.safetyFailed
            )
        }

        const back = await this.putBack(undoing)
        if (!back.ok) {
            await this.afterChange()
            const f = this.undoFailure(
                'write-failed',
                'WRITE_FAILED',
                `The undo stopped: ${back.why}. Some of your files may be put back and some not.`,
                UNDO_FIX.writeFailed,
                'needs-undo'
            )
            this.auditAs('restore-undo', 'error', 'needs-undo', journal.backupId, f.message)
            return f
        }

        const notes: string[] = []
        const ended: RestoreJournal = {
            ...undoing,
            state: 'undone',
            updatedAt: this.now().toISOString(),
            end: 'undone'
        }
        if (!(await this.tryWriteJournal(ended))) {
            notes.push(
                'The record of the undo could not be updated at the end. The files are put back. Press Undo once more if the Backups page still offers it; that is safe.'
            )
        }
        const after = await this.afterChange()
        if (after !== null) notes.push(after)
        const safetyCopyId = copy.snapshot.status === 'created' ? copy.snapshot.id : null
        this.auditAs(
            'restore-undo',
            'info',
            'undone',
            journal.backupId,
            `${String(back.files.length)} file(s) put back or removed (${back.files.map((f) => `${f.role}:${f.action}`).join(', ')}). ${
                safetyCopyId === null ? 'No safety copy needed.' : `Safety copy ${safetyCopyId}.`
            } Contents not logged.`
        )
        return {
            ok: true,
            message: `Undo finished and checked: ${String(back.files.length)} file(s) are back as they were before the restore. ${
                safetyCopyId === null
                    ? 'No file existed just before the undo, so nothing was copied.'
                    : `Your files as they were just before the undo are kept in safety copy ${safetyCopyId}.`
            }`,
            files: back.files,
            safetyCopyId,
            notes
        }
    }

    // Puts every file of the record back as it was before the restore: a file that existed gets its old bytes from the safety
    // copy; a file that the restore CREATED is removed (the only deletion this service ever does). Safe to run again: a file
    // that is already right is not written. Works through every file even when one fails, and says which ones failed.
    private async putBack(
        journal: RestoreJournal
    ): Promise<
        | { readonly ok: true; readonly files: UndoneFileOutcome[] }
        | { readonly ok: false; readonly why: string }
    > {
        let saved: ReadonlyMap<BackupRole, Buffer> = new Map<BackupRole, Buffer>()
        if (journal.snapshot.status === 'created') {
            const loaded = await this.deps.snapshots.loadVerified(journal.snapshot.id)
            if (
                loaded.kind !== 'checked' ||
                loaded.manifest === null ||
                loaded.verification.status !== 'ok'
            ) {
                return { ok: false, why: 'the safety copy from before the restore is missing or damaged' }
            }
            saved = loaded.files
        }
        const files: UndoneFileOutcome[] = []
        const failures: string[] = []
        for (const f of journal.files) {
            const label = roleLabel(f.role)
            const path = this.targetPath(f.role)
            if (path === null) {
                failures.push(`${label}: there is no place to put it`)
                continue
            }
            try {
                if (f.beforeSha256 === null) {
                    await this.fs.removeFile(path)
                    if (await this.fs.exists(path))
                        throw new StepFailure('it is still there after removing it')
                    files.push({ role: f.role, label, action: 'removed' })
                    continue
                }
                const data = saved.get(f.role)
                if (data === undefined || sha256(data) !== f.beforeSha256) {
                    failures.push(`${label}: the safety copy does not hold the file this restore recorded`)
                    continue
                }
                const current = await this.readCurrent(path)
                const already = current.file.state === 'present' && current.file.sha256 === f.beforeSha256
                if (!already) {
                    await this.fs.writeFileAtomic(path, data)
                    const back = await this.fs.readFile(path)
                    if (sha256(back) !== f.beforeSha256) {
                        throw new StepFailure('it differs from the safety copy after writing')
                    }
                }
                files.push({ role: f.role, label, action: 'put-back' })
            } catch (e) {
                failures.push(`${label}: ${e instanceof StepFailure ? e.message : ioProblem(e)}`)
            }
        }
        return failures.length === 0 ? { ok: true, files } : { ok: false, why: failures.join('; ') }
    }

    private targetPath(role: BackupRole): string | null {
        switch (role) {
            case 'engine-config':
                return this.deps.targets.engineConfigPath
            case 'app-settings':
                return this.deps.targets.appSettingsPath
            case 'accounts':
                return this.deps.targets.accountsPath()
        }
    }

    private async afterChange(): Promise<string | null> {
        if (this.deps.afterFilesChanged === undefined) return null
        try {
            return await this.deps.afterFilesChanged()
        } catch {
            return 'The app could not read the changed files again by itself. Close the app and open it again with START.bat.'
        }
    }

    private applyFailure(
        stage: RestoreApplyStage,
        code: ErrorCode,
        message: string,
        fix: string,
        problems: readonly RestoreProblem[],
        preview: RestorePreview | null,
        filesState: FilesState
    ): RestoreApplyFailure {
        return {
            ok: false,
            stage,
            code,
            message,
            fix,
            problems: problems.map((p) => ({ kind: p.kind, file: p.file, text: p.text })),
            preview,
            filesState
        }
    }

    private undoFailure(
        stage: RestoreUndoStage,
        code: ErrorCode,
        message: string,
        fix: string,
        filesState: RestoreUndoFailure['filesState']
    ): RestoreUndoFailure {
        return { ok: false, stage, code, message, fix, filesState }
    }

    // ---- results and log ---------------------------------------------------------------------------------------------

    private reject(code: ErrorCode, message: string, problems: readonly RestoreProblem[]): Assessed {
        const kind = problems[0]?.kind ?? 'damaged'
        return {
            ok: false,
            failure: this.failure('rejected', code, message, restoreFix(kind), problems, null)
        }
    }

    private failure(
        stage: RestoreFailure['stage'],
        code: ErrorCode,
        message: string,
        fix: string,
        problems: readonly RestoreProblem[],
        preview: RestorePreview | null
    ): RestoreFailure {
        return {
            ok: false,
            stage,
            code,
            message,
            fix,
            problems: problems.map((p) => ({ kind: p.kind, file: p.file, text: p.text })),
            preview,
            userFilesUntouched: true
        }
    }

    // The id may come from the renderer: only a string that looks like an id is ever written to a log.
    private idText(id: unknown): string {
        return typeof id === 'string' && /^backup-[0-9-]{1,30}$/.test(id) ? id : 'invalid name'
    }

    private audit(level: 'info' | 'warn' | 'error', result: string, id: string, message: string): void {
        this.auditAs('restore-check', level, result, id, message)
    }

    private auditAs(
        action: 'restore-check' | 'restore-apply' | 'restore-undo',
        level: 'info' | 'warn' | 'error',
        result: string,
        id: string,
        message: string
    ): void {
        this.deps.audit.write({
            level,
            component: 'Restore',
            action,
            result,
            message: this.deps.redactor.redact(`${id}: ${message}`)
        })
    }
}
