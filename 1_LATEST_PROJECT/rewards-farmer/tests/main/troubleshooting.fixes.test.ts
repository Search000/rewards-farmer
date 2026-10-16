// @vitest-environment node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/main/engine/apiClient'
import type { EngineApi } from '../../src/main/engine/apiClient'
import { EngineSettingsService } from '../../src/main/engineSettings'
import { HealthService } from '../../src/main/healthService'
import type { CommandResult, HealthDeps, RunCommand } from '../../src/main/healthService'
import type { HealthCheck, HealthCheckId } from '../../src/shared/health-types'
import { findSection, parseGuide } from '../../src/shared/troubleshooting-rules'
import { makeHarness, REPO_ROOT, waitFor } from './helpers'
import type { Harness } from './helpers'

// Phase 15: every fix in docs/troubleshooting.md is tried here. "real" tests use the real app services and the real engine API
// (only the bot is a fixture); "stand-in" tests replace one machine fact (Node, Git, disk, network) and say so in the guide.

const GUIDE = parseGuide(readFileSync(join(REPO_ROOT, 'docs', 'troubleshooting.md'), 'utf8'))
const REAL_ENGINE = join(REPO_ROOT, 'engine')
const seen = new Set<string>()
const dirs: string[] = []
const harnesses: Harness[] = []
afterEach(async () => {
    while (harnesses.length > 0) await harnesses.pop()?.cleanup()
    while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true })
})

function msg(check: HealthCheck, section: string, fragment: string, status?: HealthCheck['status']): void {
    expect(check.detail, `${check.id}: ${fragment}`).toContain(fragment)
    if (status !== undefined) expect(check.status).toBe(status)
    expect(findSection(GUIDE, section)?.see, `guide section ${section}`).toContain(fragment)
    seen.add(`${section}|${fragment}`)
}

function tmp(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix))
    dirs.push(d)
    return d
}

function fakeEngine(): string {
    const root = join(tmp('rf-ts-'), 'engine')
    mkdirSync(join(root, 'scripts', 'api'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'api', 'server.js'), '// stand-in')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'engine', version: '4.3.2' }))
    cpSync(join(REAL_ENGINE, 'config.example.json'), join(root, 'config.example.json'))
    cpSync(join(REAL_ENGINE, 'config.example.json'), join(root, 'config.json'))
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    writeFileSync(join(root, 'node_modules', '.package-lock.json'), '{}')
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'dist', 'index.js'), '// built')
    return root
}

const okRun =
    (node = 'v24.21.0'): RunCommand =>
    (cmd) =>
        Promise.resolve<CommandResult>(
            cmd === 'git' ? { ok: true, stdout: 'git version 2.45.1\n' } : { ok: true, stdout: `${node}\n` }
        )
const fakeApi = (o: { health?: () => Promise<unknown>; config?: () => Promise<unknown> } = {}): EngineApi =>
    ({
        health: o.health ?? (() => Promise.resolve({ ok: true, version: '4.3.2', state: 'idle' })),
        config: o.config ?? (() => Promise.resolve({ config: { a: 1 } }))
    }) as unknown as EngineApi

function stand(root: string, o: Partial<HealthDeps> = {}): HealthService {
    return new HealthService({
        engineRoot: root,
        dataDir: dirname(root),
        appInfo: () => ({ name: 'Rewards Farmer LUCK', version: '0.0.1', electron: '44', platform: 'win32' }),
        accounts: () => ({ status: 'ok', error: null, count: 2 }),
        engine: () => ({ link: 'ready', detail: null, version: '4.3.2' }),
        api: () => fakeApi(),
        redact: (t) => t,
        runCommand: okRun(),
        diskProbe: () => Promise.resolve({ freeBytes: 5e10 }),
        networkProbe: () => Promise.resolve({ ok: true }),
        ...o
    })
}
async function row(s: HealthService, id: HealthCheckId): Promise<HealthCheck> {
    const c = (await s.runChecks()).checks.find((x) => x.id === id)
    if (c === undefined) throw new Error(`no row ${id}`)
    return c
}

// ---- real-engine rig -----------------------------------------------------------------------------------------------------
function localOnly(h: Harness): void {
    for (const f of ['config.json', 'config.example.json']) {
        const p = join(h.fx.engineRoot, f)
        const cfg = JSON.parse(readFileSync(p, 'utf8')) as { searchSettings: Record<string, unknown> }
        cfg.searchSettings.queryEngines = ['local']
        writeFileSync(p, JSON.stringify(cfg, null, 2))
    }
}
interface Rig {
    readonly h: Harness
    readonly health: HealthService
    readonly settings: EngineSettingsService
    readonly cfg: string
}
async function rig(start = true): Promise<Rig> {
    const h = makeHarness()
    harnesses.push(h)
    localOnly(h)
    const health = new HealthService({
        engineRoot: h.fx.engineRoot,
        dataDir: dirname(h.fx.engineRoot),
        networkProbe: () => Promise.resolve({ ok: true }),
        diskProbe: () => Promise.resolve({ freeBytes: 5e10 }),
        appInfo: () => ({ name: 'x', version: '0.0.1', electron: '44', platform: 'win32' }),
        accounts: () => h.farmer.getState().accounts,
        engine: () => h.supervisor.snapshot(),
        api: () => h.farmer.engineApi(),
        redact: (t) => h.redactor.redact(t),
        nodeCommand: process.execPath
    })
    const settings = new EngineSettingsService({
        host: {
            api: () => h.farmer.engineApi(),
            editBlock: () => h.farmer.settingsEditBlock(),
            run: (w) => h.farmer.editEngineConfig(w)
        },
        engineRoot: h.fx.engineRoot,
        audit: h.audit,
        appLog: h.appLog,
        backupDir: join(h.fx.userData, 'backups', 'config')
    })
    await h.farmer.init()
    if (start) {
        await h.farmer.pickAccounts()
        await waitFor(
            () => h.supervisor.snapshot().link,
            (v) => v === 'ready',
            'engine ready',
            30000
        )
    }
    return { h, health, settings, cfg: join(h.fx.engineRoot, 'config.json') }
}
const readCfg = (r: Rig): Record<string, Record<string, unknown>> =>
    JSON.parse(readFileSync(r.cfg, 'utf8')) as Record<string, Record<string, unknown>>

describe('guide fixes: runtime and engine files', () => {
    it('[node] not found, broken and too old: each shows its guide message; after Node 24 is available the row is ok', async () => {
        const root = fakeEngine()
        const run =
            (r: CommandResult): RunCommand =>
            (cmd) =>
                cmd === 'git' ? okRun()(cmd, []) : Promise.resolve(r)
        msg(
            await row(stand(root, { runCommand: run({ ok: false, reason: 'not-found' }) }), 'node'),
            'node',
            'Node.js was not found on this computer.',
            'error'
        )
        msg(
            await row(stand(root, { runCommand: run({ ok: false, reason: 'failed' }) }), 'node'),
            'node',
            'Node.js was found but it could not run.',
            'error'
        )
        msg(
            await row(stand(root, { runCommand: okRun('v22.22.2') }), 'node'),
            'node',
            'is too old. The engine needs 24 or newer.',
            'error'
        )
        expect((await row(stand(root, { runCommand: okRun('v24.21.0') }), 'node')).status).toBe('ok')
    })

    it('[git] not found: warning when the engine is there, error when it is not; after installing Git the row is ok', async () => {
        const root = fakeEngine()
        const noGit: RunCommand = (cmd) =>
            cmd === 'git' ? Promise.resolve({ ok: false, reason: 'not-found' }) : okRun()(cmd, [])
        const brokenGit: RunCommand = (cmd) =>
            cmd === 'git' ? Promise.resolve({ ok: false, reason: 'failed' }) : okRun()(cmd, [])
        msg(
            await row(stand(root, { runCommand: noGit }), 'git'),
            'git',
            'Git was not found on this computer.',
            'warning'
        )
        msg(
            await row(stand(root, { runCommand: brokenGit }), 'git'),
            'git',
            'Git was found but it could not run.',
            'warning'
        )
        rmSync(join(root, 'scripts'), { recursive: true })
        expect((await row(stand(root, { runCommand: noGit }), 'git')).status).toBe('error')
        cpSync(join(REAL_ENGINE, 'scripts'), join(root, 'scripts'), { recursive: true })
        expect((await row(stand(root), 'git')).status).toBe('ok')
    })

    it('[engine-files] missing: error message; after the files are restored the row is ok', async () => {
        const root = fakeEngine()
        rmSync(join(root, 'scripts'), { recursive: true })
        msg(
            await row(stand(root), 'engine-files'),
            'engine-files',
            'The engine folder is missing or incomplete.',
            'error'
        )
        mkdirSync(join(root, 'scripts', 'api'), { recursive: true })
        writeFileSync(join(root, 'scripts', 'api', 'server.js'), '// restored')
        expect((await row(stand(root), 'engine-files')).status).toBe('ok')
    })

    it('[engine-packages] missing marker: error message; after the install marker exists the row is ok', async () => {
        const root = fakeEngine()
        rmSync(join(root, 'node_modules'), { recursive: true })
        msg(
            await row(stand(root), 'engine-packages'),
            'engine-packages',
            'The engine packages are not installed (or the install did not finish).',
            'error'
        )
        mkdirSync(join(root, 'node_modules'))
        writeFileSync(join(root, 'node_modules', '.package-lock.json'), '{}')
        expect((await row(stand(root), 'engine-packages')).status).toBe('ok')
    })

    it('[engine-built] no dist: error message; after the build output exists the row is ok', async () => {
        const root = fakeEngine()
        rmSync(join(root, 'dist'), { recursive: true })
        msg(await row(stand(root), 'engine-built'), 'engine-built', 'The engine is not built yet.', 'error')
        mkdirSync(join(root, 'dist'))
        writeFileSync(join(root, 'dist', 'index.js'), '// built')
        expect((await row(stand(root), 'engine-built')).status).toBe('ok')
    })
})

describe('guide fixes: config.json (real app code, real engine)', () => {
    it('[config-file] deleted: Create config on Home really fixes it', async () => {
        const r = await rig()
        rmSync(r.cfg)
        expect(r.h.farmer.getState().notices.some((n) => n.action === 'create-config')).toBe(true)
        msg(await row(r.health, 'config-file'), 'config-file', 'config.json does not exist yet.', 'error')
        expect(await r.h.farmer.createConfig()).toMatchObject({ ok: true })
        for (const id of ['config-file', 'config-valid', 'engine-config'] as const)
            expect((await row(r.health, id)).status).toBe('ok')
    })

    it('[config-valid] broken file: the OLD advice (Reset to defaults) really fails; renaming the file and Create config really fixes it', async () => {
        const r = await rig()
        writeFileSync(r.cfg, '{ this is not json')
        const bad = await row(r.health, 'config-valid')
        msg(bad, 'config-valid', 'config.json is not valid JSON.', 'error')
        expect(bad.fix).toContain('config.broken.json')
        expect((await r.settings.getState()).editDisabledReason).not.toBeNull()
        expect(await r.settings.reset()).toMatchObject({ ok: false })
        expect((await row(r.health, 'config-valid')).status).toBe('error')
        renameSync(r.cfg, join(r.h.fx.engineRoot, 'config.broken.json'))
        expect(await r.h.farmer.createConfig()).toMatchObject({ ok: true })
        expect((await row(r.health, 'config-valid')).status).toBe('ok')
        expect((await row(r.health, 'engine-config')).status).toBe('ok')
        expect(readFileSync(join(r.h.fx.engineRoot, 'config.broken.json'), 'utf8')).toBe('{ this is not json')
    })

    it('[config-valid] wrong value: Reset really fails; correcting the value really fixes it; rename and Create config also fixes it', async () => {
        const r = await rig()
        const cfg = readCfg(r)
        const good = JSON.parse(readFileSync(r.cfg, 'utf8')) as Record<string, unknown>
        Object.assign(cfg, { headless: 'yes' })
        writeFileSync(r.cfg, JSON.stringify(cfg))
        msg(
            await row(r.health, 'config-valid'),
            'config-valid',
            'must be true or false in config.json.',
            'error'
        )
        expect(await r.settings.reset()).toMatchObject({ ok: false })
        writeFileSync(r.cfg, JSON.stringify(good))
        expect((await row(r.health, 'config-valid')).status).toBe('ok')
        writeFileSync(r.cfg, JSON.stringify({ ...good, headless: 'yes' }))
        renameSync(r.cfg, join(r.h.fx.engineRoot, 'config.broken.json'))
        await r.h.farmer.createConfig()
        expect((await row(r.health, 'config-valid')).status).toBe('ok')
    })

    it('[config-valid] Repair config.json: a broken file is fixed for real and a copy is kept; a wrong value is reset and the other settings are kept', async () => {
        const r = await rig()
        const copy = join(r.h.fx.engineRoot, 'config.broken.json')
        writeFileSync(r.cfg, '{ this is not json')
        expect((await row(r.health, 'config-valid')).status).toBe('error')
        const fixed = await r.h.farmer.repairConfig()
        expect(fixed.ok).toBe(true)
        expect(fixed.message).toContain('config.broken.json')
        expect(readFileSync(copy, 'utf8')).toBe('{ this is not json')
        expect((await row(r.health, 'config-valid')).status).toBe('ok')
        expect((await row(r.health, 'engine-config')).status).toBe('ok')

        // a wrong value next to a real change of the user
        const cfg = readCfg(r)
        const workers = cfg.workers as Record<string, unknown>
        const flag = Object.keys(workers).find((k) => typeof workers[k] === 'boolean') as string
        workers[flag] = !(workers[flag] as boolean)
        Object.assign(cfg, { headless: 'yes' })
        writeFileSync(r.cfg, JSON.stringify(cfg))
        expect((await row(r.health, 'config-valid')).status).toBe('error')
        const second = await r.h.farmer.repairConfig()
        expect(second.ok).toBe(true)
        expect(second.message).toContain('config.broken-2.json')
        const after = readCfg(r)
        expect(after.headless).not.toBe('yes')
        expect((after.workers as Record<string, unknown>)[flag]).toBe(workers[flag])
        expect((await row(r.health, 'config-valid')).status).toBe('ok')
    })

    it('[config-valid] missing setting: Save alone does not write it; changing that setting does', async () => {
        const r = await rig()
        const cfg = readCfg(r)
        delete (cfg.workers as Record<string, unknown>).doReadToEarn
        writeFileSync(r.cfg, JSON.stringify(cfg))
        msg(
            await row(r.health, 'config-valid'),
            'config-valid',
            'is valid JSON but 1 setting is missing.',
            'warning'
        )
        const v = (await r.settings.getState()).values
        if (v === null) throw new Error('no values')
        expect(await r.settings.save(v)).toMatchObject({ ok: true })
        expect(readCfg(r).workers?.doReadToEarn).toBeUndefined()
        expect((await row(r.health, 'config-valid')).status).toBe('warning')
        expect(await r.settings.save({ ...v, readToEarn: !v.readToEarn })).toMatchObject({ ok: true })
        expect(readCfg(r).workers?.doReadToEarn).toBeDefined()
        expect((await row(r.health, 'config-valid')).status).toBe('ok')
    })

    it('[config-valid] too big file and unreadable file show their guide messages', async () => {
        const root = fakeEngine()
        writeFileSync(join(root, 'config.json'), ' '.repeat(1_100_000))
        msg(
            await row(stand(root), 'config-valid'),
            'config-valid',
            'config.json is much larger than a real config (over 1 MB).',
            'error'
        )
        rmSync(join(root, 'config.json'))
        mkdirSync(join(root, 'config.json'))
        msg(
            await row(stand(root), 'config-valid'),
            'config-valid',
            'config.json could not be read (',
            'error'
        )
    })

    it('[engine-config] cannot find or rejects: real engine says so; Create config and rename fix it', async () => {
        const r = await rig()
        rmSync(r.cfg)
        msg(
            await row(r.health, 'engine-config'),
            'engine-config',
            'The engine cannot find config.json.',
            'error'
        )
        await r.h.farmer.createConfig()
        expect((await row(r.health, 'engine-config')).status).toBe('ok')
        writeFileSync(r.cfg, '{ not json')
        msg(
            await row(r.health, 'engine-config'),
            'engine-config',
            'The engine could not give its config:',
            'error'
        )
        renameSync(r.cfg, join(r.h.fx.engineRoot, 'config.broken.json'))
        await r.h.farmer.createConfig()
        expect((await row(r.health, 'engine-config')).status).toBe('ok')
        // stand-in messages (the real engine did not produce these two)
        const root = fakeEngine()
        const rej = stand(root, {
            api: () =>
                fakeApi({ config: () => Promise.reject(new AppError('CONFIG_INVALID', 'bad field', 422)) })
        })
        msg(await row(rej, 'engine-config'), 'engine-config', 'The engine rejects config.json:', 'error')
        const none = stand(root, { api: () => fakeApi({ config: () => Promise.resolve({}) }) })
        msg(
            await row(none, 'engine-config'),
            'engine-config',
            'The engine answered, but without any configuration.',
            'error'
        )
    })
})

describe('guide fixes: accounts and engine (real engine)', () => {
    it('[accounts-file] broken saved file: error; choosing a good file really fixes it', async () => {
        const r = await rig(false)
        r.h.picked = null
        await r.h.farmer.pickAccounts()
        msg(
            await row(r.health, 'accounts-file'),
            'accounts-file',
            'No accounts file is chosen yet.',
            'warning'
        )
        const bad = join(r.h.fx.dir, 'bad.env')
        writeFileSync(bad, 'not an accounts file\n')
        await r.h.settings.update({ accountsPath: bad })
        await r.h.farmer.init()
        msg(
            await row(r.health, 'accounts-file'),
            'accounts-file',
            'The accounts file has a problem:',
            'error'
        )
        r.h.picked = r.h.fx.accountsFile
        expect((await r.h.farmer.pickAccounts()).result.ok).toBe(true)
        expect((await row(r.health, 'accounts-file')).status).toBe('ok')
        // stand-in: a file with no account cannot be chosen, so this message is reached only by a stand-in
        const s = stand(fakeEngine(), { accounts: () => ({ status: 'ok', error: null, count: 0 }) })
        msg(
            await row(s, 'accounts-file'),
            'accounts-file',
            'The accounts file has no accounts in it.',
            'warning'
        )
    })

    it('[engine-process] stopped engine: warning; Restart engine really brings it back', async () => {
        const r = await rig(false)
        msg(
            await row(r.health, 'engine-process'),
            'engine-process',
            'The engine has not been started yet. It starts after an accounts file is chosen.',
            'warning'
        )
        await r.h.farmer.pickAccounts()
        await waitFor(
            () => r.h.supervisor.snapshot().link,
            (v) => v === 'ready',
            'ready',
            30000
        )
        expect((await row(r.health, 'engine-process')).status).toBe('ok')
        await r.h.supervisor.stop()
        expect((await row(r.health, 'engine-process')).status).toBe('warning')
        expect(await r.h.farmer.restartEngine()).toMatchObject({ ok: true })
        expect((await row(r.health, 'engine-process')).status).toBe('ok')
        // stand-in messages
        const root = fakeEngine()
        const link = (l: 'starting' | 'failed' | 'down') =>
            stand(root, { engine: () => ({ link: l, detail: null, version: null }) })
        msg(
            await row(link('starting'), 'engine-process'),
            'engine-process',
            'The engine process is starting.',
            'warning'
        )
        msg(
            await row(link('failed'), 'engine-process'),
            'engine-process',
            'The engine could not start',
            'error'
        )
        msg(
            await row(link('down'), 'engine-process'),
            'engine-process',
            'The engine process stopped or crashed',
            'error'
        )
    })

    it('[engine-api] answers badly: refused call, failed call and not healthy show their messages; after a good answer the row is ok', async () => {
        const root = fakeEngine()
        const api = (h: () => Promise<unknown>) => stand(root, { api: () => fakeApi({ health: h }) })
        msg(
            await row(
                api(() => Promise.reject(new AppError('AUTH', 'refused', 401))),
                'engine-api'
            ),
            'engine-api',
            'The engine API did not answer correctly:',
            'error'
        )
        msg(
            await row(
                api(() => Promise.reject(new Error('boom'))),
                'engine-api'
            ),
            'engine-api',
            'The engine API did not answer correctly:',
            'error'
        )
        msg(
            await row(
                api(() => Promise.resolve({ ok: false })),
                'engine-api'
            ),
            'engine-api',
            'The engine API answered, but it says it is not healthy.',
            'error'
        )
        expect((await row(stand(root), 'engine-api')).status).toBe('ok')
    })

    it('[engine-version] old engine still running: warning; Restart engine really fixes it', async () => {
        const r = await rig()
        const pk = join(r.h.fx.engineRoot, 'package.json')
        const pkg = JSON.parse(readFileSync(pk, 'utf8')) as { version: string }
        pkg.version = '9.9.9'
        writeFileSync(pk, JSON.stringify(pkg))
        msg(
            await row(r.health, 'engine-version'),
            'engine-version',
            'but the engine files on disk are version',
            'warning'
        )
        expect(await r.h.farmer.restartEngine()).toMatchObject({ ok: true })
        await waitFor(
            () => r.h.supervisor.snapshot().link,
            (v) => v === 'ready',
            'ready',
            30000
        )
        expect((await row(r.health, 'engine-version')).status).toBe('ok')
    })
})

describe('guide fixes: this computer', () => {
    it('[disk-space] low disk: warning and error messages; after space is freed the row is ok', async () => {
        const root = fakeEngine()
        const free = (n: number) => stand(root, { diskProbe: () => Promise.resolve({ freeBytes: n }) })
        msg(
            await row(free(100 * 1024 * 1024), 'disk-space'),
            'disk-space',
            'The disk is almost full:',
            'error'
        )
        msg(
            await row(free(500 * 1024 * 1024), 'disk-space'),
            'disk-space',
            'The disk is getting full:',
            'warning'
        )
        expect((await row(free(5e10), 'disk-space')).status).toBe('ok')
    })

    it('[folders] missing folder: error; creating the folder fixes it. Other error codes use stand-ins', async () => {
        const root = fakeEngine()
        const missing = join(tmp('rf-ts-'), 'no-such-folder')
        const dataSvc = (dataDir: string) => stand(root, { dataDir })
        msg(
            await row(dataSvc(missing), 'folder-data'),
            'folder-data',
            'The app data folder does not exist:',
            'error'
        )
        mkdirSync(missing)
        expect((await row(dataSvc(missing), 'folder-data')).status).toBe('ok')
        const code = (c: string) =>
            stand(root, { folderProbe: () => Promise.resolve({ ok: false, code: c }) })
        const leftover = stand(root, { folderProbe: () => Promise.resolve({ ok: true, leftover: true }) })
        for (const [id, name, section] of [
            ['folder-data', 'app data folder', 'folder-data'],
            ['folder-engine', 'engine folder', 'folder-engine']
        ] as const) {
            msg(await row(code('ENOENT'), id), section, `The ${name} does not exist:`, 'error')
            msg(
                await row(code('EACCES'), id),
                section,
                `This computer does not allow the app to write in the ${name}:`,
                'error'
            )
            msg(await row(code('EROFS'), id), section, `The ${name} is read-only:`, 'error')
            msg(
                await row(code('ENOSPC'), id),
                section,
                `The disk is full, so nothing can be written in the ${name}:`,
                'error'
            )
            msg(await row(code('EBUSY'), id), section, `The ${name} could not be used (`, 'error')
            msg(
                await row(leftover, id),
                section,
                'but a small test file could not be deleted again:',
                'warning'
            )
        }
        expect((await row(stand(root), 'folder-engine')).status).toBe('ok')
    })

    it('[network] offline and blocked: messages; after the network is back the row is ok', async () => {
        const root = fakeEngine()
        const net = (r: { ok: false; stage: 'dns' | 'connect'; code: string } | { ok: true }) =>
            stand(root, { networkProbe: () => Promise.resolve(r) })
        msg(
            await row(net({ ok: false, stage: 'dns', code: 'ENOTFOUND' }), 'network'),
            'network',
            'could not be looked up (',
            'error'
        )
        msg(
            await row(net({ ok: false, stage: 'connect', code: 'ECONNREFUSED' }), 'network'),
            'network',
            'was found, but a connection could not be opened (',
            'warning'
        )
        expect((await row(net({ ok: true }), 'network')).status).toBe('ok')
    })
})

describe('guide fixes: Unknown rows and launchers', () => {
    it('[unknown] rows: every unknown message in the guide is produced', async () => {
        const root = fakeEngine()
        const u = (c: HealthCheck, f: string) => msg(c, 'unknown', f, 'unknown')
        rmSync(join(root, 'scripts'), { recursive: true })
        u(
            await row(stand(root), 'config-valid'),
            'Not checked: the engine files are missing (see "Engine files").'
        )
        const root2 = fakeEngine()
        rmSync(join(root2, 'config.json'))
        u(
            await row(stand(root2), 'config-valid'),
            'Not checked: config.json does not exist (see "Engine config.json").'
        )
        u(
            await row(stand(root2, { api: () => null }), 'engine-api'),
            'Not checked: the engine is not running (see "Engine process").'
        )
        const dead = stand(root2, { api: () => fakeApi({ health: () => Promise.reject(new Error('x')) }) })
        u(await row(dead, 'engine-version'), 'Not checked: the engine API did not answer (see above).')
        const slow: RunCommand = (cmd) =>
            cmd === 'git' ? okRun()(cmd, []) : Promise.resolve({ ok: false, reason: 'timeout' })
        u(
            await row(stand(root2, { runCommand: slow }), 'node'),
            'did not answer in time, so its version is unknown.'
        )
        u(
            await row(
                stand(root2, { checkTimeoutMs: 50, diskProbe: () => new Promise(() => undefined) }),
                'disk-space'
            ),
            'did not finish in time.'
        )
        u(
            await row(
                stand(root2, {
                    appInfo: () => {
                        throw new Error('boom')
                    }
                }),
                'app'
            ),
            'The check itself failed ('
        )
        u(
            await row(stand(root2, { diskProbe: () => Promise.reject(new Error('x')) }), 'disk-space'),
            'The free disk space could not be read'
        )
        u(
            await row(stand(root2, { networkProbe: () => Promise.reject(new Error('x')) }), 'network'),
            'The internet check could not be run.'
        )
    })

    it('[launchers] the quoted launcher messages are really in START.bat', () => {
        const bat = readFileSync(join(REPO_ROOT, 'START.bat'), 'utf8')
        for (const id of ['launcher-incomplete-install', 'launcher-already-running'])
            for (const f of findSection(GUIDE, id)?.see ?? []) expect(bat).toContain(f)
    })

    it('every message quoted in the guide was produced by a real run above, and every VERIFIED line names a real test or evidence id', () => {
        const evidence = readFileSync(join(REPO_ROOT, 'reports', 'phase-15-evidence.txt'), 'utf8')
        const self = [__filename, join(__dirname, 'accountsAuto.test.ts')]
            .map((f) => readFileSync(f, 'utf8'))
            .join('\n')
        const missing: string[] = []
        for (const s of GUIDE) {
            if (s.id.startsWith('launcher-')) continue
            for (const f of s.see) if (!seen.has(`${s.id}|${f}`)) missing.push(`${s.id}: ${f}`)
        }
        expect(missing).toEqual([])
        for (const s of GUIDE) {
            expect(s.evidenceKind, s.id).not.toBeNull()
            expect(s.fixChecks.length, s.id).toBeGreaterThan(0)
            for (const f of s.fixChecks) {
                if (f.kind === 'verified-real' || f.kind === 'verified-stand-in') {
                    const m = /› "(.+?)"/.exec(f.note)
                    expect(m?.[1], `${s.id}: ${f.what}`).toBeDefined()
                    expect(self, `${s.id}: ${m?.[1] ?? ''}`).toContain(`it('${m?.[1] ?? '#'}`)
                }
                if (f.kind === 'verified-run') {
                    const e = /\bE\d\b/.exec(f.note)?.[0]
                    expect(e, `${s.id}: ${f.what}`).toBeDefined()
                    expect(evidence).toContain(`${e ?? '#'}`)
                }
            }
        }
    })
})
