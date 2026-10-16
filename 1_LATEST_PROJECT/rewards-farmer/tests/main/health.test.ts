// @vitest-environment node
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/main/engine/apiClient'
import type { EngineApi } from '../../src/main/engine/apiClient'
import { Redactor } from '../../src/main/engine/redact'
import { defaultRunCommand, HealthService } from '../../src/main/healthService'
import type {
    CommandResult,
    DiskProbe,
    HealthDeps,
    NetworkProbe,
    RunCommand
} from '../../src/main/healthService'
import type { EngineLink } from '../../src/shared/farmer-types'
import type { HealthCheck, HealthCheckId } from '../../src/shared/health-types'
import { REPO_ROOT } from './helpers'

// Phase 12: every row is a real check. These tests build REAL folders and run REAL commands where it matters; the engine API
// is a small stand-in object here (the real engine API is exercised in health.integration.test.ts).

const REAL_ENGINE = join(REPO_ROOT, 'engine')
const dirs: string[] = []
afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true })
})

interface Opts {
    readonly files?: boolean
    readonly packages?: boolean
    readonly built?: boolean
    readonly config?: string | false
    readonly version?: string
}

// A fake engine folder. config.json holds the real example unless the test gives its own text.
function engineDir(o: Opts = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'rf-health-'))
    dirs.push(dir)
    const root = join(dir, 'engine')
    mkdirSync(root, { recursive: true })
    cpSync(join(REAL_ENGINE, 'config.example.json'), join(root, 'config.example.json'))
    if (o.files !== false) {
        mkdirSync(join(root, 'scripts', 'api'), { recursive: true })
        writeFileSync(join(root, 'scripts', 'api', 'server.js'), '// stand-in')
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({ name: 'engine', version: o.version ?? '4.3.2' })
        )
    }
    if (o.packages !== false) {
        mkdirSync(join(root, 'node_modules'), { recursive: true })
        writeFileSync(join(root, 'node_modules', '.package-lock.json'), '{}')
    }
    if (o.built !== false) {
        mkdirSync(join(root, 'dist'), { recursive: true })
        writeFileSync(join(root, 'dist', 'index.js'), '// built')
    }
    if (o.config === undefined) cpSync(join(REAL_ENGINE, 'config.example.json'), join(root, 'config.json'))
    else if (o.config !== false) writeFileSync(join(root, 'config.json'), o.config)
    return root
}

// Isolated stand-ins: the tests never depend on this machine's disk or internet (Phase 13 tests the real probes separately).
const okDisk: DiskProbe = () => Promise.resolve({ freeBytes: 50 * 1024 * 1024 * 1024 })
const okNet: NetworkProbe = () => Promise.resolve({ ok: true })
const probes = { diskProbe: okDisk, networkProbe: okNet }

const goodRun: RunCommand = (cmd) =>
    Promise.resolve<CommandResult>(
        cmd === 'git'
            ? { ok: true, stdout: 'git version 2.45.1.windows.1\n' }
            : { ok: true, stdout: 'v24.21.0\n' }
    )

interface FakeApiOpts {
    readonly health?: () => Promise<unknown>
    readonly config?: () => Promise<unknown>
}
const fakeApi = (o: FakeApiOpts = {}): EngineApi =>
    ({
        health:
            o.health ??
            (() => Promise.resolve({ ok: true, name: 'engine', version: '4.3.2', state: 'idle' })),
        config: o.config ?? (() => Promise.resolve({ config: { anything: 1 } }))
    }) as unknown as EngineApi

interface Setup {
    readonly root?: string
    readonly run?: RunCommand
    readonly api?: EngineApi | null
    readonly link?: EngineLink
    readonly linkDetail?: string | null
    readonly accounts?: ReturnType<HealthDeps['accounts']>
    readonly appVersion?: string
    readonly timeoutMs?: number
    readonly clock?: { now: number }
}

function dataDirOf(): string {
    const d = mkdtempSync(join(tmpdir(), 'rf-health-data-'))
    dirs.push(d)
    return d
}

function service(s: Setup = {}): HealthService {
    const redactor = new Redactor()
    const clock = s.clock
    return new HealthService({
        engineRoot: s.root ?? engineDir(),
        dataDir: dataDirOf(),
        ...probes,
        appInfo: () => ({
            name: 'Rewards Farmer LUCK',
            version: s.appVersion ?? '0.0.1',
            electron: '44.7.0',
            platform: 'win32'
        }),
        accounts: () => s.accounts ?? { status: 'ok', error: null, count: 2 },
        engine: () => ({ link: s.link ?? 'ready', detail: s.linkDetail ?? null, version: '4.3.2' }),
        api: () => (s.api === undefined ? fakeApi() : s.api),
        redact: (t) => redactor.redact(t),
        runCommand: s.run ?? goodRun,
        checkTimeoutMs: s.timeoutMs ?? 5000,
        ...(clock === undefined ? {} : { now: () => new Date(clock.now) })
    })
}

async function rows(s: Setup = {}): Promise<Record<HealthCheckId, HealthCheck>> {
    const state = await service(s).runChecks()
    expect(state.status).toBe('done')
    return Object.fromEntries(state.checks.map((c) => [c.id, c])) as Record<HealthCheckId, HealthCheck>
}

describe('HealthService: healthy machine', () => {
    it('returns every row in screen order and all of them pass', async () => {
        const state = await service().runChecks()
        expect(state.checks.map((c) => c.id)).toEqual([
            'app',
            'node',
            'git',
            'engine-files',
            'engine-packages',
            'engine-built',
            'config-file',
            'config-valid',
            'accounts-file',
            'engine-process',
            'engine-api',
            'engine-config',
            'engine-version',
            'disk-space',
            'folder-data',
            'folder-engine',
            'network'
        ])
        for (const c of state.checks) expect(c, c.id).toMatchObject({ status: 'ok', fix: null })
        expect(state.startedAt).not.toBeNull()
        expect(state.finishedAt).not.toBeNull()
    })

    it('stamps each row with the time it was checked (not a fixed value)', async () => {
        const clock = { now: Date.parse('2026-10-14T10:00:00.000Z') }
        const svc = service({ clock })
        const first = await svc.runChecks()
        clock.now += 60_000
        const second = await svc.runChecks()
        expect(first.checks[0]?.checkedAt).toBe('2026-10-14T10:00:00.000Z')
        expect(second.checks[0]?.checkedAt).toBe('2026-10-14T10:01:00.000Z')
    })

    it('reflects the real state on every run: a check that was OK turns red when the file disappears', async () => {
        const root = engineDir()
        const svc = service({ root })
        expect((await svc.runChecks()).checks.find((c) => c.id === 'engine-built')?.status).toBe('ok')
        rmSync(join(root, 'dist'), { recursive: true })
        expect((await svc.runChecks()).checks.find((c) => c.id === 'engine-built')?.status).toBe('error')
    })

    it('a second call while one is running joins it (one run, one result)', async () => {
        const svc = service()
        const [a, b] = await Promise.all([svc.runChecks(), svc.runChecks()])
        expect(a).toBe(b)
    })
})

describe('HealthService: runtime', () => {
    it('Node.js missing -> error with the download link and START.bat', async () => {
        const r = await rows({
            run: (cmd) =>
                cmd === 'git' ? goodRun(cmd, []) : Promise.resolve({ ok: false, reason: 'not-found' })
        })
        expect(r.node).toMatchObject({ status: 'error' })
        expect(r.node.fix).toContain('https://nodejs.org/')
        expect(r.node.fix).toContain('START.bat')
    })

    it('Node.js too old (v22) -> error that names the version and the needed one', async () => {
        const r = await rows({
            run: (cmd) =>
                cmd === 'git' ? goodRun(cmd, []) : Promise.resolve({ ok: true, stdout: 'v22.22.2\n' })
        })
        expect(r.node.status).toBe('error')
        expect(r.node.detail).toMatch(/22\.22\.2.*too old.*24/)
        expect(r.node.fix).toContain('nodejs.org')
    })

    it('Node.js that cannot run -> error; answers with nonsense or hangs -> unknown (never ok)', async () => {
        const mk =
            (res: CommandResult): RunCommand =>
            (cmd) =>
                cmd === 'git' ? goodRun(cmd, []) : Promise.resolve(res)
        expect((await rows({ run: mk({ ok: false, reason: 'failed' }) })).node.status).toBe('error')
        expect((await rows({ run: mk({ ok: true, stdout: 'banana' }) })).node.status).toBe('unknown')
        expect((await rows({ run: mk({ ok: false, reason: 'timeout' }) })).node.status).toBe('unknown')
    })

    it('Git missing: warning when the engine is already here, error when the engine files are missing', async () => {
        const noGit: RunCommand = (cmd) =>
            cmd === 'git' ? Promise.resolve({ ok: false, reason: 'not-found' }) : goodRun(cmd, [])
        const here = await rows({ run: noGit })
        expect(here.git.status).toBe('warning')
        expect(here.git.fix).toContain('git-scm.com')
        expect(here.git.fix).toMatch(/only need it/)
        const gone = await rows({ run: noGit, root: engineDir({ files: false }) })
        expect(gone.git.status).toBe('error')
        expect(gone.git.fix).toMatch(/needed now/)
    })

    it('shows the app version, and "unknown" when the app did not report one', async () => {
        const ok = await rows({ appVersion: '0.0.1' })
        expect(ok.app.detail).toContain('0.0.1')
        expect(ok.app.detail).toContain('Windows')
        expect((await rows({ appVersion: '' })).app.status).toBe('unknown')
    })
})

describe('HealthService: configuration', () => {
    it('engine files missing -> one red row, and the rows that depend on them are "unknown", not more red rows', async () => {
        const r = await rows({
            root: engineDir({ files: false, packages: false, built: false, config: false })
        })
        expect(r['engine-files'].status).toBe('error')
        expect(r['engine-files'].fix).toContain('START.bat')
        for (const id of ['engine-packages', 'engine-built', 'config-file', 'config-valid'] as const) {
            expect(r[id].status, id).toBe('unknown')
            expect(r[id].detail).toMatch(/Not checked/)
        }
    })

    it('packages or build missing -> error that points to START.bat', async () => {
        const r = await rows({ root: engineDir({ packages: false, built: false }) })
        expect(r['engine-packages']).toMatchObject({ status: 'error' })
        expect(r['engine-packages'].fix).toContain('START.bat')
        expect(r['engine-built']).toMatchObject({ status: 'error' })
        expect(r['engine-built'].fix).toContain('START.bat')
    })

    it('config.json missing -> error that points to Create config on Home; content row is unknown', async () => {
        const r = await rows({ root: engineDir({ config: false }) })
        expect(r['config-file'].status).toBe('error')
        expect(r['config-file'].fix).toContain('Create config')
        expect(r['config-valid'].status).toBe('unknown')
    })

    it('config.json that is not JSON -> error, and NOTHING from the file is shown (it may hold secrets)', async () => {
        const secret = 'SECRET-TOKEN-ABC123-do-not-leak'
        const r = await rows({ root: engineDir({ config: `{ "discord": { "url": "${secret}" ` }) })
        expect(r['config-valid'].status).toBe('error')
        expect(r['config-valid'].detail).toBe('config.json is not valid JSON.')
        expect(JSON.stringify(r)).not.toContain(secret)
    })

    it('config.json with a wrong type -> error naming the setting; with settings missing -> warning; real example -> ok', async () => {
        const example = JSON.parse(
            (await import('node:fs')).readFileSync(join(REAL_ENGINE, 'config.example.json'), 'utf8')
        ) as Record<string, unknown>
        const wrong = { ...example, headless: 'yes' }
        const bad = await rows({ root: engineDir({ config: JSON.stringify(wrong) }) })
        expect(bad['config-valid'].status).toBe('error')
        expect(bad['config-valid'].detail).toMatch(/must be true or false/)
        expect(bad['config-valid'].fix).toContain('Notepad')
        const partial = await rows({ root: engineDir({ config: '{}' }) })
        expect(partial['config-valid'].status).toBe('warning')
        expect(partial['config-valid'].detail).toMatch(/missing/)
        expect(partial['config-valid'].fix).toContain('Settings')
        const good = await rows({ root: engineDir() })
        expect(good['config-valid'].status).toBe('ok')
        const notObject = await rows({ root: engineDir({ config: '[1,2]' }) })
        expect(notObject['config-valid'].status).toBe('error')
    })

    it('a UTF-8 byte order mark in config.json is tolerated, an oversize file is refused', async () => {
        const example = (await import('node:fs')).readFileSync(
            join(REAL_ENGINE, 'config.example.json'),
            'utf8'
        )
        expect((await rows({ root: engineDir({ config: '\ufeff' + example }) }))['config-valid'].status).toBe(
            'ok'
        )
        const huge = await rows({ root: engineDir({ config: ' '.repeat(1024 * 1024 + 10) }) })
        expect(huge['config-valid']).toMatchObject({ status: 'error' })
        expect(huge['config-valid'].detail).toMatch(/over 1 MB/)
    })

    it('accounts file: not set -> warning, broken -> error with its message, empty -> warning, fine -> ok with the count', async () => {
        const notSet = await rows({ accounts: { status: 'not-set', error: null, count: null } })
        expect(notSet['accounts-file'].status).toBe('warning')
        expect(notSet['accounts-file'].fix).toContain('Home')
        const broken = await rows({ accounts: { status: 'error', error: 'File not found.', count: null } })
        expect(broken['accounts-file'].status).toBe('error')
        expect(broken['accounts-file'].detail).toContain('File not found.')
        const empty = await rows({ accounts: { status: 'ok', error: null, count: 0 } })
        expect(empty['accounts-file'].status).toBe('warning')
        expect(empty['accounts-file'].fix).toContain('Accounts')
        const one = await rows({ accounts: { status: 'ok', error: null, count: 1 } })
        expect(one['accounts-file'].detail).toContain('1 account)')
    })
})

describe('HealthService: engine', () => {
    it('engine process: every link state maps to its own honest row', async () => {
        expect((await rows({ link: 'ready' }))['engine-process'].status).toBe('ok')
        const starting = await rows({ link: 'starting', api: null })
        expect(starting['engine-process'].status).toBe('warning')
        const notStarted = await rows({ link: 'not-started', api: null })
        expect(notStarted['engine-process'].status).toBe('warning')
        expect(notStarted['engine-process'].fix).toContain('Home')
        const failed = await rows({ link: 'failed', linkDetail: 'Port in use.', api: null })
        expect(failed['engine-process'].status).toBe('error')
        expect(failed['engine-process'].detail).toContain('Port in use.')
        expect(failed['engine-process'].fix).toContain('Restart engine')
        const down = await rows({ link: 'down', api: null })
        expect(down['engine-process'].status).toBe('error')
        expect(down['engine-process'].fix).toContain('START.bat')
    })

    it('engine not running -> the three API rows are "unknown" with the reason, never ok', async () => {
        const r = await rows({ api: null, link: 'not-started' })
        for (const id of ['engine-api', 'engine-config', 'engine-version'] as const) {
            expect(r[id].status, id).toBe('unknown')
            expect(r[id].detail, id).toMatch(/engine is not running/)
        }
    })

    it('engine API does not answer -> error with the message; AUTH problem gets its own advice', async () => {
        const down = await rows({
            api: fakeApi({
                health: () =>
                    Promise.reject(
                        new AppError('ENGINE_DOWN', 'The engine API is not reachable.', undefined, true)
                    )
            })
        })
        expect(down['engine-api'].status).toBe('error')
        expect(down['engine-api'].detail).toContain('not reachable')
        expect(down['engine-version'].status).toBe('unknown')
        const auth = await rows({
            api: fakeApi({
                health: () =>
                    Promise.reject(
                        new AppError('AUTH', 'The engine API refused the token. Restart the engine.', 401)
                    )
            })
        })
        expect(auth['engine-api'].fix).toMatch(/start together/)
        const notHealthy = await rows({ api: fakeApi({ health: () => Promise.resolve({ ok: false }) }) })
        expect(notHealthy['engine-api'].status).toBe('error')
    })

    it('engine config row: ok, missing (NOT_FOUND), rejected (CONFIG_INVALID), auth, other, and an answer without a config', async () => {
        const mk = (e: unknown) => rows({ api: fakeApi({ config: () => Promise.reject(e) }) })
        expect((await mk(new AppError('NOT_FOUND', 'x', 404)))['engine-config'].fix).toContain(
            'Create config'
        )
        const invalid = (await mk(new AppError('CONFIG_INVALID', 'bad field', 422)))['engine-config']
        expect(invalid.status).toBe('error')
        expect(invalid.detail).toContain('bad field')
        expect(invalid.fix).toContain('config.broken.json')
        expect((await mk(new AppError('AUTH', 'refused', 401)))['engine-config'].status).toBe('error')
        expect((await mk(new AppError('ENGINE_ERROR', 'boom', 500)))['engine-config'].detail).toContain(
            'boom'
        )
        expect((await mk(new Error('plain')))['engine-config'].status).toBe('error')
        const empty = await rows({ api: fakeApi({ config: () => Promise.resolve({}) }) })
        expect(empty['engine-config'].status).toBe('error')
    })

    it('engine version: matching -> ok; stale engine still running -> warning; missing information -> unknown', async () => {
        const match = await rows({ root: engineDir({ version: '4.3.2' }) })
        expect(match['engine-version'].status).toBe('ok')
        const stale = await rows({ root: engineDir({ version: '4.4.0' }) })
        expect(stale['engine-version']).toMatchObject({ status: 'warning' })
        expect(stale['engine-version'].detail).toMatch(/4\.3\.2.*4\.4\.0/)
        expect(stale['engine-version'].fix).toContain('START.bat')
        const noVersion = await rows({ api: fakeApi({ health: () => Promise.resolve({ ok: true }) }) })
        expect(noVersion['engine-version'].status).toBe('unknown')
        const nonNumeric = await rows({
            api: fakeApi({ health: () => Promise.resolve({ ok: true, version: 'abc' }) })
        })
        expect(nonNumeric['engine-version'].status).toBe('unknown')
    })
})

describe('HealthService: robustness and safety', () => {
    it('a check that hangs becomes "unknown" after the limit and does not freeze the other rows', async () => {
        const r = await rows({
            timeoutMs: 100,
            api: fakeApi({ config: () => new Promise(() => undefined) })
        })
        expect(r['engine-config'].status).toBe('unknown')
        expect(r['engine-config'].detail).toMatch(/did not finish in time/)
        expect(r.app.status).toBe('ok')
    })

    it('a check that throws becomes "unknown" with a redacted reason, never a crash and never ok', async () => {
        const redactor = new Redactor()
        redactor.add('hunter2-secret')
        const svc = new HealthService({
            engineRoot: engineDir(),
            dataDir: dataDirOf(),
            ...probes,
            appInfo: () => {
                throw new Error('failed with hunter2-secret inside')
            },
            accounts: () => ({ status: 'ok', error: null, count: 1 }),
            engine: () => ({ link: 'ready', detail: null, version: null }),
            api: () => null,
            redact: (t) => redactor.redact(t),
            runCommand: goodRun
        })
        const state = await svc.runChecks()
        const app = state.checks.find((c) => c.id === 'app')
        expect(app?.status).toBe('unknown')
        expect(app?.detail).not.toContain('hunter2-secret')
    })

    it('engine messages are redacted before they are shown', async () => {
        const redactor = new Redactor()
        redactor.add('tok-9f8e7d6c5b')
        const svc = new HealthService({
            engineRoot: engineDir(),
            dataDir: dataDirOf(),
            ...probes,
            appInfo: () => ({ name: 'x', version: '1', electron: '1', platform: 'win32' }),
            accounts: () => ({ status: 'ok', error: null, count: 1 }),
            engine: () => ({ link: 'ready', detail: null, version: null }),
            api: () =>
                fakeApi({
                    health: () =>
                        Promise.reject(new AppError('ENGINE_ERROR', 'failed for tok-9f8e7d6c5b', 500))
                }),
            redact: (t) => redactor.redact(t),
            runCommand: goodRun
        })
        const state = await svc.runChecks()
        expect(JSON.stringify(state)).not.toContain('tok-9f8e7d6c5b')
    })

    it('every warning and error row tells the user what to do, only by clicking or double-clicking (no typed commands)', async () => {
        const scenarios: Setup[] = [
            {
                root: engineDir({ files: false }),
                run: () => Promise.resolve({ ok: false, reason: 'not-found' }),
                api: null,
                link: 'down',
                accounts: { status: 'error', error: 'x', count: null }
            },
            {
                root: engineDir({ packages: false, built: false, config: '{ nope' }),
                api: null,
                link: 'failed',
                linkDetail: 'x'
            },
            {
                root: engineDir({ config: false }),
                link: 'starting',
                api: null,
                accounts: { status: 'not-set', error: null, count: null }
            },
            {
                api: fakeApi({
                    health: () => Promise.reject(new AppError('ENGINE_DOWN', 'down')),
                    config: () => Promise.reject(new AppError('CONFIG_INVALID', 'bad'))
                })
            },
            { root: engineDir({ version: '9.9.9', config: '{}' }) }
        ]
        let problems = 0
        for (const s of scenarios) {
            for (const c of (await service(s).runChecks()).checks) {
                if (c.status !== 'warning' && c.status !== 'error') continue
                problems += 1
                expect(c.fix, `${c.id} has a fix`).not.toBeNull()
                expect((c.fix ?? '').length, c.id).toBeGreaterThan(15)
                expect(c.fix, c.id).not.toMatch(/npm |git submodule|node \S+\.js/)
            }
        }
        expect(problems).toBeGreaterThan(8)
    })

    it('defaultRunCommand really runs a program, and reports a program that does not exist as not-found', async () => {
        const real = await defaultRunCommand(process.execPath, ['--version'])
        expect(real).toMatchObject({ ok: true })
        expect(real.ok && real.stdout.trim()).toBe(process.version)
        expect(await defaultRunCommand('rf-no-such-program-xyz', ['--version'])).toEqual({
            ok: false,
            reason: 'not-found'
        })
        expect(await defaultRunCommand(process.execPath, ['-e', 'process.exit(3)'])).toEqual({
            ok: false,
            reason: 'failed'
        })
    })

    it('with the real node on this machine the Node row is ok (a real command, not a fixed value)', async () => {
        const svc = new HealthService({
            engineRoot: engineDir(),
            dataDir: dataDirOf(),
            ...probes,
            appInfo: () => ({ name: 'x', version: '1', electron: '1', platform: 'win32' }),
            accounts: () => ({ status: 'ok', error: null, count: 1 }),
            engine: () => ({ link: 'ready', detail: null, version: null }),
            api: () => null,
            redact: (t) => t,
            nodeCommand: process.execPath
        })
        const node = (await svc.runChecks()).checks.find((c) => c.id === 'node')
        expect(node?.status).toBe('ok')
        expect(node?.detail).toBe(`Node.js ${process.version.slice(1)}`)
    })
})
