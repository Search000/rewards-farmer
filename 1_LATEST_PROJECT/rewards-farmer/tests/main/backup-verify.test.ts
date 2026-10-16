// @vitest-environment node
import {
    appendFileSync,
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
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackupService, realBackupFs } from '../../src/main/backupService'
import type { BackupFs } from '../../src/main/backupService'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { FAKE } from '../fixtures/fake-secrets'

// Phase 19: the check after writing, the check every time the list is read, inspect, open folder, and the failure cases
// (missing file, permission denied, low disk). Real files in a temp dir; every account and secret is FAKE (rule 18).
// A failing disk is simulated by replacing single file operations: the same service code runs, only the disk "fails".

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
const CONFIG = JSON.stringify({ webhook: { discord: { enabled: false, url: FAKE.discordUrl } } }, null, 2)
const APP_SETTINGS = JSON.stringify({ schemaVersion: 2, themeMode: 'dark', accountsPath: null })

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
const FIXED = () => new Date(2026, 9, 15, 10, 0, 0, 123)
const FIXED_ID = 'backup-20261015-100000-123'

const dirs: string[] = []
afterEach(() => {
    while (dirs.length > 0) {
        const d = dirs.pop() as string
        try {
            chmodSync(d, 0o700)
        } catch {
            // already gone
        }
        rmSync(d, { recursive: true, force: true })
    }
})

interface RigOptions {
    readonly fs?: Partial<BackupFs>
    readonly accounts?: boolean
    readonly config?: boolean
    readonly settings?: boolean
    readonly openPath?: (p: string) => Promise<string>
    readonly noOpenPath?: boolean
}

function rig(o: RigOptions = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'rf-bverify-'))
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
    const root = join(userData, 'backups', 'full')
    const service = new BackupService({
        sources: {
            engineConfigPath: configPath,
            appSettingsPath: settingsPath,
            accountsPath: () => accountsPath
        },
        backupRoot: root,
        appVersion: '0.0.1',
        redactor,
        audit,
        appLog,
        platform: 'testos',
        now: FIXED,
        restrict: () => Promise.resolve({ ok: true, detail: 'test' }),
        ...(o.noOpenPath === true ? {} : { openPath: o.openPath ?? (() => Promise.resolve('')) }),
        ...(o.fs === undefined ? {} : { fs: o.fs })
    })
    const logText = async (): Promise<string> => {
        await audit.flush()
        await appLog.flush()
        return ['audit.log', 'app.log']
            .map((n) => (existsSync(join(logs, n)) ? readFileSync(join(logs, n), 'utf8') : ''))
            .join('\n')
    }
    return { dir, root, configPath, accountsPath, settingsPath, service, logText }
}

const folder = (r: { root: string }, id = FIXED_ID) => join(r.root, id)
const names = (root: string): string[] => (existsSync(root) ? readdirSync(root).sort() : [])

async function made(o: RigOptions = {}) {
    const r = rig(o)
    const res = await r.service.create()
    if (!res.ok) throw new Error(`backup failed: ${res.message}`)
    return { r, res }
}

describe('check after writing', () => {
    it('a good backup comes back checked: status ok, every file counted', async () => {
        const { res } = await made()
        expect(res.backup.verification.status).toBe('ok')
        expect(res.backup.verification.filesChecked).toBe(3)
        expect(res.backup.verification.problems).toEqual([])
        expect(res.message).toMatch(/created and checked/)
        expect(res.message).toMatch(/every checksum matches/)
    })

    it('reads the FINISHED folder again from the disk (not the memory copy)', async () => {
        const reads: string[] = []
        const r = rig({
            fs: {
                readFile: (p) => {
                    reads.push(p)
                    return realBackupFs.readFile(p)
                }
            }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(true)
        const finalReads = reads.filter((p) => p.startsWith(folder(r)))
        expect(finalReads.map((p) => p.slice(folder(r).length + 1)).sort()).toEqual([
            'accounts.env',
            'app-settings.json',
            'engine-config.json',
            'manifest.json'
        ])
    })

    // Simulates a bad drive or a scanner that changes a file right after the folder got its final name: the REAL file on the
    // disk is changed (one byte added), so every later read sees the same damage.
    const damageAfterRename = (): Partial<BackupFs> => ({
        rename: async (from, to) => {
            await realBackupFs.rename(from, to)
            if (!to.includes('.tmp-')) appendFileSync(join(to, 'accounts.env'), 'x')
        }
    })

    it('damage found right after the rename: the backup is NOT created, the folder is set aside and never listed', async () => {
        const r = rig({ fs: damageAfterRename() })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.reason).toBe('verify-failed')
        expect(res.code).toBe('WRITE_FAILED')
        expect(res.message).toMatch(/check afterwards found a problem/)
        expect(res.message).toMatch(/different size than when the backup was made/)
        expect(res.message).toMatch(/set it aside/)
        expect(res.fix.length).toBeGreaterThan(20)
        // Nothing looks like a backup. The hidden copy is kept (never deleted) and counted as unfinished only.
        expect(names(r.root)).not.toContain(FIXED_ID)
        expect(names(r.root).filter((n) => n.startsWith(`.tmp-failed-${FIXED_ID}`))).toHaveLength(1)
        const list = await r.service.list()
        expect(list.backups).toEqual([])
        expect(list.unfinishedCount).toBe(1)
    })

    it('if the damaged folder cannot be set aside either, the message says so and the list shows it as Damaged, never OK', async () => {
        const r = rig({
            fs: {
                rename: async (from, to) => {
                    if (to.includes('.tmp-failed-')) throw errno('EPERM')
                    await damageAfterRename().rename?.(from, to)
                }
            }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.reason).toBe('verify-failed')
        expect(res.message).toMatch(/could not set it aside/)
        expect(res.message).toMatch(/Damaged/)
        const list = await r.service.list()
        expect(list.backups).toHaveLength(1)
        expect(list.backups[0]?.verification.status).toBe('failed')
        expect(list.backups[0]?.verification.problems[0]?.file).toBe('accounts.env')
        expect(await r.logText()).toMatch(/set-aside-failed/)
    })
})

describe('check every time the list is read (damage that happens LATER)', () => {
    it('a deleted file: listed as failed with the file name, never as OK', async () => {
        const { r, res } = await made()
        rmSync(join(folder(r, res.backup.id), 'accounts.env'))
        const list = await r.service.list()
        expect(list.backups).toHaveLength(1)
        const v = list.backups[0]?.verification
        expect(v?.status).toBe('failed')
        expect(v?.problems).toHaveLength(1)
        expect(v?.problems[0]?.kind).toBe('file-missing')
        expect(v?.problems[0]?.file).toBe('accounts.env')
        expect(v?.problems[0]?.text).toMatch(/is missing from the backup/)
    })

    it('one changed byte (same size): checksum-differs', async () => {
        const { r, res } = await made()
        const p = join(folder(r, res.backup.id), 'engine-config.json')
        const bytes = readFileSync(p)
        bytes[bytes.length - 3] = bytes[bytes.length - 3] === 0x41 ? 0x42 : 0x41
        writeFileSync(p, bytes)
        const v = (await r.service.list()).backups[0]?.verification
        expect(v?.status).toBe('failed')
        expect(v?.problems.map((x) => x.kind)).toEqual(['checksum-differs'])
        expect(v?.problems[0]?.text).toMatch(/was changed after the backup was made/)
    })

    it('a longer file: size-differs', async () => {
        const { r, res } = await made()
        appendFileSync(join(folder(r, res.backup.id), 'app-settings.json'), ' ')
        const v = (await r.service.list()).backups[0]?.verification
        expect(v?.problems.map((x) => x.kind)).toEqual(['size-differs'])
    })

    it('a cut-off file: size-differs', async () => {
        const { r, res } = await made()
        truncateSync(join(folder(r, res.backup.id), 'accounts.env'), 10)
        const v = (await r.service.list()).backups[0]?.verification
        expect(v?.problems.map((x) => x.kind)).toEqual(['size-differs'])
    })

    it('an edited manifest checksum is caught (the file no longer matches what the manifest says)', async () => {
        const { r, res } = await made()
        const mp = join(folder(r, res.backup.id), 'manifest.json')
        const m = JSON.parse(readFileSync(mp, 'utf8')) as { files: { sha256: string }[] }
        m.files[0]!.sha256 = 'a'.repeat(64)
        writeFileSync(mp, JSON.stringify(m))
        const v = (await r.service.list()).backups[0]?.verification
        expect(v?.status).toBe('failed')
        expect(v?.problems.map((x) => x.kind)).toEqual(['checksum-differs'])
    })

    it('a file replaced by a folder: not-a-file', async () => {
        const { r, res } = await made()
        const p = join(folder(r, res.backup.id), 'app-settings.json')
        rmSync(p)
        mkdirSync(p)
        const v = (await r.service.list()).backups[0]?.verification
        expect(v?.problems.map((x) => x.kind)).toEqual(['not-a-file'])
    })

    it('a missing manifest: the folder is not a backup, only counted as unfinished', async () => {
        const { r, res } = await made()
        rmSync(join(folder(r, res.backup.id), 'manifest.json'))
        const list = await r.service.list()
        expect(list.backups).toEqual([])
        expect(list.unfinishedCount).toBe(1)
    })

    it('an extra item is only a note; the backup is still OK', async () => {
        const { r, res } = await made()
        writeFileSync(join(folder(r, res.backup.id), 'notes.txt'), 'hello')
        const v = (await r.service.list()).backups[0]?.verification
        expect(v?.status).toBe('ok')
        expect(v?.notes.join(' ')).toMatch(/1 item\(s\) in the backup folder are not listed/)
    })

    it('a good and a damaged backup side by side: only the damaged one fails', async () => {
        const first = rig()
        const a = await first.service.create()
        if (!a.ok) throw new Error('x')
        // A second backup in the same folder, one second later.
        const second = new BackupService({
            sources: {
                engineConfigPath: first.configPath,
                appSettingsPath: first.settingsPath,
                accountsPath: () => first.accountsPath
            },
            backupRoot: first.root,
            appVersion: '0.0.2',
            redactor: new Redactor(),
            audit: new JsonlLog(join(first.dir, 'l2'), 'a.log', 'audit', (t) => t),
            appLog: new JsonlLog(join(first.dir, 'l2'), 'b.log', 'app', (t) => t),
            now: () => new Date(2026, 9, 15, 10, 5, 0, 0),
            restrict: () => Promise.resolve({ ok: true, detail: 'test' })
        })
        const b = await second.create()
        if (!b.ok) throw new Error('y')
        rmSync(join(folder(first, a.backup.id), 'engine-config.json'))
        const list = await first.service.list()
        expect(list.backups.map((x) => [x.id, x.verification.status])).toEqual([
            [b.backup.id, 'ok'],
            [a.backup.id, 'failed']
        ])
    })

    it('a backup file that cannot be read (permission denied) is reported as unreadable with plain words', async () => {
        const { r, res } = await made()
        const id = res.backup.id
        const blocked = new BackupService({
            sources: {
                engineConfigPath: r.configPath,
                appSettingsPath: r.settingsPath,
                accountsPath: () => r.accountsPath
            },
            backupRoot: r.root,
            appVersion: '0.0.1',
            redactor: new Redactor(),
            audit: new JsonlLog(join(r.dir, 'l3'), 'a.log', 'audit', (t) => t),
            appLog: new JsonlLog(join(r.dir, 'l3'), 'b.log', 'app', (t) => t),
            fs: {
                readFile: (p) =>
                    p.startsWith(folder(r, id)) && p.endsWith('accounts.env')
                        ? Promise.reject(errno('EACCES'))
                        : realBackupFs.readFile(p)
            }
        })
        const v = (await blocked.list()).backups[0]?.verification
        expect(v?.status).toBe('failed')
        expect(v?.problems.map((x) => x.kind)).toEqual(['unreadable'])
        expect(v?.problems[0]?.text).toMatch(/could not be read \(permission denied\)/)
        expect(JSON.stringify(v)).not.toContain(r.dir)
    })

    it.skipIf(isRoot || isWindows)(
        'a REAL permission-denied backup file (chmod 000) is reported as unreadable',
        async () => {
            const { r, res } = await made()
            chmodSync(join(folder(r, res.backup.id), 'accounts.env'), 0o000)
            const v = (await r.service.list()).backups[0]?.verification
            expect(v?.problems.map((x) => x.kind)).toEqual(['unreadable'])
            expect(v?.problems[0]?.text).toMatch(/permission denied/)
        }
    )
})

describe('inspect', () => {
    it('returns the manifest facts and a fresh check, with no file content and no folder path', async () => {
        const { r, res } = await made()
        const out = await r.service.inspect(res.backup.id)
        expect(out.ok).toBe(true)
        if (!out.ok) return
        expect(out.detail.id).toBe(res.backup.id)
        expect(out.detail.appVersion).toBe('0.0.1')
        expect(out.detail.platform).toBe('testos')
        expect(out.detail.accountCount).toBe(2)
        expect(out.detail.files.map((f) => f.role).sort()).toEqual([
            'accounts',
            'app-settings',
            'engine-config'
        ])
        expect(out.detail.verification.status).toBe('ok')
        const text = JSON.stringify(out)
        for (const secret of [
            FAKE_PASSWORD,
            FAKE_TOTP,
            FAKE.discordUrl,
            'alpha@example.com',
            'beta@example.com',
            r.dir
        ]) {
            expect(text).not.toContain(secret)
        }
    })

    it('inspect sees damage that happened after the backup', async () => {
        const { r, res } = await made()
        appendFileSync(join(folder(r, res.backup.id), 'accounts.env'), 'x')
        const out = await r.service.inspect(res.backup.id)
        expect(out.ok && out.detail.verification.status).toBe('failed')
    })

    it.each([
        '../etc',
        '..',
        '',
        'backup-1',
        'backup-20261015-100000-123/../..',
        'backup-20261015-100000-123\\..\\x',
        '/etc/passwd',
        'C:\\Windows',
        '.tmp-backup-20261015-100000-123-abc123'
    ])('refuses the name %j before touching the disk (no path can get through)', async (bad) => {
        const stat = vi.fn(realBackupFs.stat)
        const exists = vi.fn(realBackupFs.exists)
        const readFile = vi.fn(realBackupFs.readFile)
        const r = rig({ fs: { stat, exists, readFile } })
        const out = await r.service.inspect(bad)
        expect(out.ok).toBe(false)
        if (!out.ok) expect(out.code).toBe('BAD_REQUEST')
        expect(exists).not.toHaveBeenCalled()
        expect(readFile).not.toHaveBeenCalled()
    })

    it.each([undefined, null, 5, {}, ['backup-20261015-100000-123']])(
        'refuses a non-string %j',
        async (bad) => {
            const r = rig()
            const out = await r.service.inspect(bad)
            expect(out.ok).toBe(false)
        }
    )

    it('a valid name that does not exist is NOT_FOUND with a next step', async () => {
        const r = rig()
        const out = await r.service.inspect('backup-20200101-000000-000')
        expect(out.ok).toBe(false)
        if (!out.ok) {
            expect(out.code).toBe('NOT_FOUND')
            expect(out.message).toMatch(/Check again/)
        }
    })

    it('a folder with a valid name but no usable manifest is not shown as a backup', async () => {
        const r = rig()
        mkdirSync(join(r.root, 'backup-20200101-000000-000'), { recursive: true })
        const out = await r.service.inspect('backup-20200101-000000-000')
        expect(out.ok).toBe(false)
        if (!out.ok) expect(out.message).toMatch(/not a finished backup/)
    })
})

describe('open the backup folder', () => {
    it('says there is no folder yet before the first backup, and does not call the system', async () => {
        const openPath = vi.fn(() => Promise.resolve(''))
        const r = rig({ openPath })
        const out = await r.service.openFolder()
        expect(out.ok).toBe(false)
        expect(out.message).toMatch(/Create a backup first/)
        expect(openPath).not.toHaveBeenCalled()
    })

    it('opens exactly the backup folder (the renderer chose nothing)', async () => {
        const openPath = vi.fn(() => Promise.resolve(''))
        const { r } = await made({ openPath })
        const out = await r.service.openFolder()
        expect(out.ok).toBe(true)
        expect(openPath).toHaveBeenCalledExactlyOnceWith(r.root)
        expect(out.message).not.toContain(r.dir)
    })

    it('a system error is shown in plain words, without the path', async () => {
        const { r } = await made({ openPath: () => Promise.resolve(`Failed to open path ${'X'}`) })
        const out = await r.service.openFolder()
        expect(out.ok).toBe(false)
        expect(out.message).toBe('The backup folder could not be opened.')
    })

    it('a throwing system call is handled', async () => {
        const { r } = await made({ openPath: () => Promise.reject(new Error('boom')) })
        expect((await r.service.openFolder()).ok).toBe(false)
    })

    it('when the app gives no way to open folders, it says so', async () => {
        const { r } = await made({ noOpenPath: true })
        const out = await r.service.openFolder()
        expect(out.ok).toBe(false)
        expect(out.message).toMatch(/not available/)
    })
})

describe('failure cases during backup: clear message, a "what to do", nothing half-written', () => {
    const noLeftovers = (root: string): void => {
        expect(names(root).filter((n) => n.startsWith('backup-'))).toEqual([])
    }

    it('LOW DISK (checked before writing): refused, nothing written, says how much is needed and what to do', async () => {
        const writes = vi.fn(realBackupFs.writeFileSynced)
        const mk = vi.fn(realBackupFs.mkdir)
        const r = rig({ fs: { freeBytes: () => Promise.resolve(1000), writeFileSynced: writes, mkdir: mk } })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.reason).toBe('low-space')
        expect(res.code).toBe('WRITE_FAILED')
        expect(res.message).toMatch(/not enough free disk space/)
        expect(res.message).toMatch(/1000 bytes are free/)
        expect(res.fix).toMatch(/Free some space/)
        expect(res.fix).toMatch(/Create backup/)
        expect(writes).not.toHaveBeenCalled()
        expect(mk).not.toHaveBeenCalled() // not even the folder
        expect(existsSync(r.root)).toBe(false)
    })

    it('the free-space rule counts the real size: exactly enough passes, one byte less is refused', async () => {
        const size =
            Buffer.byteLength(CONFIG) + Buffer.byteLength(ACCOUNTS_ENV) + Buffer.byteLength(APP_SETTINGS)
        const need = size + 1024 * 1024
        const ok = rig({ fs: { freeBytes: () => Promise.resolve(need) } })
        expect((await ok.service.create()).ok).toBe(true)
        const low = rig({ fs: { freeBytes: () => Promise.resolve(need - 1) } })
        const res = await low.service.create()
        expect(res.ok).toBe(false)
    })

    it.each([
        ['cannot be read (null)', () => Promise.resolve(null)],
        ['throws', () => Promise.reject(new Error('statfs failed'))]
    ])('free space that %s does not block a backup', async (_n, freeBytes) => {
        const r = rig({ fs: { freeBytes } })
        expect((await r.service.create()).ok).toBe(true)
    })

    it('DISK FULL while writing (second file): no backup, temp folder removed, plain words and a next step', async () => {
        let n = 0
        const r = rig({
            fs: {
                writeFileSynced: async (p, d) => {
                    n += 1
                    if (n === 2) throw errno('ENOSPC')
                    await realBackupFs.writeFileSynced(p, d)
                }
            }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.reason).toBe('disk-full')
        expect(res.message).toMatch(/the disk is full/)
        expect(res.message).toMatch(/No backup was created/)
        expect(res.fix).toMatch(/Free some space/)
        expect(names(r.root)).toEqual([]) // no finished folder, no temporary folder
        noLeftovers(r.root)
    })

    it('PERMISSION DENIED when the backup folder is made: no backup, says what to check', async () => {
        const r = rig({
            fs: {
                mkdir: () => Promise.reject(errno('EACCES'))
            }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.reason).toBe('permission-denied')
        expect(res.message).toMatch(/permission denied/)
        expect(res.fix).toMatch(/Health page/)
        expect(res.fix).toMatch(/Create backup/)
        noLeftovers(r.root)
    })

    it('PERMISSION DENIED while writing a file: temp folder removed', async () => {
        const r = rig({
            fs: {
                writeFileSynced: () => Promise.reject(errno('EPERM'))
            }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.reason).toBe('permission-denied')
        expect(names(r.root)).toEqual([])
    })

    it('READ-ONLY folder: its own reason and text', async () => {
        const r = rig({ fs: { writeFileSynced: () => Promise.reject(errno('EROFS')) } })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (!res.ok) {
            expect(res.reason).toBe('read-only')
            expect(res.fix).toMatch(/read-only/)
        }
    })

    it('PERMISSION DENIED reading one of YOUR files: nothing saved (no silent gap), says which file and what to do', async () => {
        const r = rig({
            fs: {
                readFile: (p) =>
                    p.endsWith('my-accounts.env') ? Promise.reject(errno('EACCES')) : realBackupFs.readFile(p)
            }
        })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.code).toBe('READ_FAILED')
        expect(res.reason).toBe('source-unreadable')
        expect(res.message).toMatch(/Accounts file could not be read \(permission denied\)/)
        expect(res.fix).toMatch(/Close any program that is using the file/)
        expect(existsSync(r.root)).toBe(false)
        expect(res.message).not.toContain(r.dir)
    })

    it.skipIf(isRoot || isWindows)('a REAL unreadable accounts file (chmod 000)', async () => {
        const r = rig()
        chmodSync(r.accountsPath, 0o000)
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.reason).toBe('source-unreadable')
    })

    it('MISSING accounts file: the backup is made, the gap is stated in the result and in the list', async () => {
        const { r, res } = await made({ accounts: false })
        expect(res.backup.fileCount).toBe(2)
        expect(res.backup.skipped.map((s) => s.role)).toEqual(['accounts'])
        expect(res.message).toMatch(/Not included: Accounts file does not exist yet/)
        const listed = (await r.service.list()).backups[0]
        expect(listed?.skipped.map((s) => s.role)).toEqual(['accounts'])
        expect(listed?.verification.status).toBe('ok')
    })

    it('MISSING config.json and settings: only the accounts file is saved and the two gaps are named', async () => {
        const { res } = await made({ config: false, settings: false })
        expect(res.backup.fileCount).toBe(1)
        expect(res.backup.skipped.map((s) => s.role).sort()).toEqual(['app-settings', 'engine-config'])
    })

    it('NOTHING to back up: no folder, a next step', async () => {
        const r = rig({ config: false, accounts: false, settings: false })
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.code).toBe('BACKUP_EMPTY')
        expect(res.reason).toBe('nothing-to-back-up')
        expect(res.fix).toMatch(/Home page/)
        expect(existsSync(r.root)).toBe(false)
    })

    it('a source that turns out to be a folder: stops with a next step', async () => {
        const r = rig()
        rmSync(r.settingsPath)
        mkdirSync(r.settingsPath)
        const res = await r.service.create()
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.reason).toBe('source-not-file')
    })

    it('every failure reason has a "what to do" text that names a real button or page and never a typed command', async () => {
        const { failureFix } = await import('../../src/shared/backup-rules')
        const reasons = [
            'permission-denied',
            'disk-full',
            'low-space',
            'read-only',
            'source-unreadable',
            'source-not-file',
            'source-too-large',
            'nothing-to-back-up',
            'copy-differs',
            'verify-failed',
            'unknown'
        ] as const
        for (const reason of reasons) {
            const fix = failureFix(reason)
            expect(fix.length).toBeGreaterThan(40)
            expect(fix).toMatch(/Create backup|Health page|Home page/)
            expect(fix).not.toMatch(/npm |cmd|powershell|\.bat/i)
        }
    })

    it('failed backups leave NO secret, e-mail or folder path in the result, the fix or the logs', async () => {
        const failing: RigOptions[] = [
            { fs: { freeBytes: () => Promise.resolve(10) } },
            { fs: { writeFileSynced: () => Promise.reject(errno('ENOSPC')) } },
            { fs: { mkdir: () => Promise.reject(errno('EACCES')) } },
            {
                fs: {
                    readFile: (p) =>
                        p.endsWith('my-accounts.env')
                            ? Promise.reject(errno('EACCES'))
                            : realBackupFs.readFile(p)
                }
            }
        ]
        for (const o of failing) {
            const r = rig(o)
            const res = await r.service.create()
            const text = JSON.stringify(res) + (await r.logText())
            for (const secret of [
                FAKE_PASSWORD,
                FAKE_TOTP,
                FAKE.discordUrl,
                'alpha@example.com',
                'beta@example.com',
                r.dir
            ]) {
                expect(text).not.toContain(secret)
            }
        }
    })

    it('after any of these failures the originals are untouched and a new try works', async () => {
        let fail = true
        const r = rig({
            fs: {
                writeFileSynced: async (p, d) => {
                    if (fail) throw errno('ENOSPC')
                    await realBackupFs.writeFileSynced(p, d)
                }
            }
        })
        expect((await r.service.create()).ok).toBe(false)
        expect(readFileSync(r.accountsPath, 'utf8')).toBe(ACCOUNTS_ENV)
        expect(readFileSync(r.configPath, 'utf8')).toBe(CONFIG)
        fail = false
        const again = await r.service.create()
        expect(again.ok).toBe(true)
        expect(names(r.root)).toHaveLength(1)
    })
})
