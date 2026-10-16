// @vitest-environment node
import { createHash } from 'node:crypto'
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupService, ioProblem } from '../../src/main/backupService'
import type { BackupFs } from '../../src/main/backupService'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { parseManifest } from '../../src/shared/backup-rules'
import { FAKE } from '../fixtures/fake-secrets'

// Backup service against REAL files in a temp dir. All accounts and secrets here are FAKE test values (rule 18).
// Failing disks are simulated by replacing single file operations (the same service code runs, only the disk "fails").

const isRoot = process.getuid?.() === 0
const isWindows = process.platform === 'win32'

const FAKE_PASSWORD = 'fake-pw-Zx81-test-only'
const FAKE_TOTP = 'FAKETOTPSECRET234567'
const ACCOUNTS_ENV = [
    'ACCOUNT_1_EMAIL=alpha@example.com',
    `ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}`,
    `ACCOUNT_1_TOTP_SECRET=${FAKE_TOTP}`,
    'ACCOUNT_2_EMAIL=beta@example.com',
    `ACCOUNT_2_PASSWORD=${FAKE_PASSWORD}2`,
    ''
].join('\n')
const CONFIG = JSON.stringify(
    {
        baseURL: 'https://rewards.bing.com',
        webhook: {
            discord: { enabled: false, url: FAKE.discordUrl },
            telegram: { enabled: false, botToken: FAKE.telegramBotToken, chatId: FAKE.telegramChatId }
        }
    },
    null,
    2
)
const APP_SETTINGS = JSON.stringify({
    schemaVersion: 2,
    themeMode: 'dark',
    accountsPath: null,
    timerEnabled: false
})

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

interface Rig {
    readonly dir: string
    readonly root: string
    readonly configPath: string
    readonly accountsPath: string
    readonly settingsPath: string
    readonly service: BackupService
    readonly auditText: () => Promise<string>
    readonly appLogText: () => Promise<string>
    readonly writes: string[]
    readonly restricted: string[]
}

const dirs: string[] = []
afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

interface RigOptions {
    readonly config?: boolean
    readonly accounts?: boolean
    readonly settings?: boolean
    readonly accountsChosen?: boolean
    readonly fs?: Partial<BackupFs>
    readonly now?: () => Date
    readonly restrictOk?: boolean
    readonly skipRealRestrict?: boolean
}

function rig(o: RigOptions = {}): Rig {
    const dir = mkdtempSync(join(tmpdir(), 'rf-backup-'))
    dirs.push(dir)
    const engineRoot = join(dir, 'engine')
    const userData = join(dir, 'userData')
    mkdirSync(engineRoot, { recursive: true })
    mkdirSync(userData, { recursive: true })
    const configPath = join(engineRoot, 'config.json')
    const accountsPath = join(dir, 'my-accounts.env')
    const settingsPath = join(userData, 'app-settings.json')
    if (o.config !== false) writeFileSync(configPath, CONFIG)
    if (o.accounts !== false) writeFileSync(accountsPath, ACCOUNTS_ENV)
    if (o.settings !== false) writeFileSync(settingsPath, APP_SETTINGS)

    const redactor = new Redactor()
    const redact = (t: string) => redactor.redact(t)
    const logs = join(userData, 'logs')
    const audit = new JsonlLog(logs, 'audit.log', 'audit', redact)
    const appLog = new JsonlLog(logs, 'app.log', 'app', redact)
    const writes: string[] = []
    const restricted: string[] = []
    const fsOverrides: Partial<BackupFs> = {
        writeFileSynced: async (path, data) => {
            writes.push(path.slice(dir.length))
            const { realBackupFs } = await import('../../src/main/backupService')
            await realBackupFs.writeFileSynced(path, data)
        },
        ...o.fs
    }
    const root = join(userData, 'backups', 'full')
    const service = new BackupService({
        sources: {
            engineConfigPath: configPath,
            appSettingsPath: settingsPath,
            accountsPath: () => (o.accountsChosen === false ? null : accountsPath)
        },
        backupRoot: root,
        appVersion: '0.0.1',
        redactor,
        audit,
        appLog,
        platform: 'testos',
        ...(o.now === undefined ? {} : { now: o.now }),
        ...(o.skipRealRestrict === true
            ? {
                  restrict: (path: string) => {
                      restricted.push(path.slice(dir.length))
                      return Promise.resolve(
                          o.restrictOk === false
                              ? { ok: false, detail: 'Could not limit permissions (test).' }
                              : { ok: true, detail: 'test' }
                      )
                  }
              }
            : {}),
        fs: fsOverrides
    })
    return {
        dir,
        root,
        configPath,
        accountsPath,
        settingsPath,
        service,
        writes,
        restricted,
        auditText: async () => {
            await audit.flush()
            const p = join(logs, 'audit.log')
            return existsSync(p) ? readFileSync(p, 'utf8') : ''
        },
        appLogText: async () => {
            await appLog.flush()
            const p = join(logs, 'app.log')
            return existsSync(p) ? readFileSync(p, 'utf8') : ''
        }
    }
}

const entriesOf = (root: string): string[] => (existsSync(root) ? readdirSync(root) : [])

describe('backup: a normal backup', () => {
    it('creates one finished backup folder with the three files and a manifest', async () => {
        const r = rig()
        const res = await r.service.create()
        expect(res.ok).toBe(true)
        if (!res.ok) return
        expect(res.backup.fileCount).toBe(3)
        expect(res.backup.skipped).toEqual([])
        expect(res.notes).toEqual([])

        const names = entriesOf(r.root)
        expect(names).toEqual([res.backup.id]) // only the finished folder, no temporary folder left
        expect(readdirSync(join(r.root, res.backup.id)).sort()).toEqual([
            'accounts.env',
            'app-settings.json',
            'engine-config.json',
            'manifest.json'
        ])
    })

    it('stores byte-identical copies and the manifest checksums match the stored files', async () => {
        const r = rig()
        const res = await r.service.create()
        if (!res.ok) throw new Error('backup failed')
        const folder = join(r.root, res.backup.id)
        const manifest = parseManifest(readFileSync(join(folder, 'manifest.json'), 'utf8'))
        expect(manifest.ok).toBe(true)
        if (!manifest.ok) return
        const m = manifest.manifest

        expect(readFileSync(join(folder, 'engine-config.json'), 'utf8')).toBe(CONFIG)
        expect(readFileSync(join(folder, 'accounts.env'), 'utf8')).toBe(ACCOUNTS_ENV)
        expect(readFileSync(join(folder, 'app-settings.json'), 'utf8')).toBe(APP_SETTINGS)
        for (const f of m.files) {
            const stored = readFileSync(join(folder, f.name))
            expect(f.sizeBytes).toBe(stored.length)
            expect(f.sha256).toBe(sha(stored)) // computed here, independently of the service
        }
        expect(m.totalBytes).toBe(m.files.reduce((n, f) => n + f.sizeBytes, 0))
        expect(m.id).toBe(res.backup.id)
        expect(m.appVersion).toBe('0.0.1')
        expect(m.platform).toBe('testos')
        expect(m.accountCount).toBe(2)
        expect(Math.abs(Date.parse(m.createdAt) - Date.now())).toBeLessThan(60_000)
        expect(m.files.map((f) => [f.role, f.containsSecrets])).toEqual([
            ['engine-config', true],
            ['accounts', true],
            ['app-settings', false]
        ])
    })

    it('does not change the original files', async () => {
        const r = rig()
        const before = [r.configPath, r.accountsPath, r.settingsPath].map((p) => sha(readFileSync(p)))
        await r.service.create()
        const after = [r.configPath, r.accountsPath, r.settingsPath].map((p) => sha(readFileSync(p)))
        expect(after).toEqual(before)
    })

    it('writes the manifest LAST, after every file', async () => {
        const r = rig()
        await r.service.create()
        const names = r.writes.map((w) => w.split(/[\\/]/).pop())
        expect(names).toEqual(['engine-config.json', 'accounts.env', 'app-settings.json', 'manifest.json'])
        expect(r.writes.every((w) => w.includes('.tmp-backup-'))).toBe(true) // all inside the temporary folder
    })

    it('list() shows the finished backup, newest first', async () => {
        let t = new Date(2026, 9, 15, 9, 0, 0, 0).getTime()
        const r = rig({ now: () => new Date((t += 60_000)) })
        const a = await r.service.create()
        const b = await r.service.create()
        if (!a.ok || !b.ok) throw new Error('backup failed')
        const list = await r.service.list()
        expect(list.ok).toBe(true)
        expect(list.unfinishedCount).toBe(0)
        expect(list.backups.map((x) => x.id)).toEqual([b.backup.id, a.backup.id])
        expect(list.backups[0]?.fileCount).toBe(3)
        expect(list.backups[0]?.totalBytes).toBeGreaterThan(0)
    })

    it('two backups started in the same millisecond get different names', async () => {
        const fixed = new Date(2026, 9, 15, 9, 30, 0, 123)
        const r = rig({ now: () => fixed })
        const a = await r.service.create()
        const b = await r.service.create()
        if (!a.ok || !b.ok) throw new Error('backup failed')
        expect(a.backup.id).toBe('backup-20261015-093000-123')
        expect(b.backup.id).toBe('backup-20261015-093000-123-2')
        expect((await r.service.list()).backups).toHaveLength(2)
    })

    it('runs two requests at the same time one after the other', async () => {
        const r = rig()
        const [a, b] = await Promise.all([r.service.create(), r.service.create()])
        expect(a.ok && b.ok).toBe(true)
        expect(entriesOf(r.root)).toHaveLength(2)
        expect((await r.service.list()).backups).toHaveLength(2)
    })
})

describe('backup: what is NOT in it, and why (never a silent gap)', () => {
    it('skips the accounts file when none is chosen and says so', async () => {
        const r = rig({ accountsChosen: false })
        const res = await r.service.create()
        if (!res.ok) throw new Error('backup failed')
        expect(res.backup.fileCount).toBe(2)
        expect(res.backup.skipped).toEqual([{ role: 'accounts', reason: 'No accounts file is chosen yet.' }])
        expect(res.message).toContain('Not included')
        const m = parseManifest(readFileSync(join(r.root, res.backup.id, 'manifest.json'), 'utf8'))
        expect(m.ok && m.manifest.accountCount).toBe(null)
        expect(existsSync(join(r.root, res.backup.id, 'accounts.env'))).toBe(false)
    })

    it('skips files that do not exist yet (config.json, app settings, accounts file)', async () => {
        const r = rig({ config: false, settings: false })
        const res = await r.service.create()
        if (!res.ok) throw new Error('backup failed')
        expect(res.backup.skipped.map((s) => s.role).sort()).toEqual(['app-settings', 'engine-config'])
        expect(res.backup.fileCount).toBe(1)
    })

    it('refuses with BACKUP_EMPTY when there is nothing at all, and creates no folder', async () => {
        const r = rig({ config: false, settings: false, accounts: false })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.code).toBe('BACKUP_EMPTY')
        expect(res.message).toContain('nothing to back up')
        expect(entriesOf(r.root)).toEqual([])
        expect((await r.service.list()).backups).toEqual([])
    })

    it('stops the whole backup when a source exists but cannot be read (permission denied)', async () => {
        const r = rig({
            fs: {
                readFile: (path) =>
                    path.endsWith('my-accounts.env')
                        ? Promise.reject(errno('EACCES'))
                        : Promise.resolve(readFileSync(path))
            }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.code).toBe('READ_FAILED')
        expect(res.message).toContain(
            'Accounts file could not be read (permission denied). No backup was made.'
        )
        expect(entriesOf(r.root)).toEqual([])
    })

    it('refuses a source that is a folder or far too large', async () => {
        const asFolder = rig({ fs: { stat: () => Promise.resolve({ size: 10, isFile: false }) } })
        const a = await asFolder.service.create()
        expect(a.ok).toBe(false)
        if (!a.ok) expect(a.message).toContain('is not a file')

        const huge = rig({ fs: { stat: () => Promise.resolve({ size: 21 * 1024 * 1024, isFile: true }) } })
        const b = await huge.service.create()
        expect(b.ok).toBe(false)
        if (!b.ok) {
            expect(b.code).toBe('READ_FAILED')
            expect(b.message).toContain('larger than 20.0 MB')
        }
        expect(entriesOf(huge.root)).toEqual([])
    })
})

describe('backup: an incomplete backup never looks valid', () => {
    it('disk full while writing the 2nd file: no backup, no temporary folder, nothing listed', async () => {
        let n = 0
        const r = rig({
            fs: {
                writeFileSynced: async (path, data) => {
                    n += 1
                    if (n === 2) throw errno('ENOSPC')
                    const { realBackupFs } = await import('../../src/main/backupService')
                    await realBackupFs.writeFileSynced(path, data)
                }
            }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.code).toBe('WRITE_FAILED')
        expect(res.message).toContain('the disk is full')
        expect(res.message).toContain('No backup was created.')
        expect(entriesOf(r.root)).toEqual([]) // the half-written temporary folder was removed
        const list = await r.service.list()
        expect(list.backups).toEqual([])
        expect(list.unfinishedCount).toBe(0)
    })

    it('a copy that differs from the original is caught by the read-back check', async () => {
        const r = rig({
            fs: {
                writeFileSynced: async (path, data) => {
                    const { realBackupFs } = await import('../../src/main/backupService')
                    // Simulated bad disk: one byte is wrong in the engine config copy.
                    const bad = path.endsWith('engine-config.json')
                        ? Buffer.concat([data.subarray(0, -1), Buffer.from('X')])
                        : data
                    await realBackupFs.writeFileSynced(path, bad)
                }
            }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.message).toContain('was not written correctly')
        expect(entriesOf(r.root)).toEqual([])
        expect((await r.service.list()).backups).toEqual([])
    })

    it('the final rename fails: no backup appears and the temporary folder is removed', async () => {
        const r = rig({ fs: { rename: () => Promise.reject(errno('EPERM')) } })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.message).toContain('permission denied')
        expect(entriesOf(r.root)).toEqual([])
    })

    it('a crash before the rename (even the clean-up fails) leaves only a hidden folder that is never listed', async () => {
        const r = rig({
            fs: { rename: () => Promise.reject(errno('EIO')), rm: () => Promise.reject(errno('EIO')) }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.message).toContain('An unfinished temporary folder was left behind.')
        const left = entriesOf(r.root)
        expect(left).toHaveLength(1)
        expect(left[0]).toMatch(/^\.tmp-backup-/)
        // The folder holds a complete-looking manifest, and still it is NOT a backup.
        expect(existsSync(join(r.root, left[0] as string, 'manifest.json'))).toBe(true)
        const list = await r.service.list()
        expect(list.backups).toEqual([])
        expect(list.unfinishedCount).toBe(1)
        expect(await r.appLogText()).toContain('cleanup-failed')
    })

    it('list() ignores a final-looking folder without a valid manifest and counts it as unfinished', async () => {
        const r = rig()
        const ok = await r.service.create()
        if (!ok.ok) throw new Error('backup failed')
        mkdirSync(join(r.root, 'backup-20260101-000000-000'))
        writeFileSync(join(r.root, 'backup-20260101-000000-000', 'engine-config.json'), CONFIG)
        mkdirSync(join(r.root, 'backup-20260102-000000-000'))
        writeFileSync(join(r.root, 'backup-20260102-000000-000', 'manifest.json'), '{ "half": ')
        // A valid manifest in a folder with another name is not accepted either.
        mkdirSync(join(r.root, 'backup-20260103-000000-000'))
        writeFileSync(
            join(r.root, 'backup-20260103-000000-000', 'manifest.json'),
            readFileSync(join(r.root, ok.backup.id, 'manifest.json'))
        )
        const list = await r.service.list()
        expect(list.backups.map((b) => b.id)).toEqual([ok.backup.id])
        expect(list.unfinishedCount).toBe(3)
    })

    it('list() on a missing backup folder is an empty, normal answer', async () => {
        const r = rig()
        const list = await r.service.list()
        expect(list).toEqual({ ok: true, message: null, backups: [], unfinishedCount: 0 })
    })

    it('list() says so when the backup folder cannot be read', async () => {
        const r = rig({ fs: { readdir: () => Promise.reject(errno('EACCES')) } })
        const list = await r.service.list()
        expect(list.ok).toBe(false)
        expect(list.message).toContain('permission denied')
    })
})

describe('backup: secrets (Phase 10 rules)', () => {
    const everySecret = [
        FAKE_PASSWORD,
        FAKE_TOTP,
        ...Object.values(FAKE),
        'alpha@example.com',
        'beta@example.com'
    ]

    it('the manifest holds no secret value, no e-mail address and no path of the user', async () => {
        const r = rig()
        const res = await r.service.create()
        if (!res.ok) throw new Error('backup failed')
        const text = readFileSync(join(r.root, res.backup.id, 'manifest.json'), 'utf8')
        for (const s of everySecret) expect(text, s).not.toContain(s)
        expect(text).not.toContain(r.dir)
        expect(text).not.toContain('my-accounts')
    })

    it('the result and the audit log hold no secret value, no e-mail address and no path', async () => {
        const r = rig()
        const res = await r.service.create()
        const audit = await r.auditText()
        expect(audit).toContain('backup-create')
        const shown = JSON.stringify(res) + audit
        for (const s of everySecret) expect(shown, s).not.toContain(s)
        expect(shown).not.toContain(r.dir)
    })

    it('error messages hold no path and no secret either', async () => {
        const r = rig({
            fs: {
                readFile: (path) =>
                    path.replace(/\\/g, '/').endsWith('engine/config.json')
                        ? Promise.reject(errno('EACCES'))
                        : Promise.resolve(readFileSync(path))
            }
        })
        const res = await r.service.create()
        const shown = JSON.stringify(res) + (await r.auditText())
        expect(shown).toContain('Engine settings (config.json) could not be read')
        expect(shown).not.toContain(r.dir)
        for (const s of everySecret) expect(shown, s).not.toContain(s)
    })

    it('the backup folder is made private BEFORE the first secret byte is written', async () => {
        const r = rig({ skipRealRestrict: true })
        await r.service.create()
        // restrict() was called for the backup root and for the temporary folder, and the first write came after both.
        expect(r.restricted.length).toBeGreaterThanOrEqual(2)
        expect(r.restricted[0]?.endsWith('full')).toBe(true)
        expect(r.restricted[1]).toMatch(/\.tmp-backup-/)
        expect(r.writes.length).toBe(4)
    })

    it.skipIf(isWindows)('on this system the folders are mode 700 and the files mode 600', async () => {
        const r = rig()
        const res = await r.service.create()
        if (!res.ok) throw new Error('backup failed')
        const mode = (p: string) => (statSync(p).mode & 0o777).toString(8)
        expect(mode(r.root)).toBe('700')
        const folder = join(r.root, res.backup.id)
        expect(mode(folder)).toBe('700')
        for (const f of readdirSync(folder)) expect(mode(join(folder, f)), f).toBe('600')
    })

    it('a failing permission change does not hide the backup, it adds a visible note and an audit warning', async () => {
        const r = rig({ skipRealRestrict: true, restrictOk: false })
        const res = await r.service.create()
        expect(res.ok).toBe(true)
        if (!res.ok) return
        expect(res.notes.length).toBe(2)
        expect(res.notes.join(' ')).toContain('could not be tightened')
        expect(await r.auditText()).toContain('"level":"warn"')
    })
})

describe('ioProblem', () => {
    it('turns codes into plain words and never shows a path', () => {
        expect(ioProblem(errno('EACCES'))).toBe('permission denied')
        expect(ioProblem(errno('EPERM'))).toBe('permission denied')
        expect(ioProblem(errno('ENOSPC'))).toBe('the disk is full')
        expect(ioProblem(errno('EROFS'))).toBe('the folder is read-only')
        expect(ioProblem(errno('EWHATEVER'))).toBe('error EWHATEVER')
        expect(ioProblem(new Error('/home/someone/secret path'))).toBe('unknown error')
    })
})

describe.skipIf(isRoot || isWindows)('backup: a real permission-denied folder', () => {
    it('reports permission denied and leaves nothing behind', async () => {
        const r = rig()
        mkdirSync(join(r.dir, 'userData', 'backups'), { recursive: true })
        // Make the backups folder read-only so the real "full" folder cannot be created.
        const { chmodSync } = await import('node:fs')
        chmodSync(join(r.dir, 'userData', 'backups'), 0o500)
        try {
            const res = await r.service.create()
            expect(res.ok).toBe(false)
            if (!res.ok) expect(res.message).toContain('permission denied')
        } finally {
            chmodSync(join(r.dir, 'userData', 'backups'), 0o700)
        }
        expect(entriesOf(r.root)).toEqual([])
    })
})
