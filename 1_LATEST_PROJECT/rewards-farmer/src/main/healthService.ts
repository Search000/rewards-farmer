import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { readFile, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import { extractValues } from '../shared/engine-settings-rules'
import type { EngineSettingsValues } from '../shared/engine-settings-types'
import type { EngineLink } from '../shared/farmer-types'
import {
    CHECK_DEFS,
    GIT_DOWNLOAD,
    MIN_NODE_MAJOR,
    NETWORK_HOST,
    NETWORK_PORT,
    NODE_DOWNLOAD,
    driveOf,
    evaluateDisk,
    formatBytes,
    makeCheck,
    parseGitVersion,
    parseNodeMajor,
    parseNodeVersion,
    sameVersion
} from '../shared/health-rules'
import type { HealthCheck, HealthCheckId, HealthState, HealthStatus } from '../shared/health-types'
import { AppError } from './engine/apiClient'
import type { EngineApi, HealthResponse } from './engine/apiClient'
import type { JsonlLog } from './jsonlLog'

// Phase 12 health service (runtime, config, engine). Every row comes from a check that runs on each call:
// a command (`node --version`, `git --version`), a file test in the engine folder, a read of config.json, or a call to the
// engine API. Nothing is cached and nothing is a fixed value. A check that cannot run is `unknown`, never `ok`.
// Secrets: config.json is parsed in memory only; no value from it and no parser message that could quote it is ever put
// into a row. Engine answers are passed through `redact` before they are shown.

export type CommandResult =
    | { readonly ok: true; readonly stdout: string }
    | { readonly ok: false; readonly reason: 'not-found' | 'timeout' | 'failed' }

export type RunCommand = (command: string, args: readonly string[]) => Promise<CommandResult>

export const defaultRunCommand: RunCommand = (command, args) =>
    new Promise((resolve) => {
        execFile(command, [...args], { timeout: 8000, windowsHide: true }, (error, stdout) => {
            if (error === null) return resolve({ ok: true, stdout })
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'ENOENT') return resolve({ ok: false, reason: 'not-found' })
            if ((error as { killed?: boolean }).killed === true)
                return resolve({ ok: false, reason: 'timeout' })
            resolve({ ok: false, reason: 'failed' })
        })
    })

// ---- Phase 13 probes (real file system and network; tests replace them with isolated stand-ins) ------------------------

export interface DiskInfo {
    readonly freeBytes: number
}
export type DiskProbe = (path: string) => Promise<DiskInfo>

export const defaultDiskProbe: DiskProbe = async (path) => {
    const info = await statfs(path)
    return { freeBytes: Number(info.bavail) * Number(info.bsize) }
}

export type FolderProbeResult =
    { readonly ok: true; readonly leftover: boolean } | { readonly ok: false; readonly code: string }
export type FolderProbe = (dir: string) => Promise<FolderProbeResult>

// Really tries to use the folder: makes a tiny file with a unique name, reads it back, deletes it. It never touches a file
// that already exists (the name is new and the file is opened with "fail if exists").
export const defaultFolderProbe: FolderProbe = async (dir) => {
    try {
        const info = await stat(dir)
        if (!info.isDirectory()) return { ok: false, code: 'ENOTDIR' }
    } catch (e) {
        return { ok: false, code: (e as NodeJS.ErrnoException).code ?? 'UNKNOWN' }
    }
    const file = join(dir, `.rf-health-probe-${randomBytes(6).toString('hex')}.tmp`)
    const text = `probe-${randomBytes(4).toString('hex')}`
    try {
        await writeFile(file, text, { flag: 'wx' })
        const back = await readFile(file, 'utf8')
        if (back !== text) return { ok: false, code: 'MISMATCH' }
    } catch (e) {
        await rm(file, { force: true }).catch(() => undefined)
        return { ok: false, code: (e as NodeJS.ErrnoException).code ?? 'UNKNOWN' }
    }
    try {
        await rm(file)
        return { ok: true, leftover: false }
    } catch {
        return { ok: true, leftover: true }
    }
}

export type NetworkResult =
    { readonly ok: true } | { readonly ok: false; readonly stage: 'dns' | 'connect'; readonly code: string }
export type NetworkProbe = (host: string, port: number, timeoutMs: number) => Promise<NetworkResult>

// Looks the name up, then opens a TCP connection and closes it at once. Nothing is sent: no request, no data.
export const defaultNetworkProbe: NetworkProbe = async (host, port, timeoutMs) => {
    try {
        await lookup(host)
    } catch (e) {
        return { ok: false, stage: 'dns', code: (e as NodeJS.ErrnoException).code ?? 'UNKNOWN' }
    }
    return new Promise<NetworkResult>((resolve) => {
        const socket = connect({ host, port })
        const done = (r: NetworkResult): void => {
            socket.destroy()
            resolve(r)
        }
        socket.setTimeout(timeoutMs, () => done({ ok: false, stage: 'connect', code: 'ETIMEDOUT' }))
        socket.once('connect', () => done({ ok: true }))
        socket.once('error', (err: NodeJS.ErrnoException) =>
            done({ ok: false, stage: 'connect', code: err.code ?? 'UNKNOWN' })
        )
    })
}

export interface HealthDeps {
    readonly engineRoot: string
    // The app's own data folder (settings, logs, backups). Checked for free space and for read/write access.
    readonly dataDir: string
    readonly appInfo: () => {
        readonly name: string
        readonly version: string
        readonly electron: string
        readonly platform: string
    }
    readonly accounts: () => {
        readonly status: 'not-set' | 'ok' | 'error'
        readonly error: string | null
        readonly count: number | null
    }
    readonly engine: () => {
        readonly link: EngineLink
        readonly detail: string | null
        readonly version: string | null
    }
    readonly api: () => EngineApi | null
    readonly redact: (text: string) => string
    readonly appLog?: JsonlLog
    readonly runCommand?: RunCommand
    // The Node.js the engine is started with. The supervisor uses `node` from PATH, so this checks the same one.
    readonly nodeCommand?: string
    readonly diskProbe?: DiskProbe
    readonly folderProbe?: FolderProbe
    readonly networkProbe?: NetworkProbe
    readonly networkTarget?: { readonly host: string; readonly port: number }
    readonly now?: () => Date
    // One slow check must not freeze the panel (default 10 s).
    readonly checkTimeoutMs?: number
}

interface Outcome {
    readonly status: HealthStatus
    readonly detail: string
    readonly fix?: string
}

const MAX_CONFIG_BYTES = 1024 * 1024

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

const START_FIX_FILES =
    'Close this app and double-click START.bat in the project folder. It offers to download the engine files (needs Git and internet).'
const START_FIX_PACKAGES =
    'Close this app and double-click START.bat in the project folder. It installs the engine packages (needs internet, takes a few minutes).'
const START_FIX_BUILD =
    'Close this app and double-click START.bat in the project folder. It builds the engine on first run.'
const RESTART_FIX =
    'Close this app and open it again with START.bat. If it happens again, open the Logs page and read the newest red lines.'
// Phase 15: found by really trying the old text ("Reset to defaults" / "Save"). With a broken config.json the Settings page is
// read-only and Reset fails, and Save does not write a missing setting. The texts below are the paths that were verified
// (tests/main/troubleshooting.fixes.test.ts): rename the file and let the Home page create a new one, or correct one value.
const BROKEN_CONFIG_FIX =
    'Press "Repair config.json" below. It keeps a copy of the file as config.broken.json in the engine folder and keeps every setting that still has a good value. If you prefer to do it by hand: open the engine folder (the folder named "engine" inside the project folder) in File Explorer, rename config.json to config.broken.json, then open the Home page and press "Create config" (settings you changed before must be entered again; open config.broken.json in Notepad to read them).'
const BAD_VALUE_FIX =
    'Press "Repair config.json" below: it keeps a copy of the file and keeps your other settings. Or open config.json in the engine folder with Notepad, correct the setting named above, save the file and press "Re-run checks".'
const MISSING_SETTING_FIX =
    'You can leave this as it is: the engine uses its default value for the missing setting. The warning only goes away when that one setting is changed and saved on the Settings page. Pressing Save without changing it does not write it.'

export class HealthService {
    private running: Promise<HealthState> | null = null

    constructor(private readonly deps: HealthDeps) {}

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date()
    }

    private run(): HealthDeps['runCommand'] & RunCommand {
        return this.deps.runCommand ?? defaultRunCommand
    }

    // Runs every check now. A second call while one is running joins the running one (no pile-up).
    runChecks(): Promise<HealthState> {
        if (this.running !== null) return this.running
        const p = this.runOnce().finally(() => {
            this.running = null
        })
        this.running = p
        return p
    }

    private async runOnce(): Promise<HealthState> {
        const startedAt = this.now().toISOString()
        const root = this.deps.engineRoot
        const api = this.deps.api()

        // Slow probes start at once; rows are then built in screen order.
        const nodeP = this.run()(this.deps.nodeCommand ?? 'node', ['--version'])
        const gitP = this.run()('git', ['--version'])
        const healthP = this.probeHealth(api)
        const target = this.deps.networkTarget ?? { host: NETWORK_HOST, port: NETWORK_PORT }
        // A probe that fails is turned into `null` at once. Without this the failure would be an unhandled rejection until the
        // network row reads it (found in Phase 14: vitest exited with an error although every test passed).
        const netP: Promise<NetworkResult | null> = Promise.resolve()
            .then(() => (this.deps.networkProbe ?? defaultNetworkProbe)(target.host, target.port, 5000))
            .catch(() => null)

        const filesOk =
            (await exists(join(root, 'scripts', 'api', 'server.js'))) &&
            (await exists(join(root, 'package.json')))
        const configPath = join(root, 'config.json')

        const outcomes = new Map<HealthCheckId, () => Promise<Outcome>>()
        outcomes.set('app', () => Promise.resolve(this.checkApp()))
        outcomes.set('node', async () => this.checkNode(await nodeP))
        outcomes.set('git', async () => this.checkGit(await gitP, filesOk))
        outcomes.set('engine-files', () =>
            Promise.resolve(
                filesOk
                    ? { status: 'ok', detail: 'The engine folder and its API script are present.' }
                    : {
                          status: 'error',
                          detail: 'The engine folder is missing or incomplete.',
                          fix: START_FIX_FILES
                      }
            )
        )
        outcomes.set('engine-packages', () => this.dependent(filesOk, () => this.checkPackages()))
        outcomes.set('engine-built', () => this.dependent(filesOk, () => this.checkBuilt()))
        outcomes.set('config-file', () => this.dependent(filesOk, () => this.checkConfigFile(configPath)))
        outcomes.set('config-valid', () => this.dependent(filesOk, () => this.checkConfigValid(configPath)))
        outcomes.set('accounts-file', () => Promise.resolve(this.checkAccounts()))
        outcomes.set('engine-process', () => Promise.resolve(this.checkProcess()))
        outcomes.set('engine-api', async () => this.checkApi(api, await healthP))
        outcomes.set('engine-config', () => this.checkEngineConfig(api))
        outcomes.set('engine-version', async () => this.checkVersion(api, await healthP, filesOk))
        outcomes.set('disk-space', () => this.checkDisk())
        outcomes.set('folder-data', () => this.checkFolder('app data folder', this.deps.dataDir, false))
        outcomes.set('folder-engine', () => this.checkFolder('engine folder', root, true))
        outcomes.set('network', async () => this.checkNetwork(await netP, target.host))

        const checks: HealthCheck[] = await Promise.all(
            CHECK_DEFS.map(async (def): Promise<HealthCheck> => {
                const work = outcomes.get(def.id)
                const outcome = await this.guarded(def.id, work)
                return this.finish(def.id, outcome)
            })
        )

        const finishedAt = this.now().toISOString()
        const bad = checks.filter((c) => c.status === 'error').length
        this.deps.appLog?.write({
            level: bad > 0 ? 'warn' : 'info',
            component: 'HealthService',
            message: `health checks: ${String(checks.filter((c) => c.status === 'ok').length)} ok, ${String(bad)} error, ${String(checks.filter((c) => c.status === 'warning').length)} warning, ${String(checks.filter((c) => c.status === 'unknown').length)} unknown`
        })
        return { status: 'done', checks, startedAt, finishedAt }
    }

    // A check that throws or hangs becomes `unknown`: the panel never crashes and never shows a pass it did not earn.
    private async guarded(id: HealthCheckId, work: (() => Promise<Outcome>) | undefined): Promise<Outcome> {
        if (work === undefined) return { status: 'unknown', detail: 'This check is not available.' }
        const limit = this.deps.checkTimeoutMs ?? 10000
        let timer: NodeJS.Timeout | undefined
        try {
            const timeout = new Promise<Outcome>((resolve) => {
                timer = setTimeout(
                    () => resolve({ status: 'unknown', detail: `The check "${id}" did not finish in time.` }),
                    limit
                )
            })
            return await Promise.race([work(), timeout])
        } catch (e) {
            const reason = e instanceof Error ? this.deps.redact(e.message) : 'unexpected error'
            return { status: 'unknown', detail: `The check itself failed (${reason}).` }
        } finally {
            if (timer !== undefined) clearTimeout(timer)
        }
    }

    private finish(id: HealthCheckId, o: Outcome): HealthCheck {
        const detail = this.deps.redact(o.detail)
        return makeCheck(
            id,
            o.status,
            detail,
            o.fix === undefined ? null : this.deps.redact(o.fix),
            this.now().toISOString()
        )
    }

    // A row that needs the engine files is `unknown` (not a second red row) when the files are missing.
    private async dependent(filesOk: boolean, work: () => Promise<Outcome>): Promise<Outcome> {
        if (!filesOk)
            return {
                status: 'unknown',
                detail: 'Not checked: the engine files are missing (see "Engine files").'
            }
        return work()
    }

    // ---- runtime -------------------------------------------------------------------------------------------------

    private checkApp(): Outcome {
        const info = this.deps.appInfo()
        if (info.version === '') return { status: 'unknown', detail: 'The app did not report its version.' }
        const platform = info.platform === 'win32' ? 'Windows' : info.platform
        return {
            status: 'ok',
            detail: `${info.name} ${info.version} (Electron ${info.electron || 'unknown'}, ${platform})`
        }
    }

    private checkNode(r: CommandResult): Outcome {
        const download = `Download Node.js ${String(MIN_NODE_MAJOR)} or newer from ${NODE_DOWNLOAD} , install it, then close this app and double-click START.bat again.`
        if (!r.ok) {
            if (r.reason === 'not-found')
                return { status: 'error', detail: 'Node.js was not found on this computer.', fix: download }
            if (r.reason === 'timeout')
                return {
                    status: 'unknown',
                    detail: 'Node.js did not answer in time, so its version is unknown.'
                }
            return {
                status: 'error',
                detail: 'Node.js was found but it could not run.',
                fix: `Re-install Node.js ${String(MIN_NODE_MAJOR)} or newer from ${NODE_DOWNLOAD} , then close this app and double-click START.bat again.`
            }
        }
        const major = parseNodeMajor(r.stdout)
        const version = parseNodeVersion(r.stdout)
        if (major === null || version === null)
            return { status: 'unknown', detail: 'Node.js answered, but its version could not be read.' }
        if (major < MIN_NODE_MAJOR)
            return {
                status: 'error',
                detail: `Node.js ${version} is too old. The engine needs ${String(MIN_NODE_MAJOR)} or newer.`,
                fix: download
            }
        return { status: 'ok', detail: `Node.js ${version}` }
    }

    private checkGit(r: CommandResult, filesOk: boolean): Outcome {
        if (!r.ok) {
            if (r.reason === 'timeout')
                return { status: 'unknown', detail: 'Git did not answer in time, so its version is unknown.' }
            // Git is only needed to download or update the engine. With the engine already here it is a warning only.
            const fix = `Download Git from ${GIT_DOWNLOAD} and install it. ${filesOk ? 'You only need it to download or update the engine.' : 'It is needed now to download the engine.'}`
            const detail =
                r.reason === 'not-found'
                    ? 'Git was not found on this computer.'
                    : 'Git was found but it could not run.'
            return { status: filesOk ? 'warning' : 'error', detail, fix }
        }
        const version = parseGitVersion(r.stdout)
        if (version === null)
            return { status: 'unknown', detail: 'Git answered, but its version could not be read.' }
        return { status: 'ok', detail: `Git ${version}` }
    }

    // ---- configuration -------------------------------------------------------------------------------------------

    private async checkPackages(): Promise<Outcome> {
        const ok = await exists(join(this.deps.engineRoot, 'node_modules', '.package-lock.json'))
        return ok
            ? { status: 'ok', detail: 'The engine packages are installed.' }
            : {
                  status: 'error',
                  detail: 'The engine packages are not installed (or the install did not finish).',
                  fix: START_FIX_PACKAGES
              }
    }

    private async checkBuilt(): Promise<Outcome> {
        const ok = await exists(join(this.deps.engineRoot, 'dist', 'index.js'))
        return ok
            ? { status: 'ok', detail: 'The engine is built.' }
            : { status: 'error', detail: 'The engine is not built yet.', fix: START_FIX_BUILD }
    }

    private async checkConfigFile(configPath: string): Promise<Outcome> {
        return (await exists(configPath))
            ? { status: 'ok', detail: 'config.json exists.' }
            : {
                  status: 'error',
                  detail: 'config.json does not exist yet.',
                  fix: 'Open the Home page and press "Create config". The engine starts from the example settings.'
              }
    }

    private async readDefaults(): Promise<EngineSettingsValues | null> {
        try {
            const text = await readFile(join(this.deps.engineRoot, 'config.example.json'), 'utf8')
            const parsed = extractValues(JSON.parse(text) as unknown, null)
            return parsed.ok && parsed.value.missing.length === 0 ? parsed.value.values : null
        } catch {
            return null
        }
    }

    private async checkConfigValid(configPath: string): Promise<Outcome> {
        let text: string
        try {
            const info = await stat(configPath)
            if (info.size > MAX_CONFIG_BYTES)
                return {
                    status: 'error',
                    detail: 'config.json is much larger than a real config (over 1 MB).',
                    fix: BROKEN_CONFIG_FIX
                }
            text = await readFile(configPath, 'utf8')
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code
            if (code === 'ENOENT')
                return {
                    status: 'unknown',
                    detail: 'Not checked: config.json does not exist (see "Engine config.json").'
                }
            return {
                status: 'error',
                detail: `config.json could not be read (${code ?? 'read error'}).`,
                fix: 'Close other programs that may be using config.json, then open the Health page again. If it stays, the file may be locked by antivirus or cloud sync.'
            }
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
        } catch {
            // The parser message can quote part of the file. It is NOT shown (the file may hold secrets).
            return {
                status: 'error',
                detail: 'config.json is not valid JSON.',
                fix: BROKEN_CONFIG_FIX
            }
        }
        const result = extractValues(parsed, await this.readDefaults())
        if (!result.ok)
            return {
                status: 'error',
                detail: result.message,
                fix: BAD_VALUE_FIX
            }
        const missing = result.value.missing.length
        if (missing > 0)
            return {
                status: 'warning',
                detail: `config.json is valid JSON but ${String(missing)} setting${missing === 1 ? ' is' : 's are'} missing. The engine default is used for ${missing === 1 ? 'it' : 'them'}.`,
                fix: MISSING_SETTING_FIX
            }
        return {
            status: 'ok',
            detail: 'config.json is valid JSON and every setting this app uses has a good value.'
        }
    }

    private checkAccounts(): Outcome {
        const a = this.deps.accounts()
        if (a.status === 'not-set')
            return {
                status: 'warning',
                detail: 'No accounts file is chosen yet.',
                fix: 'Open the Home page and press "Open" to choose your accounts file.'
            }
        if (a.status === 'error')
            return {
                status: 'error',
                detail: `The accounts file has a problem: ${a.error ?? 'unknown problem'}`,
                fix: 'Fix the file, or choose another accounts file with "Open" on the Home page.'
            }
        if (a.count === 0)
            return {
                status: 'warning',
                detail: 'The accounts file has no accounts in it.',
                fix: 'Open the Accounts page and add an account.'
            }
        return {
            status: 'ok',
            detail:
                a.count === null
                    ? 'The accounts file is readable.'
                    : `The accounts file is readable (${String(a.count)} account${a.count === 1 ? '' : 's'}).`
        }
    }

    // ---- engine --------------------------------------------------------------------------------------------------

    private checkProcess(): Outcome {
        const e = this.deps.engine()
        switch (e.link) {
            case 'ready':
                return { status: 'ok', detail: 'The engine process is running and ready.' }
            case 'starting':
                return {
                    status: 'warning',
                    detail: 'The engine process is starting.',
                    fix: 'Wait a few seconds, then open the Health page again.'
                }
            case 'not-started':
                return {
                    status: 'warning',
                    detail: 'The engine has not been started yet. It starts after an accounts file is chosen.',
                    fix: 'Open the Home page and choose your accounts file with "Open".'
                }
            case 'failed':
                return {
                    status: 'error',
                    detail: `The engine could not start${e.detail === null ? '.' : `: ${e.detail}`}`,
                    fix: 'Open the Home page and press "Restart engine". If it fails again, read the newest red lines on the Logs page.'
                }
            default:
                return {
                    status: 'error',
                    detail: `The engine process stopped or crashed${e.detail === null ? '.' : `: ${e.detail}`}`,
                    fix: RESTART_FIX
                }
        }
    }

    // One GET /health shared by "Engine API answers" and "Engine version".
    private async probeHealth(
        api: EngineApi | null
    ): Promise<{ ok: true; body: HealthResponse } | { ok: false; error: AppError | Error } | null> {
        if (api === null) return null
        try {
            return { ok: true, body: await api.health() }
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e : new Error('unknown error') }
        }
    }

    private checkApi(api: EngineApi | null, h: Awaited<ReturnType<HealthService['probeHealth']>>): Outcome {
        if (api === null || h === null)
            return {
                status: 'unknown',
                detail: 'Not checked: the engine is not running (see "Engine process").'
            }
        if (!h.ok)
            return {
                status: 'error',
                detail: `The engine API did not answer correctly: ${h.error.message}`,
                fix:
                    h.error instanceof AppError && h.error.code === 'AUTH'
                        ? 'Close this app and open it again with START.bat. The engine and the app must start together.'
                        : RESTART_FIX
            }
        if (h.body.ok === false)
            return {
                status: 'error',
                detail: 'The engine API answered, but it says it is not healthy.',
                fix: RESTART_FIX
            }
        return {
            status: 'ok',
            detail: `The engine API answered${h.body.state === undefined ? '.' : ` (run state: ${h.body.state}).`}`
        }
    }

    private async checkEngineConfig(api: EngineApi | null): Promise<Outcome> {
        if (api === null)
            return {
                status: 'unknown',
                detail: 'Not checked: the engine is not running (see "Engine process").'
            }
        try {
            const res = await api.config()
            if (typeof res.config !== 'object' || res.config === null)
                return {
                    status: 'error',
                    detail: 'The engine answered, but without any configuration.',
                    fix: BROKEN_CONFIG_FIX
                }
            return { status: 'ok', detail: 'The engine loaded config.json and accepts it.' }
        } catch (e) {
            if (e instanceof AppError) {
                if (e.code === 'NOT_FOUND')
                    return {
                        status: 'error',
                        detail: 'The engine cannot find config.json.',
                        fix: 'Open the Home page and press "Create config".'
                    }
                if (e.code === 'CONFIG_INVALID')
                    return {
                        status: 'error',
                        detail: `The engine rejects config.json: ${e.message}`,
                        fix: BROKEN_CONFIG_FIX
                    }
                if (e.code === 'AUTH')
                    return {
                        status: 'error',
                        detail: e.message,
                        fix: 'Close this app and open it again with START.bat. The engine and the app must start together.'
                    }
                return {
                    status: 'error',
                    detail: `The engine could not give its config: ${e.message}`,
                    fix: RESTART_FIX
                }
            }
            return { status: 'error', detail: 'The engine could not give its config.', fix: RESTART_FIX }
        }
    }

    private async checkVersion(
        api: EngineApi | null,
        h: Awaited<ReturnType<HealthService['probeHealth']>>,
        filesOk: boolean
    ): Promise<Outcome> {
        if (api === null || h === null)
            return {
                status: 'unknown',
                detail: 'Not checked: the engine is not running (see "Engine process").'
            }
        if (!h.ok)
            return { status: 'unknown', detail: 'Not checked: the engine API did not answer (see above).' }
        const running = h.body.version
        if (typeof running !== 'string' || running === '')
            return { status: 'unknown', detail: 'The engine did not report its version.' }
        if (!filesOk)
            return {
                status: 'unknown',
                detail: `The engine reports version ${running}, but its files are missing to compare with.`
            }
        let onDisk: string | null
        try {
            const pkg = JSON.parse(await readFile(join(this.deps.engineRoot, 'package.json'), 'utf8')) as {
                version?: unknown
            }
            onDisk = typeof pkg.version === 'string' ? pkg.version : null
        } catch {
            onDisk = null
        }
        if (onDisk === null)
            return {
                status: 'unknown',
                detail: `The engine reports version ${running}, but the version in its files could not be read.`
            }
        const same = sameVersion(running, onDisk)
        if (same === null)
            return {
                status: 'unknown',
                detail: `The engine reports version ${running}; the files say ${onDisk}. They could not be compared.`
            }
        if (!same)
            return {
                status: 'warning',
                detail: `The running engine is version ${running}, but the engine files on disk are version ${onDisk}.`,
                fix: 'An older engine is still running. Close this app completely and open it again with START.bat.'
            }
        return { status: 'ok', detail: `Engine version ${running} (matches the engine files).` }
    }

    // ---- this computer (Phase 13) --------------------------------------------------------------------------------

    private async checkDisk(): Promise<Outcome> {
        const probe = this.deps.diskProbe ?? defaultDiskProbe
        const places = [
            { label: 'app data drive', path: this.deps.dataDir },
            { label: 'engine drive', path: this.deps.engineRoot }
        ]
        const found: { label: string; path: string; free: number }[] = []
        for (const place of places) {
            try {
                found.push({ ...place, free: (await probe(place.path)).freeBytes })
            } catch {
                // This place could not be measured; the other one may still be.
            }
        }
        if (found.length === 0)
            return {
                status: 'unknown',
                detail: 'The free disk space could not be read for the app data or the engine folder.'
            }
        let lowest = found[0]
        for (const f of found) if (lowest === undefined || f.free < lowest.free) lowest = f
        if (lowest === undefined)
            return { status: 'unknown', detail: 'The free disk space could not be read.' }
        const text = found.map((f) => `${formatBytes(f.free)} on the ${f.label}`).join(', ')
        const missing = found.length < places.length ? ' One of the two places could not be measured.' : ''
        const status = evaluateDisk(lowest.free)
        if (status === 'ok') return { status, detail: `Free space: ${text}.${missing}` }
        const drive = driveOf(lowest.path)
        return {
            status,
            detail: `${status === 'error' ? 'The disk is almost full' : 'The disk is getting full'}: ${text}.${missing}`,
            fix: `Free some space${drive === null ? '' : ` on drive ${drive}`}: empty the Recycle Bin and delete files you no longer need, or move the project to a bigger drive. The engine needs room for its browser data, logs and backups.`
        }
    }

    private async checkFolder(name: string, dir: string, isEngine: boolean): Promise<Outcome> {
        const r = await (this.deps.folderProbe ?? defaultFolderProbe)(dir)
        if (r.ok)
            return r.leftover
                ? {
                      status: 'warning',
                      detail: `The ${name} can be read and written, but a small test file could not be deleted again: ${dir}`,
                      fix: `Open that folder and delete the file whose name starts with ".rf-health-probe". If it will not delete, close other programs that use the folder.`
                  }
                : { status: 'ok', detail: `The ${name} can be read and written: ${dir}` }
        switch (r.code) {
            case 'ENOENT':
            case 'ENOTDIR':
                return {
                    status: 'error',
                    detail: `The ${name} does not exist: ${dir}`,
                    fix: isEngine
                        ? START_FIX_FILES
                        : 'Close this app and open it again with START.bat. It creates the folder. If this stays, check that the drive is connected.'
                }
            case 'EACCES':
            case 'EPERM':
                return {
                    status: 'error',
                    detail: `This computer does not allow the app to write in the ${name}: ${dir}`,
                    fix: 'Move the whole project folder to a normal place such as Documents and start START.bat from there. If it stays, right-click the folder, choose Properties, then Security, and give your user "Modify". Antivirus "Controlled folder access" can also block it: allow Rewards Farmer there.'
                }
            case 'EROFS':
                return {
                    status: 'error',
                    detail: `The ${name} is read-only: ${dir}`,
                    fix: 'Move the whole project folder to a normal folder on your computer, such as Documents, and start START.bat from there.'
                }
            case 'ENOSPC':
                return {
                    status: 'error',
                    detail: `The disk is full, so nothing can be written in the ${name}: ${dir}`,
                    fix: 'Free some disk space: empty the Recycle Bin and delete files you no longer need, then open this page again.'
                }
            default:
                return {
                    status: 'error',
                    detail: `The ${name} could not be used (${r.code}): ${dir}`,
                    fix: 'Close other programs that may be using the folder, or move the project folder to Documents, then open this page again.'
                }
        }
    }

    private checkNetwork(r: NetworkResult | null, host: string): Outcome {
        if (r === null) return { status: 'unknown', detail: 'The internet check could not be run.' }
        if (r.ok)
            return {
                status: 'ok',
                detail: `This computer can reach ${host}. Only a connection was opened to test it; nothing was sent.`
            }
        if (r.stage === 'dns')
            return {
                status: 'error',
                detail: `The name ${host} could not be looked up (${r.code}). The computer looks offline, or DNS is blocked.`,
                fix: 'Check your Wi-Fi or network cable and that other websites open. If you use a VPN, turn it off or switch it. Then press "Re-run checks".'
            }
        return {
            status: 'warning',
            detail: `The name ${host} was found, but a connection could not be opened (${r.code}).`,
            fix: 'A firewall, VPN or proxy may be blocking the connection. If your accounts use their own proxy, this can be normal. Otherwise allow Rewards Farmer in your firewall and press "Re-run checks".'
        }
    }
}
