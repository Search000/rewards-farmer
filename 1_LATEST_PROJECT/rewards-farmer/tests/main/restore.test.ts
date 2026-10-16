// @vitest-environment node
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    truncateSync,
    writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackupService, realBackupFs } from '../../src/main/backupService'
import type { BackupFs } from '../../src/main/backupService'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { RestoreService, realRestoreFs } from '../../src/main/restoreService'
import type { RestoreFs } from '../../src/main/restoreService'
import type { BackupInspectResult } from '../../src/shared/backup-types'
import type { RestoreFailure, RestorePreview } from '../../src/shared/restore-types'
import { FAKE } from '../fixtures/fake-secrets'

// Phase 20: restore check, preview and safety copy. Real files in a temp folder; every account and secret is FAKE (rule 18).
// The one rule behind every test: NO USER FILE IS EVER CHANGED in this phase. After every call the three user files must be
// byte for byte what they were. A failing disk is simulated by replacing single file operations (the service code is the same).

const FAKE_PASSWORD = 'fake-pw-Zx81-test-only'
const FAKE_TOTP = 'FAKETOTPSECRET234567'
const ACCOUNTS_2 = [
    'ACCOUNT_1_EMAIL=alpha@example.com',
    `ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}`,
    `ACCOUNT_1_TOTP_SECRET=${FAKE_TOTP}`,
    'ACCOUNT_2_EMAIL=beta@example.com',
    `ACCOUNT_2_PASSWORD=${FAKE_PASSWORD}2`,
    ''
].join('\n')
const ACCOUNTS_1 = ['ACCOUNT_1_EMAIL=gamma@example.com', `ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}3`, ''].join(
    '\n'
)
const ACCOUNTS_3 = [
    'ACCOUNT_1_EMAIL=a1@example.com',
    'ACCOUNT_1_PASSWORD=pw1',
    'ACCOUNT_2_EMAIL=a2@example.com',
    'ACCOUNT_2_PASSWORD=pw2',
    'ACCOUNT_3_EMAIL=a3@example.com',
    'ACCOUNT_3_PASSWORD=pw3',
    ''
].join('\n')
const CONFIG_A = JSON.stringify(
    { headless: true, webhook: { discord: { enabled: false, url: FAKE.discordUrl } } },
    null,
    2
)
const CONFIG_B = JSON.stringify(
    { headless: false, webhook: { discord: { enabled: false, url: FAKE.discordUrl } } },
    null,
    2
)

const FIXED = () => new Date(2026, 9, 15, 10, 0, 0, 123)
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

const dirs: string[] = []
// Log writes that may still be running when a test ends are awaited first, so the temp folder is never removed under them.
const flushers: Array<() => Promise<void>> = []
afterEach(async () => {
    while (flushers.length > 0) {
        try {
            await (flushers.pop() as () => Promise<void>)()
        } catch {
            // a log that cannot flush does not matter for cleanup
        }
    }
    while (dirs.length > 0) {
        const d = dirs.pop() as string
        try {
            chmodSync(d, 0o700)
        } catch {
            // already gone
        }
        rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
})

interface RigOptions {
    readonly backupVersion?: string
    readonly appVersion?: string
    readonly config?: string | null
    readonly accounts?: string | null
    readonly settings?: string | null
    readonly restoreFs?: Partial<RestoreFs>
    readonly snapshotFs?: Partial<BackupFs>
    readonly restorePlatform?: string
}

const settingsText = (accountsPath: string | null, schema = 2): string =>
    JSON.stringify({
        schemaVersion: schema,
        themeMode: 'dark',
        accountsPath,
        timerEnabled: false,
        timerTime: '00:00',
        shutdownAfterRun: false
    })

function rig(o: RigOptions = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'rf-restore-'))
    dirs.push(dir)
    const engineRoot = join(dir, 'engine')
    const userData = join(dir, 'userData')
    mkdirSync(engineRoot, { recursive: true })
    mkdirSync(userData, { recursive: true })
    const configPath = join(engineRoot, 'config.json')
    const accountsPath = join(dir, 'my-accounts.env')
    const settingsPath = join(userData, 'app-settings.json')
    if (o.config !== null) writeFileSync(configPath, o.config ?? CONFIG_A)
    if (o.accounts !== null) writeFileSync(accountsPath, o.accounts ?? ACCOUNTS_2)
    if (o.settings !== null) writeFileSync(settingsPath, o.settings ?? settingsText(accountsPath))

    const redactor = new Redactor()
    const redact = (t: string) => redactor.redact(t)
    const logs = join(userData, 'logs')
    const audit = new JsonlLog(logs, 'audit.log', 'audit', redact)
    const appLog = new JsonlLog(logs, 'app.log', 'app', redact)
    flushers.push(async () => {
        await audit.flush()
        await appLog.flush()
    })
    const backupRoot = join(userData, 'backups', 'full')
    const preRoot = join(userData, 'backups', 'pre-restore')
    const state = { runBlock: null as string | null, accountsPlace: accountsPath as string | null }
    const sources = {
        engineConfigPath: configPath,
        appSettingsPath: settingsPath,
        accountsPath: () => state.accountsPlace
    }
    const common = {
        sources,
        redactor,
        audit,
        appLog,
        platform: 'testos',
        now: FIXED,
        restrict: () => Promise.resolve({ ok: true, detail: 'test' })
    }
    const backups = new BackupService({
        ...common,
        backupRoot,
        appVersion: o.backupVersion ?? '0.0.1'
    })
    const snapshots = new BackupService({
        ...common,
        backupRoot: preRoot,
        appVersion: '0.0.1',
        ...(o.snapshotFs === undefined ? {} : { fs: o.snapshotFs })
    })
    const spy = {
        stat: vi.fn(realRestoreFs.stat),
        readFile: vi.fn(realRestoreFs.readFile),
        exists: vi.fn(realRestoreFs.exists)
    }
    const restore = new RestoreService({
        backups,
        snapshots,
        targets: sources,
        journalPath: join(userData, 'backups', 'restore-journal.json'),
        appVersion: o.appVersion ?? '0.0.1',
        settingsSchema: 2,
        runBlock: () => state.runBlock,
        redactor,
        audit,
        appLog,
        platform: o.restorePlatform ?? 'testos',
        fs: { ...spy, ...(o.restoreFs ?? {}) }
    })
    const logText = async (): Promise<string> => {
        await audit.flush()
        await appLog.flush()
        return ['audit.log', 'app.log']
            .map((n) => (existsSync(join(logs, n)) ? readFileSync(join(logs, n), 'utf8') : ''))
            .join('\n')
    }
    const userFiles = (): Record<string, string | null> => ({
        config: existsSync(configPath) ? sha(readFileSync(configPath)) : null,
        accounts: existsSync(accountsPath) ? sha(readFileSync(accountsPath)) : null,
        settings: existsSync(settingsPath) ? sha(readFileSync(settingsPath)) : null
    })
    return {
        dir,
        engineRoot,
        configPath,
        accountsPath,
        settingsPath,
        backupRoot,
        preRoot,
        state,
        backups,
        snapshots,
        restore,
        spy,
        logText,
        userFiles
    }
}

type Rig = ReturnType<typeof rig>

// Makes one real backup of the current files and returns its id.
async function backupNow(r: Rig): Promise<string> {
    const res = await r.backups.create()
    if (!res.ok) throw new Error(`test setup: backup failed: ${res.message}`)
    return res.backup.id
}

const preRestoreFolders = (r: Rig): string[] => (existsSync(r.preRoot) ? readdirSync(r.preRoot) : [])

function readManifest(r: Rig, id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(r.backupRoot, id, 'manifest.json'), 'utf8')) as Record<
        string,
        unknown
    >
}
function writeManifest(r: Rig, id: string, m: Record<string, unknown>): void {
    writeFileSync(join(r.backupRoot, id, 'manifest.json'), JSON.stringify(m, null, 4))
}

async function rejected(r: Rig, id: unknown): Promise<RestoreFailure> {
    const res = await r.restore.preview(id)
    if (res.ok) throw new Error('expected the preview to be refused')
    return res
}
async function previewOk(r: Rig, id: string): Promise<RestorePreview> {
    const res = await r.restore.preview(id)
    if (!res.ok) throw new Error(`expected a preview: ${res.message}`)
    return res.preview
}
const plan = (p: RestorePreview, role: string) => {
    const f = p.files.find((x) => x.role === role)
    if (f === undefined) throw new Error(`no plan for ${role}`)
    return f
}

// ---------------------------------------------------------------------------------------------------------------------

describe('preview of a good backup', () => {
    it('lists the three files in a fixed order and says what would change', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        writeFileSync(r.accountsPath, ACCOUNTS_1)
        const p = await previewOk(r, id)
        expect(p.files.map((f) => f.role)).toEqual(['engine-config', 'accounts', 'app-settings'])
        expect(plan(p, 'engine-config').action).toBe('replace')
        expect(plan(p, 'accounts').action).toBe('replace')
        expect(plan(p, 'app-settings').action).toBe('unchanged')
        expect(p.changeCount).toBe(2)
        expect(p.blockers).toEqual([])
        expect(p.canContinue).toBe(true)
        expect(p.backup.id).toBe(id)
        expect(p.backup.appVersion).toBe('0.0.1')
    })

    it('a file that is already the same is "unchanged"; nothing to change means it cannot continue', async () => {
        const r = rig()
        const id = await backupNow(r)
        const p = await previewOk(r, id)
        expect(p.files.every((f) => f.action === 'unchanged')).toBe(true)
        expect(p.changeCount).toBe(0)
        expect(p.canContinue).toBe(false)
    })

    it('a file that does not exist now would be created', async () => {
        const r = rig()
        const id = await backupNow(r)
        rmSync(r.configPath)
        const p = await previewOk(r, id)
        expect(plan(p, 'engine-config').action).toBe('create')
        expect(plan(p, 'engine-config').currentBytes).toBeNull()
        expect(p.changeCount).toBe(1)
    })

    it('a file that is not in the backup stays as it is (a restore never deletes)', async () => {
        const r = rig({ settings: null })
        const id = await backupNow(r)
        writeFileSync(r.settingsPath, settingsText(r.accountsPath))
        const p = await previewOk(r, id)
        const s = plan(p, 'app-settings')
        expect(s.action).toBe('keep')
        expect(s.backupBytes).toBeNull()
        expect(s.text).toMatch(/stays exactly as it is/)
        expect(p.changeCount).toBe(0)
    })

    it('shows how many accounts there are now and in the backup (counts only)', async () => {
        const r = rig({ accounts: ACCOUNTS_2 })
        const id = await backupNow(r)
        writeFileSync(r.accountsPath, ACCOUNTS_1)
        const a = plan(await previewOk(r, id), 'accounts')
        expect(a.backupAccountCount).toBe(2)
        expect(a.currentAccountCount).toBe(1)
        expect(plan(await previewOk(r, id), 'engine-config').backupAccountCount).toBeNull()
    })

    it('warns when the restore would leave fewer accounts than the file has now', async () => {
        const r = rig({ accounts: ACCOUNTS_2 })
        const id = await backupNow(r)
        writeFileSync(r.accountsPath, ACCOUNTS_3)
        const p = await previewOk(r, id)
        expect(p.warnings.join(' ')).toMatch(/3 account\(s\), the backup has 2/)
        expect(p.warnings.join(' ')).toMatch(/safety copy/)
    })

    it('warns when the accounts file in the backup has no account in it', async () => {
        const r = rig({ accounts: '# no account yet\n' })
        const id = await backupNow(r)
        writeFileSync(r.accountsPath, ACCOUNTS_2)
        const p = await previewOk(r, id)
        expect(p.warnings.join(' ')).toMatch(/no account in it/)
        expect(plan(p, 'accounts').backupAccountCount).toBe(0)
    })

    it('the app settings keep the accounts file you chose now: the plan says so and compares what would really be written', async () => {
        const r = rig({ settings: settingsText('C:\\old place\\accounts.env') })
        const id = await backupNow(r)
        const p = await previewOk(r, id)
        expect(p.warnings.join(' ')).toMatch(/keeps the accounts file you have chosen now/)
        // The current file is exactly what the restore would write (backup settings, current accounts place): nothing to do.
        const effective = `${JSON.stringify({ ...(JSON.parse(settingsText('x')) as object), accountsPath: r.accountsPath }, null, 4)}\n`
        writeFileSync(r.settingsPath, effective)
        expect(plan(await previewOk(r, id), 'app-settings').action).toBe('unchanged')
        // A different current file is replaced.
        writeFileSync(r.settingsPath, settingsText(r.accountsPath, 2).replace('dark', 'light'))
        expect(plan(await previewOk(r, id), 'app-settings').action).toBe('replace')
    })

    it('the same accounts file place gives no warning (Windows paths ignore upper/lower case)', async () => {
        const r = rig()
        const id = await backupNow(r)
        expect((await previewOk(r, id)).warnings).toEqual([])
        const w = rig({ settings: settingsText('C:\\Users\\X\\Accounts.env'), restorePlatform: 'testos' })
        const wid = await backupNow(w)
        w.state.accountsPlace = 'C:\\Users\\X\\Accounts.env'
        expect((await previewOk(w, wid)).warnings).toEqual([])
    })

    it('says so when the backup was made on another system', async () => {
        const r = rig({ restorePlatform: 'otheros' })
        const id = await backupNow(r)
        const p = await previewOk(r, id)
        expect(p.warnings.join(' ')).toMatch(/another system \(testos\)/)
    })

    it('an older app version is accepted', async () => {
        const r = rig({ backupVersion: '0.0.0', appVersion: '0.2.0' })
        const id = await backupNow(r)
        expect((await r.restore.preview(id)).ok).toBe(true)
    })

    it('a preview writes nothing: no safety copy, no new folder, no changed user file', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        const before = r.userFiles()
        const backupFolders = readdirSync(r.backupRoot)
        await r.restore.preview(id)
        await r.restore.preview(id)
        expect(r.userFiles()).toEqual(before)
        expect(existsSync(r.preRoot)).toBe(false)
        expect(readdirSync(r.backupRoot)).toEqual(backupFolders)
    })

    it('the answer holds no secret, no e-mail address and no folder path', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        const text = JSON.stringify(await r.restore.preview(id))
        for (const s of [
            FAKE_PASSWORD,
            FAKE_TOTP,
            'alpha@example.com',
            'beta@example.com',
            FAKE.discordUrl,
            r.dir,
            tmpdir()
        ]) {
            expect(text).not.toContain(s)
        }
    })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('a bad backup is refused before anything is touched', () => {
    // Every case: refused, the user files are unchanged, no safety copy, and the CURRENT files were never even read.
    async function refusedClean(
        r: Rig,
        id: unknown,
        before: Record<string, string | null>
    ): Promise<RestoreFailure> {
        const f = await rejected(r, id)
        expect(f.stage).toBe('rejected')
        expect(f.userFilesUntouched).toBe(true)
        expect(f.fix.length).toBeGreaterThan(20)
        expect(f.problems.length).toBeGreaterThan(0)
        expect(f.preview).toBeNull()
        expect(r.userFiles()).toEqual(before)
        expect(existsSync(r.preRoot)).toBe(false)
        expect(r.spy.readFile).not.toHaveBeenCalled()
        expect(r.spy.stat).not.toHaveBeenCalled()
        // prepare refuses it the same way and still makes no safety copy
        const p = await r.restore.prepare(id)
        expect(p.ok).toBe(false)
        if (!p.ok) expect(p.stage).toBe('rejected')
        expect(existsSync(r.preRoot)).toBe(false)
        expect(r.userFiles()).toEqual(before)
        return f
    }

    it('one changed byte in the accounts file (corrupted)', async () => {
        const r = rig()
        const id = await backupNow(r)
        const file = join(r.backupRoot, id, 'accounts.env')
        const b = readFileSync(file)
        b[3] = b[3] === 65 ? 66 : 65
        writeFileSync(file, b)
        const before = r.userFiles()
        const f = await refusedClean(r, id, before)
        expect(f.problems[0]?.kind).toBe('damaged')
        expect(f.problems[0]?.file).toBe('accounts.env')
        expect(f.message).toMatch(/damaged/)
    })

    it('a cut-off file', async () => {
        const r = rig()
        const id = await backupNow(r)
        truncateSync(join(r.backupRoot, id, 'engine-config.json'), 5)
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems.some((p) => p.kind === 'damaged' && p.file === 'engine-config.json')).toBe(true)
    })

    it('a file that is missing from the backup', async () => {
        const r = rig()
        const id = await backupNow(r)
        rmSync(join(r.backupRoot, id, 'app-settings.json'))
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('file-missing')
        expect(f.problems[0]?.text).toMatch(/missing from the backup/)
    })

    it('a missing manifest (not a finished backup)', async () => {
        const r = rig()
        const id = await backupNow(r)
        rmSync(join(r.backupRoot, id, 'manifest.json'))
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('incomplete')
        expect(f.message).toMatch(/not a finished backup/)
    })

    it('a manifest that is not JSON', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(join(r.backupRoot, id, 'manifest.json'), '{ not json')
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('manifest')
    })

    it('a manifest edited by hand (a checksum no longer matches the file)', async () => {
        const r = rig()
        const id = await backupNow(r)
        const m = readManifest(r, id)
        const files = m['files'] as { sha256: string }[]
        files[0] = { ...(files[0] as { sha256: string }), sha256: '0'.repeat(64) }
        writeManifest(r, id, m)
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('damaged')
        expect(f.problems[0]?.text).toMatch(/checksum does not match/)
    })

    it('a manifest that belongs to another backup', async () => {
        const r = rig()
        const id = await backupNow(r)
        const m = readManifest(r, id)
        writeManifest(r, id, { ...m, id: 'backup-20200101-000000-000' })
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('manifest')
    })

    it('a file replaced by a folder', async () => {
        const r = rig()
        const id = await backupNow(r)
        rmSync(join(r.backupRoot, id, 'accounts.env'))
        mkdirSync(join(r.backupRoot, id, 'accounts.env'))
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('damaged')
    })

    it('a backup that does not exist (any more)', async () => {
        const r = rig()
        const before = r.userFiles()
        const f = await refusedClean(r, 'backup-20200101-000000-000', before)
        expect(f.code).toBe('NOT_FOUND')
        expect(f.problems[0]?.kind).toBe('not-found')
    })

    it('hostile names are refused with no disk access at all', async () => {
        const r = rig()
        await backupNow(r)
        const before = r.userFiles()
        const bad: unknown[] = [
            '..',
            '../backups',
            '..\\..\\secret',
            'C:\\Windows',
            '/etc/passwd',
            '.tmp-backup-20261015-100000-123-abcdef',
            'backup-20261015-100000-123/../..',
            'backup-20261015-100000-123\u0000',
            '',
            null,
            undefined,
            42,
            { id: 'x' }
        ]
        for (const name of bad) {
            const res = await r.restore.preview(name)
            expect(res.ok).toBe(false)
            if (!res.ok) {
                expect(res.code).toBe('BAD_REQUEST')
                expect(res.problems[0]?.kind).toBe('bad-name')
            }
            const prep = await r.restore.prepare(name)
            expect(prep.ok).toBe(false)
        }
        expect(r.userFiles()).toEqual(before)
        expect(r.spy.readFile).not.toHaveBeenCalled()
        expect(existsSync(r.preRoot)).toBe(false)
    })

    // ---- wrong version -------------------------------------------------------------------------------------------

    it('wrong version: a manifest of another format version', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeManifest(r, id, { ...readManifest(r, id), manifestVersion: 2 })
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('wrong-version')
        expect(f.problems[0]?.text).toMatch(/manifest version is not supported/)
        expect(f.fix).toMatch(/different \(newer\) version/)
    })

    it('wrong version: a backup made by a NEWER app', async () => {
        const r = rig({ backupVersion: '0.9.0', appVersion: '0.0.1' })
        const id = await backupNow(r)
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('app-too-new')
        expect(f.problems[0]?.text).toMatch(/newer version of the app \(0\.9\.0\)/)
        expect(f.problems[0]?.text).toMatch(/version 0\.0\.1/)
    })

    it('wrong version: a newer major version is refused too', async () => {
        const r = rig({ backupVersion: '1.0.0', appVersion: '0.9.9' })
        const id = await backupNow(r)
        await refusedClean(r, id, r.userFiles())
    })

    it('wrong version: an app version that cannot be read is never "fine"', async () => {
        const r = rig({ backupVersion: 'banana' })
        const id = await backupNow(r)
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('version-unknown')
    })

    it('wrong version: app settings from a newer settings schema (checksum is fine, content is too new)', async () => {
        const r = rig({ settings: settingsText(null, 3) })
        const id = await backupNow(r)
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('app-too-new')
        expect(f.problems[0]?.file).toBe('app-settings.json')
        expect(f.problems[0]?.text).toMatch(/settings version 3; this app knows up to 2/)
    })

    // ---- a file that is intact but not usable ---------------------------------------------------------------------

    it('engine settings that are not JSON (they were already broken when the backup was made)', async () => {
        const r = rig({ config: '{ broken' })
        const id = await backupNow(r)
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('content-invalid')
        expect(f.problems[0]?.file).toBe('engine-config.json')
    })

    it('engine settings with a value of the wrong kind', async () => {
        const r = rig({ config: JSON.stringify({ headless: 'yes' }) })
        const id = await backupNow(r)
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('content-invalid')
        expect(f.problems[0]?.text).toMatch(/headless must be true or false/)
    })

    it('app settings that are not JSON, not an object, or without a version number', async () => {
        for (const settings of [
            'nope',
            '[1,2]',
            JSON.stringify({ themeMode: 'dark' }),
            JSON.stringify({ schemaVersion: 'two' })
        ]) {
            const r = rig({ settings })
            const id = await backupNow(r)
            const f = await refusedClean(r, id, r.userFiles())
            expect(f.problems[0]?.kind).toBe('content-invalid')
        }
    })

    it('an accounts file that is not text', async () => {
        const r = rig({ accounts: 'ACCOUNT_1_EMAIL=a@example.com\u0000\u0001binary' })
        const id = await backupNow(r)
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems[0]?.kind).toBe('content-invalid')
        expect(f.problems[0]?.file).toBe('accounts.env')
    })

    it('all problems are listed, not only the first', async () => {
        const r = rig({ config: '{ broken', settings: settingsText(null, 9), backupVersion: '3.0.0' })
        const id = await backupNow(r)
        const f = await refusedClean(r, id, r.userFiles())
        expect(f.problems.map((p) => p.kind).sort()).toEqual([
            'app-too-new',
            'app-too-new',
            'content-invalid'
        ])
    })

    it('the answer of a refusal holds no secret, e-mail address or folder path', async () => {
        const r = rig({
            config: JSON.stringify({ headless: 'yes', webhook: { discord: { url: FAKE.discordUrl } } })
        })
        const id = await backupNow(r)
        const text = JSON.stringify(await r.restore.preview(id))
        for (const s of [FAKE_PASSWORD, FAKE_TOTP, 'alpha@example.com', FAKE.discordUrl, r.dir]) {
            expect(text).not.toContain(s)
        }
    })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('a good backup that cannot be restored right now (blocked)', () => {
    it('a run is active: the plan is shown, the restore is blocked, no safety copy is made', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        r.state.runBlock = 'A run is active. Stop it first: files cannot be restored during a run.'
        const p = await previewOk(r, id)
        expect(p.canContinue).toBe(false)
        expect(p.blockers[0]).toMatch(/run is active/)
        expect(p.changeCount).toBe(1)
        const before = r.userFiles()
        const prep = await r.restore.prepare(id)
        expect(prep.ok).toBe(false)
        if (prep.ok) return
        expect(prep.stage).toBe('blocked')
        expect(prep.code).toBe('RUN_ACTIVE')
        expect(prep.problems[0]?.kind).toBe('run-active')
        expect(prep.fix).toMatch(/press Stop/)
        expect(prep.preview?.changeCount).toBe(1)
        expect(existsSync(r.preRoot)).toBe(false)
        expect(r.userFiles()).toEqual(before)
    })

    it('a run that starts between the preview and the safety copy still blocks it (nothing is trusted from the preview)', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        expect((await r.restore.preview(id)).ok).toBe(true)
        r.state.runBlock = 'The app is busy (engine starting or stopping). Try again in a moment.'
        const prep = await r.restore.prepare(id)
        expect(prep.ok).toBe(false)
        expect(existsSync(r.preRoot)).toBe(false)
    })

    it('no accounts file is chosen: the accounts have no place to go', async () => {
        const r = rig()
        const id = await backupNow(r)
        r.state.accountsPlace = null
        const p = await previewOk(r, id)
        const a = plan(p, 'accounts')
        expect(a.action).toBe('cannot-restore')
        expect(a.text).toMatch(/No accounts file is chosen yet/)
        expect(p.canContinue).toBe(false)
        const prep = await r.restore.prepare(id)
        expect(prep.ok).toBe(false)
        if (!prep.ok) {
            expect(prep.stage).toBe('blocked')
            expect(prep.code).toBe('ACCOUNTS_NOT_SET')
            expect(prep.fix).toMatch(/Accounts Path/)
        }
        expect(existsSync(r.preRoot)).toBe(false)
    })

    it('the folder of a file is missing (for example the engine folder)', async () => {
        const r = rig()
        const id = await backupNow(r)
        rmSync(r.engineRoot, { recursive: true })
        const p = await previewOk(r, id)
        expect(plan(p, 'engine-config').action).toBe('cannot-restore')
        expect(plan(p, 'engine-config').text).toMatch(/folder for this file was not found/)
        const prep = await r.restore.prepare(id)
        expect(prep.ok).toBe(false)
        if (!prep.ok) expect(prep.code).toBe('WRITE_FAILED')
        expect(existsSync(r.preRoot)).toBe(false)
    })

    it('the current accounts file cannot be read (permission): a safety copy of it would be impossible, so it waits', async () => {
        const r = rig({
            restoreFs: {
                async readFile(path: string) {
                    if (path.endsWith('my-accounts.env')) throw errno('EACCES')
                    return realRestoreFs.readFile(path)
                }
            }
        })
        const id = await backupNow(r)
        const p = await previewOk(r, id)
        expect(plan(p, 'accounts').action).toBe('cannot-restore')
        expect(plan(p, 'accounts').text).toMatch(/could not be read/)
        const prep = await r.restore.prepare(id)
        expect(prep.ok).toBe(false)
        expect(existsSync(r.preRoot)).toBe(false)
    })

    it('the current accounts file is a folder', async () => {
        const r = rig()
        const id = await backupNow(r)
        rmSync(r.accountsPath)
        mkdirSync(r.accountsPath)
        const p = await previewOk(r, id)
        expect(plan(p, 'accounts').action).toBe('cannot-restore')
        expect(p.canContinue).toBe(false)
    })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('the safety copy (prepare)', () => {
    it('is made and checked BEFORE anything could change, holds the current files, and no user file is touched', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        writeFileSync(r.accountsPath, ACCOUNTS_1)
        const before = r.userFiles()
        const res = await r.restore.prepare(id)
        expect(res.ok).toBe(true)
        if (!res.ok) return
        expect(res.userFilesUntouched).toBe(true)
        expect(res.snapshot.status).toBe('created')
        if (res.snapshot.status !== 'created') return
        const snap = res.snapshot
        expect(snap.checked).toBe(true)
        expect(snap.fileCount).toBe(3)
        expect(res.message).toMatch(/Safety copy .* made and checked/)
        expect(res.message).toMatch(/Nothing has been restored or changed yet/)
        // it exists on the disk, apart from the normal backups, and holds the CURRENT files (not the backup's)
        const dir = join(r.preRoot, snap.id)
        expect(existsSync(dir)).toBe(true)
        expect(readFileSync(join(dir, 'engine-config.json'), 'utf8')).toBe(CONFIG_B)
        expect(readFileSync(join(dir, 'accounts.env'), 'utf8')).toBe(ACCOUNTS_1)
        expect(r.userFiles()).toEqual(before)
        // a real check of the copy from the disk
        const inspected: BackupInspectResult = await r.snapshots.inspect(snap.id)
        expect(inspected.ok).toBe(true)
        if (inspected.ok) expect(inspected.detail.verification.status).toBe('ok')
        // the list of normal backups did not get a new entry
        const list = await r.backups.list()
        expect(list.backups.map((b) => b.id)).toEqual([id])
        expect(readdirSync(r.backupRoot)).toEqual([id])
    })

    it('a file that does not exist now is named as not saved (an undo has to remove what a restore creates)', async () => {
        const r = rig()
        const id = await backupNow(r)
        rmSync(r.accountsPath)
        const res = await r.restore.prepare(id)
        expect(res.ok).toBe(true)
        if (!res.ok || res.snapshot.status !== 'created') throw new Error('expected a safety copy')
        expect(res.snapshot.fileCount).toBe(2)
        expect(res.snapshot.notSaved.join(' ')).toMatch(/Accounts file does not exist yet/)
        expect(plan(res.preview, 'accounts').action).toBe('create')
    })

    it('nothing exists now: there is nothing to lose, so no copy is made, and it says so', async () => {
        const r = rig()
        const id = await backupNow(r)
        rmSync(r.configPath)
        rmSync(r.accountsPath)
        rmSync(r.settingsPath)
        const res = await r.restore.prepare(id)
        expect(res.ok).toBe(true)
        if (!res.ok) return
        expect(res.snapshot.status).toBe('nothing-to-save')
        expect(res.preview.files.every((f) => f.action === 'create')).toBe(true)
        expect(res.message).toMatch(/nothing to copy/)
        expect(existsSync(r.preRoot)).toBe(false)
    })

    it('nothing would change: no copy is made and it says so', async () => {
        const r = rig()
        const id = await backupNow(r)
        const res = await r.restore.prepare(id)
        expect(res.ok).toBe(true)
        if (!res.ok) return
        expect(res.snapshot.status).toBe('not-needed')
        expect(res.message).toMatch(/would change nothing/)
        expect(existsSync(r.preRoot)).toBe(false)
    })

    it('check again before copying: a backup damaged after the preview is refused', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        expect((await r.restore.preview(id)).ok).toBe(true)
        writeFileSync(join(r.backupRoot, id, 'accounts.env'), 'changed after the preview')
        const res = await r.restore.prepare(id)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.stage).toBe('rejected')
        expect(existsSync(r.preRoot)).toBe(false)
    })

    it('a refused backup never leads to a safety copy (no pre-restore folder appears)', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        writeFileSync(join(r.backupRoot, id, 'accounts.env'), 'damaged')
        const res = await r.restore.prepare(id)
        expect(res.ok).toBe(false)
        expect(preRestoreFolders(r)).toEqual([])
        expect(readFileSync(r.configPath, 'utf8')).toBe(CONFIG_B)
    })

    it('the disk is full while the safety copy is written: the restore does not go on, nothing is changed, no copy looks valid', async () => {
        const r = rig({
            snapshotFs: {
                async writeFileSynced(path: string, data: Buffer) {
                    if (path.endsWith('accounts.env')) throw errno('ENOSPC')
                    return realBackupFs.writeFileSynced(path, data)
                }
            }
        })
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        const before = r.userFiles()
        const res = await r.restore.prepare(id)
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.stage).toBe('snapshot-failed')
        expect(res.code).toBe('WRITE_FAILED')
        expect(res.message).toMatch(/restore did not go on/)
        expect(res.message).toMatch(/No file of yours was changed/)
        expect(res.fix).toMatch(/Free some space/)
        expect(res.problems[0]?.kind).toBe('snapshot-failed')
        expect(res.preview?.changeCount).toBe(1)
        expect(r.userFiles()).toEqual(before)
        expect((await r.snapshots.list()).backups).toEqual([])
    })

    it('there is not enough free space: refused before a byte is written', async () => {
        const r = rig({ snapshotFs: { freeBytes: () => Promise.resolve(100) } })
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        const before = r.userFiles()
        const res = await r.restore.prepare(id)
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.stage).toBe('snapshot-failed')
        expect(res.message).toMatch(/not enough free disk space/)
        expect(res.fix).toMatch(/full or nearly full/)
        expect(r.userFiles()).toEqual(before)
        expect(existsSync(r.preRoot)).toBe(false)
    })

    it('permission denied for the safety copy folder', async () => {
        const r = rig({
            snapshotFs: {
                async mkdir(path: string, mode: number) {
                    if (path.includes('pre-restore')) throw errno('EACCES')
                    return realBackupFs.mkdir(path, mode)
                }
            }
        })
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        const before = r.userFiles()
        const res = await r.restore.prepare(id)
        expect(res.ok).toBe(false)
        if (!res.ok) {
            expect(res.stage).toBe('snapshot-failed')
            expect(res.fix).toMatch(/Windows did not let the app use a file or folder/)
        }
        expect(r.userFiles()).toEqual(before)
    })

    it('a safety copy that fails its check afterwards is not accepted', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        const bad = {
            create: () => r.snapshots.create(),
            loadVerified: (sid: unknown) => r.snapshots.loadVerified(sid),
            inspect: (sid: string): Promise<BackupInspectResult> =>
                r.snapshots.inspect(sid).then((x) =>
                    x.ok
                        ? {
                              ok: true,
                              detail: {
                                  ...x.detail,
                                  verification: {
                                      ...x.detail.verification,
                                      status: 'failed',
                                      problems: [
                                          {
                                              kind: 'checksum-differs',
                                              file: 'accounts.env',
                                              text: 'Accounts file was changed.'
                                          }
                                      ]
                                  }
                              }
                          }
                        : x
                )
        }
        const auditB = new JsonlLog(join(r.dir, 'l1'), 'a.log', 'audit', (t) => t)
        const appLogB = new JsonlLog(join(r.dir, 'l2'), 'b.log', 'app', (t) => t)
        const service = new RestoreService({
            backups: r.backups,
            snapshots: bad,
            targets: {
                engineConfigPath: r.configPath,
                appSettingsPath: r.settingsPath,
                accountsPath: () => r.accountsPath
            },
            journalPath: join(r.dir, 'userData', 'backups', 'restore-journal.json'),
            appVersion: '0.0.1',
            settingsSchema: 2,
            runBlock: () => null,
            redactor: new Redactor(),
            audit: auditB,
            appLog: appLogB,
            platform: 'testos'
        })
        const res = await service.prepare(id)
        await auditB.flush()
        await appLogB.flush()
        expect(res.ok).toBe(false)
        if (!res.ok) {
            expect(res.stage).toBe('snapshot-failed')
            expect(res.message).toMatch(/check afterwards found a problem/)
        }
    })

    it('two requests at the same time are handled one after the other (two good copies)', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        const [a, b] = await Promise.all([r.restore.prepare(id), r.restore.prepare(id)])
        expect(a.ok && b.ok).toBe(true)
        if (a.ok && b.ok && a.snapshot.status === 'created' && b.snapshot.status === 'created') {
            expect(a.snapshot.id).not.toBe(b.snapshot.id)
        }
        expect((await r.snapshots.list()).backups).toHaveLength(2)
    })

    it('a failed attempt can simply be tried again', async () => {
        let fail = true
        const r = rig({
            snapshotFs: {
                async writeFileSynced(path: string, data: Buffer) {
                    if (fail) throw errno('ENOSPC')
                    return realBackupFs.writeFileSynced(path, data)
                }
            }
        })
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        expect((await r.restore.prepare(id)).ok).toBe(false)
        fail = false
        const again = await r.restore.prepare(id)
        expect(again.ok).toBe(true)
    })

    it('the answer holds no secret, e-mail address or folder path', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        const text = JSON.stringify(await r.restore.prepare(id))
        for (const s of [
            FAKE_PASSWORD,
            FAKE_TOTP,
            'alpha@example.com',
            'beta@example.com',
            FAKE.discordUrl,
            r.dir,
            tmpdir()
        ]) {
            expect(text).not.toContain(s)
        }
    })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('log and source guard', () => {
    it('the audit log names the backup and counts, never a secret, an e-mail address or a folder path', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.configPath, CONFIG_B)
        await r.restore.preview(id)
        await r.restore.prepare(id)
        rmSync(join(r.backupRoot, id, 'accounts.env'))
        await r.restore.preview(id)
        await r.restore.prepare('../hostile')
        const log = await r.logText()
        expect(log).toContain('"component":"Restore"')
        expect(log).toContain(id)
        for (const s of [
            FAKE_PASSWORD,
            FAKE_TOTP,
            'alpha@example.com',
            'beta@example.com',
            FAKE.discordUrl,
            r.dir,
            '../hostile'
        ]) {
            expect(log).not.toContain(s)
        }
        expect(log).toContain('invalid name')
    })

    it('Phase 20 part is still read-only: preview, prepare and the check never call a writing file operation', () => {
        const src = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'restoreService.ts'), 'utf8')
        const code = src
            .split('\n')
            .filter((l) => !l.trim().startsWith('//'))
            .join('\n')
        const from = code.indexOf('// ---- preview: read-only')
        const to = code.indexOf('// ---- Phase 21: apply')
        // comments were removed above, so find the first method of each part by its signature instead
        const readOnlyStart = code.indexOf('async preview(')
        const phase21Start = code.indexOf('private now(): Date')
        expect(from === -1 && to === -1).toBe(true) // (marker comments are gone: the signatures are the anchors)
        expect(readOnlyStart).toBeGreaterThan(0)
        expect(phase21Start).toBeGreaterThan(readOnlyStart)
        const readOnlyPart = code.slice(readOnlyStart, phase21Start)
        // The read-only part (preview, prepare, runPrepare, assess, contentChecks, placeOf, readCurrent) has no write call at all,
        // neither a direct one nor one through the injectable file operations. The safety copy goes through BackupService.
        expect(readOnlyPart).not.toMatch(
            /\b(writeFile|appendFile|copyFile|rename|rm|rmdir|unlink|mkdir|truncate|createWriteStream|chmod)\b\s*\(/
        )
        expect(readOnlyPart).not.toMatch(/\bthis\.fs\.(writeFileAtomic|removeFile|rename|mkdir)\b/)
    })

    it('Phase 21: outside the file-operations declaration and object, only the apply / undo / record part writes, and only through this.fs', () => {
        const src = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'restoreService.ts'), 'utf8')
        const code = src
            .split('\n')
            .filter((l) => !l.trim().startsWith('//'))
            .join('\n')
        const fsObjectStart = code.indexOf('export interface RestoreFs')
        const fsObjectEnd = code.indexOf('export interface RestoreDeps')
        expect(fsObjectStart).toBeGreaterThan(0)
        expect(fsObjectEnd).toBeGreaterThan(fsObjectStart)
        const rest = code.slice(0, fsObjectStart) + code.slice(fsObjectEnd)
        // No direct call of a node file function anywhere else: every write goes through the injectable RestoreFs.
        expect(rest).not.toMatch(
            /(?<![.\w])(writeFile|appendFile|copyFile|rename|rm|rmdir|unlink|mkdir|truncate|createWriteStream|chmod)\s*\(/
        )
        // The calls that change files exist only after the read-only part.
        const firstWrite = rest.search(/\bthis\.fs\.(writeFileAtomic|removeFile|rename|mkdir)\b/)
        expect(firstWrite).toBeGreaterThan(rest.indexOf('private now(): Date'))
    })
})
