// @vitest-environment node
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackupService } from '../../src/main/backupService'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { RestoreService, realRestoreFs } from '../../src/main/restoreService'
import type { RestoreFs } from '../../src/main/restoreService'
import type {
    RestoreApplyFailure,
    RestoreApplyResult,
    RestoreUndoFailure,
    RestoreUndoResult
} from '../../src/shared/restore-types'
import { FAKE } from '../fixtures/fake-secrets'

// Phase 21: restore execution, undo, an interrupted restore and the full backup -> change -> restore round trip.
// Real files in a temp folder; every account and secret is FAKE (rule 18). A failing disk is simulated by replacing single
// file operations (the service code is the same); a crash is simulated by an operation that never returns, and the "restarted
// app" is a NEW RestoreService over the same folders.

const FAKE_PASSWORD = 'fake-pw-Zx81-test-only'
const FAKE_TOTP = 'FAKETOTPSECRET234567'
const ACCOUNTS_A = [
    'ACCOUNT_1_EMAIL=alpha@example.com',
    `ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}`,
    `ACCOUNT_1_TOTP_SECRET=${FAKE_TOTP}`,
    'ACCOUNT_2_EMAIL=beta@example.com',
    `ACCOUNT_2_PASSWORD=${FAKE_PASSWORD}2`,
    ''
].join('\n')
const ACCOUNTS_B = ['ACCOUNT_1_EMAIL=gamma@example.com', `ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}3`, ''].join(
    '\n'
)
const ACCOUNTS_C = ['ACCOUNT_1_EMAIL=delta@example.com', `ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}4`, ''].join(
    '\n'
)
const CONFIG_A = JSON.stringify(
    { headless: true, webhook: { discord: { enabled: false, url: FAKE.discordUrl } } },
    null,
    2
)
const CONFIG_B = JSON.stringify(
    { headless: false, webhook: { discord: { enabled: false, url: '' } } },
    null,
    2
)
const CONFIG_C = JSON.stringify({ headless: true, searchDelay: { min: '5sec', max: '9sec' } }, null, 2)

const FIXED = () => new Date(2026, 9, 15, 10, 0, 0, 123)
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

const dirs: string[] = []
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

const settingsText = (accountsPath: string | null, theme = 'dark'): string =>
    JSON.stringify({
        schemaVersion: 2,
        themeMode: theme,
        accountsPath,
        timerEnabled: false,
        timerTime: '00:00',
        shutdownAfterRun: false
    })

interface RigOptions {
    readonly backupVersion?: string
    readonly appVersion?: string
    readonly restoreFs?: Partial<RestoreFs>
}

interface BuildExtra {
    readonly fs?: Partial<RestoreFs>
    readonly exclusive?: <T>(work: () => Promise<T>, refused: (why: string) => T) => Promise<T>
    readonly afterFilesChanged?: () => Promise<string | null>
}

function rig(o: RigOptions = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'rf-apply-'))
    dirs.push(dir)
    const engineRoot = join(dir, 'engine')
    const userData = join(dir, 'userData')
    mkdirSync(engineRoot, { recursive: true })
    mkdirSync(userData, { recursive: true })
    const configPath = join(engineRoot, 'config.json')
    const accountsPath = join(dir, 'my-accounts.env')
    const otherAccountsPath = join(dir, 'other-accounts.env')
    const settingsPath = join(userData, 'app-settings.json')
    const journalPath = join(userData, 'backups', 'restore-journal.json')
    writeFileSync(configPath, CONFIG_A)
    writeFileSync(accountsPath, ACCOUNTS_A)
    writeFileSync(settingsPath, settingsText(accountsPath))

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
    const backups = new BackupService({ ...common, backupRoot, appVersion: o.backupVersion ?? '0.0.1' })
    const snapshots = new BackupService({ ...common, backupRoot: preRoot, appVersion: '0.0.1' })
    const spy = {
        readFile: vi.fn(realRestoreFs.readFile),
        stat: vi.fn(realRestoreFs.stat),
        exists: vi.fn(realRestoreFs.exists)
    }
    // A new RestoreService over the same folders. A second one is "the app after a restart".
    const build = (extra: BuildExtra = {}): RestoreService =>
        new RestoreService({
            backups,
            snapshots,
            targets: sources,
            journalPath,
            appVersion: o.appVersion ?? '0.0.1',
            settingsSchema: 2,
            runBlock: () => state.runBlock,
            redactor,
            audit,
            appLog,
            platform: 'testos',
            fs: { ...spy, ...(o.restoreFs ?? {}), ...(extra.fs ?? {}) },
            ...(extra.exclusive === undefined ? {} : { exclusive: extra.exclusive }),
            ...(extra.afterFilesChanged === undefined ? {} : { afterFilesChanged: extra.afterFilesChanged })
        })
    const restore = build()
    const logText = async (): Promise<string> => {
        await audit.flush()
        await appLog.flush()
        return ['audit.log', 'app.log']
            .map((n) => (existsSync(join(logs, n)) ? readFileSync(join(logs, n), 'utf8') : ''))
            .join('\n')
    }
    const hash = (p: string): string | null => (existsSync(p) ? sha(readFileSync(p)) : null)
    const userFiles = (): Record<string, string | null> => ({
        config: hash(configPath),
        accounts: hash(accountsPath),
        settings: hash(settingsPath)
    })
    return {
        dir,
        engineRoot,
        configPath,
        accountsPath,
        otherAccountsPath,
        settingsPath,
        journalPath,
        backupRoot,
        preRoot,
        state,
        backups,
        snapshots,
        restore,
        build,
        spy,
        logText,
        hash,
        userFiles
    }
}

type Rig = ReturnType<typeof rig>

async function backupNow(r: Rig): Promise<string> {
    const res = await r.backups.create()
    if (!res.ok) throw new Error(`test setup: backup failed: ${res.message}`)
    return res.backup.id
}

// The usual starting point: a backup of state A, then the live files changed to state B.
async function backupThenChange(r: Rig): Promise<{ id: string; stateA: Record<string, string | null> }> {
    const stateA = r.userFiles()
    const id = await backupNow(r)
    writeFileSync(r.configPath, CONFIG_B)
    writeFileSync(r.accountsPath, ACCOUNTS_B)
    return { id, stateA }
}

function applied(res: RestoreApplyResult): Extract<RestoreApplyResult, { ok: true }> {
    if (!res.ok) throw new Error(`expected the restore to work: ${res.message}`)
    return res
}
function refusedApply(res: RestoreApplyResult): RestoreApplyFailure {
    if (res.ok) throw new Error('expected the restore to be refused')
    return res
}
function undone(res: RestoreUndoResult): Extract<RestoreUndoResult, { ok: true }> {
    if (!res.ok) throw new Error(`expected the undo to work: ${res.message}`)
    return res
}
function refusedUndo(res: RestoreUndoResult): RestoreUndoFailure {
    if (res.ok) throw new Error('expected the undo to be refused')
    return res
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(check: () => boolean): Promise<void> {
    for (let i = 0; i < 300; i++) {
        if (check()) return
        await sleep(10)
    }
    throw new Error('test setup: waited too long')
}

// A disk whose Nth write to a USER file (not the restore record) goes wrong. `decide` returns a promise to replace the write,
// or undefined to let it through. `count()` says how many user-file writes were started.
function userWrites(decide: (n: number, path: string, data: Buffer) => Promise<void> | Buffer | undefined) {
    let n = 0
    const fs: Partial<RestoreFs> = {
        async writeFileAtomic(path: string, data: Buffer): Promise<void> {
            if (path.endsWith('restore-journal.json')) return realRestoreFs.writeFileAtomic(path, data)
            n++
            const d = decide(n, path, data)
            if (d === undefined) return realRestoreFs.writeFileAtomic(path, data)
            if (Buffer.isBuffer(d)) return realRestoreFs.writeFileAtomic(path, d)
            return d
        }
    }
    return { fs, count: () => n }
}
const hang = (): Promise<void> => new Promise<void>(() => undefined)

const snapshotCount = async (r: Rig): Promise<number> => (await r.snapshots.list()).backups.length

// ---------------------------------------------------------------------------------------------------------------------

describe('the explicit confirmation', () => {
    const notYes: Array<[string, unknown]> = [
        ['false', false],
        ['undefined', undefined],
        ['null', null],
        ['the text "true"', 'true'],
        ['the number 1', 1],
        ['the text "yes"', 'yes'],
        ['an object', {}]
    ]
    for (const [label, confirmed] of notYes) {
        it(`apply with confirmed = ${label} changes nothing and reads nothing`, async () => {
            const r = rig()
            const { id } = await backupThenChange(r)
            const before = r.userFiles()
            r.spy.readFile.mockClear()
            r.spy.stat.mockClear()
            r.spy.exists.mockClear()
            const f = refusedApply(await r.restore.apply(id, confirmed))
            expect(f.stage).toBe('not-confirmed')
            expect(f.filesState).toBe('untouched')
            expect(f.fix.length).toBeGreaterThan(10)
            expect(r.userFiles()).toEqual(before)
            expect(r.spy.readFile).not.toHaveBeenCalled()
            expect(r.spy.stat).not.toHaveBeenCalled()
            expect(r.spy.exists).not.toHaveBeenCalled()
            expect(existsSync(r.journalPath)).toBe(false)
            expect(await snapshotCount(r)).toBe(0)
        })
    }

    for (const [label, confirmed] of notYes.slice(0, 4)) {
        it(`undo with confirmed = ${label} changes nothing`, async () => {
            const r = rig()
            const { id } = await backupThenChange(r)
            applied(await r.restore.apply(id, true))
            const after = r.userFiles()
            const f = refusedUndo(await r.restore.undo(confirmed))
            expect(f.stage).toBe('not-confirmed')
            expect(f.filesState).toBe('untouched')
            expect(r.userFiles()).toEqual(after)
        })
    }
})

describe('a good restore', () => {
    it('writes the backup files back, reads each one back, keeps a safety copy and offers undo', async () => {
        const r = rig()
        const { id, stateA } = await backupThenChange(r)
        const stateB = r.userFiles()
        const res = applied(await r.restore.apply(id, true))
        expect(r.hash(r.configPath)).toBe(stateA.config)
        expect(r.hash(r.accountsPath)).toBe(stateA.accounts)
        expect(res.files.map((f) => f.role)).toEqual(['engine-config', 'accounts'])
        expect(res.files.every((f) => f.action === 'replaced' && f.bytes > 0)).toBe(true)
        expect(res.snapshot.status).toBe('created')
        expect(res.undoAvailable).toBe(true)
        expect(res.backupId).toBe(id)
        expect(res.message).toMatch(/each one read back/)
        // the safety copy really holds state B
        if (res.snapshot.status === 'created') {
            const loaded = await r.snapshots.loadVerified(res.snapshot.id)
            expect(loaded.kind).toBe('checked')
            if (loaded.kind === 'checked') {
                expect(sha(loaded.files.get('engine-config') as Buffer)).toBe(stateB.config)
                expect(sha(loaded.files.get('accounts') as Buffer)).toBe(stateB.accounts)
            }
        }
        const h = await r.restore.history()
        expect(h.status).toBe('undo-available')
        expect(h.canUndo).toBe(true)
        expect(h.undoBlockedReason).toBeNull()
        expect(h.backupId).toBe(id)
    })

    it('leaves no temporary file next to the files it wrote', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        applied(await r.restore.apply(id, true))
        expect(readdirSync(r.engineRoot)).toEqual(['config.json'])
        expect(readdirSync(r.dir).sort()).toEqual(['engine', 'my-accounts.env', 'userData'])
    })

    it('restores the app settings too, and keeps what the backup says', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.settingsPath, settingsText(r.accountsPath, 'light'))
        applied(await r.restore.apply(id, true))
        const restored = JSON.parse(readFileSync(r.settingsPath, 'utf8')) as { themeMode: string }
        expect(restored.themeMode).toBe('dark')
    })

    it('when everything already matches the backup, nothing is written and no undo is offered', async () => {
        const r = rig()
        const id = await backupNow(r)
        const before = r.userFiles()
        const res = applied(await r.restore.apply(id, true))
        expect(res.files).toEqual([])
        expect(res.undoAvailable).toBe(false)
        expect(res.snapshot.status).toBe('not-needed')
        expect(r.userFiles()).toEqual(before)
        expect(existsSync(r.journalPath)).toBe(false)
        expect(await snapshotCount(r)).toBe(0)
    })

    it('a file that does not exist now is created, and undo removes only that file', async () => {
        const r = rig()
        const id = await backupNow(r)
        rmSync(r.accountsPath)
        const configBefore = r.hash(r.configPath)
        const res = applied(await r.restore.apply(id, true))
        expect(res.files.find((f) => f.role === 'accounts')?.action).toBe('created')
        expect(r.hash(r.accountsPath)).toBe(sha(ACCOUNTS_A))
        const back = undone(await r.restore.undo(true))
        expect(back.files.find((f) => f.role === 'accounts')?.action).toBe('removed')
        expect(existsSync(r.accountsPath)).toBe(false)
        expect(r.hash(r.configPath)).toBe(configBefore)
    })

    it('two restores at the same time are handled one after the other', async () => {
        const r = rig()
        const { id, stateA } = await backupThenChange(r)
        const [a, b] = await Promise.all([r.restore.apply(id, true), r.restore.apply(id, true)])
        expect(a.ok && b.ok).toBe(true)
        expect(r.hash(r.configPath)).toBe(stateA.config)
        expect(r.hash(r.accountsPath)).toBe(stateA.accounts)
    })
})

describe('a restore that is refused before anything is written', () => {
    it('a damaged backup', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        const folder = join(r.backupRoot, id)
        const victim = readdirSync(folder).find((n) => n !== 'manifest.json') as string
        writeFileSync(join(folder, victim), 'tampered')
        const before = r.userFiles()
        const f = refusedApply(await r.restore.apply(id, true))
        expect(f.stage).toBe('rejected')
        expect(f.filesState).toBe('untouched')
        expect(r.userFiles()).toEqual(before)
        expect(existsSync(r.journalPath)).toBe(false)
        expect(await snapshotCount(r)).toBe(0)
    })

    it('a backup made by a newer app', async () => {
        const r = rig({ backupVersion: '9.9.9' })
        const { id } = await backupThenChange(r)
        const before = r.userFiles()
        const f = refusedApply(await r.restore.apply(id, true))
        expect(f.stage).toBe('rejected')
        expect(r.userFiles()).toEqual(before)
    })

    it('an id that is not a backup', async () => {
        const r = rig()
        await backupThenChange(r)
        const before = r.userFiles()
        for (const bad of ['../../etc/passwd', 'nope', '', 42, null]) {
            const f = refusedApply(await r.restore.apply(bad, true))
            expect(f.stage).toBe('rejected')
        }
        expect(r.userFiles()).toEqual(before)
    })

    it('while a run is active', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        r.state.runBlock = 'A run is active.'
        const before = r.userFiles()
        const f = refusedApply(await r.restore.apply(id, true))
        expect(f.stage).toBe('blocked')
        expect(f.filesState).toBe('untouched')
        expect(r.userFiles()).toEqual(before)
        expect(await snapshotCount(r)).toBe(0)
    })

    it('when the app cannot be locked (it is busy)', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        const before = r.userFiles()
        const busy = r.build({
            exclusive: <T>(_work: () => Promise<T>, refused: (why: string) => T): Promise<T> =>
                Promise.resolve(refused('The app is busy right now.'))
        })
        const f = refusedApply(await busy.apply(id, true))
        expect(f.stage).toBe('blocked')
        expect(f.message).toMatch(/busy/)
        expect(r.userFiles()).toEqual(before)
    })

    it('when the safety copy cannot be made: no user file is changed', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        const before = r.userFiles()
        // make the pre-restore area unwritable by putting a FILE where its folder must be
        mkdirSync(join(r.dir, 'userData', 'backups'), { recursive: true })
        writeFileSync(r.preRoot, 'not a folder')
        const f = refusedApply(await r.restore.apply(id, true))
        expect(f.stage).toBe('snapshot-failed')
        expect(f.filesState).toBe('untouched')
        expect(r.userFiles()).toEqual(before)
        expect(existsSync(r.journalPath)).toBe(false)
    })
})

describe('a file that cannot be written: the app puts the files back by itself', () => {
    it('the second file fails: the first one is put back and the app says so', async () => {
        const disk = userWrites((n) => (n === 2 ? Promise.reject(errno('ENOSPC')) : undefined))
        const r = rig({ restoreFs: disk.fs })
        const { id } = await backupThenChange(r)
        const stateB = r.userFiles()
        const f = refusedApply(await r.restore.apply(id, true))
        expect(f.stage).toBe('write-failed')
        expect(f.filesState).toBe('rolled-back')
        expect(f.message).toMatch(/put back/)
        expect(f.fix.length).toBeGreaterThan(10)
        expect(r.userFiles()).toEqual(stateB)
        expect(readdirSync(r.engineRoot)).toEqual(['config.json'])
        // the record ends as "undone": nothing more to do
        const h = await r.restore.history()
        expect(h.status).toBe('undone')
        expect(h.canUndo).toBe(false)
    })

    it('a file that reads back different from the backup is a failed write: rolled back', async () => {
        // the first write puts wrong bytes on the disk (a bad sector, a program that touched the file)
        const disk = userWrites((n, _path, data) =>
            n === 1 ? Buffer.concat([data, Buffer.from('x')]) : undefined
        )
        const r = rig({ restoreFs: disk.fs })
        const { id } = await backupThenChange(r)
        const stateB = r.userFiles()
        const f = refusedApply(await r.restore.apply(id, true))
        expect(f.stage).toBe('write-failed')
        expect(f.filesState).toBe('rolled-back')
        expect(f.message).toMatch(/not written correctly/)
        expect(r.userFiles()).toEqual(stateB)
    })

    it('the put-back fails too: the state is "interrupted", and Undo finishes the job', async () => {
        let broken = true
        const disk = userWrites((n) => (broken && n >= 2 ? Promise.reject(errno('EIO')) : undefined))
        const r = rig({ restoreFs: disk.fs })
        const { id, stateA } = await backupThenChange(r)
        const stateB = r.userFiles()
        const f = refusedApply(await r.restore.apply(id, true))
        expect(f.stage).toBe('write-failed')
        expect(f.filesState).toBe('needs-undo')
        // the config was restored, the accounts were not: a mixed state, exactly what the message warns about
        expect(r.hash(r.configPath)).toBe(stateA.config)
        expect(r.hash(r.accountsPath)).toBe(stateB.accounts)
        const h = await r.restore.history()
        expect(h.status).toBe('interrupted')
        expect(h.canUndo).toBe(true)
        // a new restore is refused until the old one is undone
        const again = refusedApply(await r.restore.apply(id, true))
        expect(again.stage).toBe('interrupted-earlier')
        expect(again.filesState).toBe('untouched')
        // the disk works again: Undo puts everything back
        broken = false
        undone(await r.restore.undo(true))
        expect(r.userFiles()).toEqual(stateB)
        expect((await r.restore.history()).status).toBe('undone')
    })
})

describe('an interrupted restore (the app is cut short in the middle)', () => {
    it('is found again after a restart and Undo puts every file back', async () => {
        // the 2nd write never finishes: this is the power cut
        const disk = userWrites((n) => (n === 2 ? hang() : undefined))
        const r = rig({ restoreFs: disk.fs })
        const { id, stateA } = await backupThenChange(r)
        const stateB = r.userFiles()
        void r.restore.apply(id, true)
        await waitFor(() => disk.count() >= 2)
        // the disk now holds a mixed state: config restored, accounts not
        expect(r.hash(r.configPath)).toBe(stateA.config)
        expect(r.hash(r.accountsPath)).toBe(stateB.accounts)
        expect(existsSync(r.journalPath)).toBe(true)

        // "restart": a brand-new service over the same folders, with a disk that works
        const restarted = r.build({ fs: { writeFileAtomic: realRestoreFs.writeFileAtomic } })
        const h = await restarted.history()
        expect(h.status).toBe('interrupted')
        expect(h.canUndo).toBe(true)
        expect(h.message.length).toBeGreaterThan(20)
        expect(refusedApply(await restarted.apply(id, true)).stage).toBe('interrupted-earlier')
        expect(r.hash(r.configPath)).toBe(stateA.config)

        const res = undone(await restarted.undo(true))
        expect(res.files.length).toBe(2)
        expect(r.userFiles()).toEqual(stateB)
        expect((await restarted.history()).status).toBe('undone')
        // and now a new restore is possible again
        applied(await restarted.apply(id, true))
        expect(r.hash(r.configPath)).toBe(stateA.config)
        expect(r.hash(r.accountsPath)).toBe(stateA.accounts)
    })

    it('a cut before the first file leaves everything as it was and Undo is still safe', async () => {
        const disk = userWrites((n) => (n === 1 ? hang() : undefined))
        const r = rig({ restoreFs: disk.fs })
        const { id } = await backupThenChange(r)
        const stateB = r.userFiles()
        void r.restore.apply(id, true)
        await waitFor(() => disk.count() >= 1)
        expect(r.userFiles()).toEqual(stateB)
        const restarted = r.build({ fs: { writeFileAtomic: realRestoreFs.writeFileAtomic } })
        expect((await restarted.history()).status).toBe('interrupted')
        undone(await restarted.undo(true))
        expect(r.userFiles()).toEqual(stateB)
    })

    it('an interrupted undo is shown as such, and running Undo again finishes it', async () => {
        const r = rig()
        const { id, stateA } = await backupThenChange(r)
        const stateB = r.userFiles()
        applied(await r.restore.apply(id, true))
        const disk = userWrites((n) => (n === 2 ? hang() : undefined))
        const cut = r.build({ fs: disk.fs })
        void cut.undo(true)
        await waitFor(() => disk.count() >= 2)
        const restarted = r.build()
        const h = await restarted.history()
        expect(h.status).toBe('undo-interrupted')
        expect(h.canUndo).toBe(true)
        // restored state A is partly undone now: config is back to B, accounts still A
        expect(r.hash(r.configPath)).toBe(stateB.config)
        expect(r.hash(r.accountsPath)).toBe(stateA.accounts)
        undone(await restarted.undo(true))
        expect(r.userFiles()).toEqual(stateB)
    })
})

describe('undo', () => {
    it('puts every file back as it was before the restore', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        const stateB = r.userFiles()
        applied(await r.restore.apply(id, true))
        const res = undone(await r.restore.undo(true))
        expect(res.files.every((f) => f.action === 'put-back')).toBe(true)
        expect(r.userFiles()).toEqual(stateB)
        expect((await r.restore.history()).status).toBe('undone')
    })

    it('keeps even the changes made after the restore: they are in a new safety copy', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        applied(await r.restore.apply(id, true))
        // the user keeps working after the restore
        writeFileSync(r.configPath, CONFIG_C)
        writeFileSync(r.accountsPath, ACCOUNTS_C)
        const res = undone(await r.restore.undo(true))
        expect(res.safetyCopyId).not.toBeNull()
        const loaded = await r.snapshots.loadVerified(res.safetyCopyId as string)
        expect(loaded.kind).toBe('checked')
        if (loaded.kind === 'checked') {
            expect(sha(loaded.files.get('engine-config') as Buffer)).toBe(sha(CONFIG_C))
            expect(sha(loaded.files.get('accounts') as Buffer)).toBe(sha(ACCOUNTS_C))
        }
        expect(r.hash(r.configPath)).toBe(sha(CONFIG_B))
    })

    it('with nothing to undo it says so and changes nothing', async () => {
        const r = rig()
        const before = r.userFiles()
        const f = refusedUndo(await r.restore.undo(true))
        expect(f.stage).toBe('nothing-to-undo')
        expect(f.filesState).toBe('untouched')
        expect(r.userFiles()).toEqual(before)
        const h = await r.restore.history()
        expect(h.status).toBe('none')
        expect(h.canUndo).toBe(false)
    })

    it('a second undo of the same restore is refused', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        applied(await r.restore.apply(id, true))
        undone(await r.restore.undo(true))
        const after = r.userFiles()
        const f = refusedUndo(await r.restore.undo(true))
        expect(f.stage).toBe('nothing-to-undo')
        expect(r.userFiles()).toEqual(after)
    })

    it('is refused while a run is active', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        applied(await r.restore.apply(id, true))
        const after = r.userFiles()
        r.state.runBlock = 'A run is active.'
        const h = await r.restore.history()
        expect(h.canUndo).toBe(false)
        expect(h.undoBlockedReason).toMatch(/run is active/i)
        const f = refusedUndo(await r.restore.undo(true))
        expect(f.stage).toBe('blocked')
        expect(r.userFiles()).toEqual(after)
    })

    it('is refused when another accounts file was chosen after the restore', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        applied(await r.restore.apply(id, true))
        writeFileSync(r.otherAccountsPath, ACCOUNTS_C)
        r.state.accountsPlace = r.otherAccountsPath
        const after = r.userFiles()
        const other = r.hash(r.otherAccountsPath)
        const h = await r.restore.history()
        expect(h.canUndo).toBe(false)
        expect(h.undoBlockedReason).toMatch(/another accounts file/i)
        const f = refusedUndo(await r.restore.undo(true))
        expect(f.stage).toBe('blocked')
        expect(f.filesState).toBe('untouched')
        expect(r.userFiles()).toEqual(after)
        expect(r.hash(r.otherAccountsPath)).toBe(other)
    })

    it('is refused, with nothing changed, when the safety copy from before the restore was damaged', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        const res = applied(await r.restore.apply(id, true))
        if (res.snapshot.status !== 'created') throw new Error('test setup: no safety copy')
        const folder = join(r.preRoot, res.snapshot.id)
        const victim = readdirSync(folder).find((n) => n !== 'manifest.json') as string
        writeFileSync(join(folder, victim), 'tampered')
        const after = r.userFiles()
        const f = refusedUndo(await r.restore.undo(true))
        expect(f.stage).toBe('blocked')
        expect(f.filesState).toBe('untouched')
        expect(r.userFiles()).toEqual(after)
    })

    it('a failing disk during undo says the files may be partly put back, and trying again works', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        const stateB = r.userFiles()
        applied(await r.restore.apply(id, true))
        let broken = true
        const flaky = r.build({
            fs: {
                async writeFileAtomic(path: string, data: Buffer) {
                    if (broken && path === r.accountsPath) throw errno('EACCES')
                    return realRestoreFs.writeFileAtomic(path, data)
                }
            }
        })
        const f = refusedUndo(await flaky.undo(true))
        expect(f.stage).toBe('write-failed')
        expect(f.filesState).toBe('needs-undo')
        expect((await flaky.history()).status).toBe('undo-interrupted')
        broken = false
        undone(await flaky.undo(true))
        expect(r.userFiles()).toEqual(stateB)
    })
})

describe('the full round trip', () => {
    it('backup -> change -> restore -> undo -> restore again loses no data', async () => {
        const r = rig()
        const stateA = r.userFiles()
        const id = await backupNow(r)

        // change: new config, new accounts, new theme
        writeFileSync(r.configPath, CONFIG_B)
        writeFileSync(r.accountsPath, ACCOUNTS_B)
        writeFileSync(r.settingsPath, settingsText(r.accountsPath, 'light'))
        const stateB = r.userFiles()
        expect(stateB).not.toEqual(stateA)

        // restore: config and accounts are byte for byte state A again
        applied(await r.restore.apply(id, true))
        expect(r.hash(r.configPath)).toBe(stateA.config)
        expect(r.hash(r.accountsPath)).toBe(stateA.accounts)
        expect((JSON.parse(readFileSync(r.settingsPath, 'utf8')) as { themeMode: string }).themeMode).toBe(
            'dark'
        )

        // undo: every file is byte for byte state B again
        undone(await r.restore.undo(true))
        expect(r.userFiles()).toEqual(stateB)

        // restore again from the same backup: works, and equals state A again
        applied(await r.restore.apply(id, true))
        expect(r.hash(r.configPath)).toBe(stateA.config)
        expect(r.hash(r.accountsPath)).toBe(stateA.accounts)

        // the backup itself was never changed by any of this
        const again = await r.backups.inspect(id)
        expect(again.ok && again.detail.verification.status === 'ok').toBe(true)
    })

    it('the restored accounts file still holds every account (nothing lost on the way)', async () => {
        const r = rig()
        const id = await backupNow(r)
        writeFileSync(r.accountsPath, ACCOUNTS_B)
        applied(await r.restore.apply(id, true))
        const text = readFileSync(r.accountsPath, 'utf8')
        expect(text).toBe(ACCOUNTS_A)
        expect(text).toMatch(/ACCOUNT_2_EMAIL=beta@example.com/)
        expect(text).toMatch(/ACCOUNT_1_TOTP_SECRET=/)
    })
})

describe('the record of the last restore', () => {
    it('a damaged record is reported; Undo is refused; a new restore still works and sets it aside', async () => {
        const r = rig()
        const { id, stateA } = await backupThenChange(r)
        mkdirSync(join(r.dir, 'userData', 'backups'), { recursive: true })
        writeFileSync(r.journalPath, '{ this is not json')
        const h = await r.restore.history()
        expect(h.status).toBe('record-damaged')
        expect(h.canUndo).toBe(false)
        const before = r.userFiles()
        expect(refusedUndo(await r.restore.undo(true)).stage).toBe('nothing-to-undo')
        expect(r.userFiles()).toEqual(before)
        const res = applied(await r.restore.apply(id, true))
        expect(res.notes.join(' ')).toMatch(/damaged/)
        expect(r.hash(r.configPath)).toBe(stateA.config)
        expect((await r.restore.history()).status).toBe('undo-available')
    })

    it('a record that was changed by hand to point at a file outside the three is not trusted', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        applied(await r.restore.apply(id, true))
        const journal = JSON.parse(readFileSync(r.journalPath, 'utf8')) as {
            files: Array<{ role: string }>
        }
        journal.files[0] = { ...(journal.files[0] as { role: string }), role: '../../evil' }
        writeFileSync(r.journalPath, JSON.stringify(journal))
        const after = r.userFiles()
        expect((await r.restore.history()).status).toBe('record-damaged')
        refusedUndo(await r.restore.undo(true))
        expect(r.userFiles()).toEqual(after)
    })
})

describe('the app is told to read the files again', () => {
    it('after a restore and after an undo, inside the lock; its remark reaches the user', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        let locked = 0
        let reread = 0
        const svc = r.build({
            exclusive: async <T>(work: () => Promise<T>): Promise<T> => {
                locked++
                return work()
            },
            afterFilesChanged: () => {
                reread++
                return Promise.resolve('The engine was restarted on the restored files.')
            }
        })
        const a = applied(await svc.apply(id, true))
        expect(a.notes).toContain('The engine was restarted on the restored files.')
        const u = undone(await svc.undo(true))
        expect(u.notes).toContain('The engine was restarted on the restored files.')
        expect(locked).toBe(2)
        expect(reread).toBe(2)
    })

    it('a hook that throws does not break a finished restore', async () => {
        const r = rig()
        const { id, stateA } = await backupThenChange(r)
        const svc = r.build({
            afterFilesChanged: () => Promise.reject(new Error('boom'))
        })
        const a = applied(await svc.apply(id, true))
        expect(a.notes.join(' ')).toMatch(/START\.bat/)
        expect(r.hash(r.configPath)).toBe(stateA.config)
    })
})

describe('secrets never leave the main process', () => {
    it('no result, no record and no log line holds a password, a TOTP secret or a webhook address', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        const results: unknown[] = []
        results.push(await r.restore.apply(id, false))
        results.push(await r.restore.apply(id, true))
        results.push(await r.restore.history())
        results.push(await r.restore.undo(true))
        results.push(await r.restore.history())
        const dump = JSON.stringify(results) + (await r.logText())
        for (const secret of [
            FAKE_PASSWORD,
            FAKE_TOTP,
            FAKE.discordUrl,
            'alpha@example.com',
            'gamma@example.com'
        ]) {
            expect(dump.includes(secret)).toBe(false)
        }
        // the record holds checksums and names only
        const record = readFileSync(r.journalPath, 'utf8')
        for (const secret of [FAKE_PASSWORD, FAKE_TOTP, FAKE.discordUrl, 'alpha@example.com']) {
            expect(record.includes(secret)).toBe(false)
        }
    })

    it('the audit log says what happened, with the backup name and counts', async () => {
        const r = rig()
        const { id } = await backupThenChange(r)
        applied(await r.restore.apply(id, true))
        undone(await r.restore.undo(true))
        const text = await r.logText()
        expect(text).toMatch(/restore-apply/)
        expect(text).toMatch(/restore-undo/)
        expect(text).toMatch(/applied/)
        expect(text).toMatch(/undone/)
    })
})
