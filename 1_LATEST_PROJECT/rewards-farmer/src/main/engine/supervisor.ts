import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { ActionResult, EngineLink } from '../../shared/farmer-types'
import { EngineApi } from './apiClient'
import { killTree, isProcessAlive } from './supervisor-process'
import { DEFAULT_REAP_DEPS, reapStaleEngine, removePidFile, writePidFile } from './staleEngine'

export { killTree, isProcessAlive }

// Owns the engine API child process (docs/architecture.md sections 2 and 4):
// free port, random per-launch token passed by environment (never argv), health wait, orderly shutdown,
// a bounded number of automatic restarts after a crash (no silent infinite loop), kill tree as last resort.

const IS_WIN = process.platform === 'win32'
const MIN_NODE_MAJOR = 24

// Env vars that would widen the API surface (docs/architecture.md section 4 step 3, threat model T9).
const STRIPPED_ENV = [
    'API_ALLOW_ENV_OVERRIDES',
    'API_ALLOW_CONFIG_REVEAL',
    'API_ALLOW_SCHEDULE_WRITE',
    'API_RUN_COMMAND',
    'API_RUN_ARGS',
    'API_TOKEN',
    'ELECTRON_RUN_AS_NODE',
    'NODE_OPTIONS'
]

export type LogFn = (level: 'info' | 'warn' | 'error', message: string) => void

export interface SupervisorOptions {
    readonly engineRoot: string
    readonly log: LogFn
    // Redaction applied to every child output line before it is logged.
    readonly redact: (text: string) => string
    // Node.js executable used for the engine. Default: `node` from PATH (Node >= 24 is a documented prerequisite).
    readonly nodeCommand?: string
    // Extra environment for the API child. Used by tests only (fixtures). Production passes nothing.
    readonly extraEnv?: Readonly<Record<string, string>>
    // File that records the child PID so a force-killed app does not leave an orphan (see staleEngine.ts).
    readonly pidFile?: string
    readonly healthTimeoutMs?: number
    readonly maxAutoRestarts?: number
    readonly restartDelayMs?: number
    readonly shutdownGraceMs?: number
}

export interface SupervisorSnapshot {
    readonly link: EngineLink
    readonly detail: string | null
    readonly version: string | null
    readonly pid: number | null
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            const port = typeof address === 'object' && address !== null ? address.port : 0
            server.close(() => (port > 0 ? resolve(port) : reject(new Error('no port'))))
        })
    })
}

function nodeMajor(command: string): Promise<number | null> {
    return new Promise((resolve) => {
        execFile(command, ['--version'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
            if (error !== null) return resolve(null)
            const m = /^v(\d+)\./.exec(stdout.trim())
            resolve(m?.[1] === undefined ? null : Number(m[1]))
        })
    })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class EngineSupervisor extends EventEmitter {
    private child: ReturnType<typeof spawn> | null = null
    private apiClient: EngineApi | null = null
    private link: EngineLink = 'not-started'
    private detail: string | null = null
    private version: string | null = null
    private expectedExit = false
    private generation = 0
    private autoRestarts = 0
    private lastVars: Readonly<Record<string, string>> = {}
    private tail: string[] = []
    private restartTimer: NodeJS.Timeout | null = null
    // True while launch() waits for /health. An exit in that window is reported by launch() itself.
    private launching = false

    constructor(private readonly options: SupervisorOptions) {
        super()
    }

    get api(): EngineApi | null {
        return this.link === 'ready' ? this.apiClient : null
    }

    snapshot(): SupervisorSnapshot {
        return { link: this.link, detail: this.detail, version: this.version, pid: this.child?.pid ?? null }
    }

    private set(link: EngineLink, detail: string | null): void {
        this.link = link
        this.detail = detail
        this.emit('change', this.snapshot())
    }

    // Start (or restart) the API child with the given ACCOUNT_* variables.
    async start(accountVars: Readonly<Record<string, string>>): Promise<ActionResult> {
        await this.stop()
        if (this.options.pidFile !== undefined) {
            await reapStaleEngine(this.options.pidFile, DEFAULT_REAP_DEPS(this.options.log)).catch(() => undefined)
        }
        this.autoRestarts = 0
        return this.launch(accountVars)
    }

    private async launch(accountVars: Readonly<Record<string, string>>): Promise<ActionResult> {
        const { engineRoot, log, redact } = this.options
        const gen = ++this.generation
        this.lastVars = accountVars
        this.expectedExit = false
        this.tail = []

        const server = join(engineRoot, 'scripts', 'api', 'server.js')
        if (!existsSync(server)) {
            this.set('failed', 'Engine folder not found.')
            return { ok: false, code: 'ENGINE_MISSING', message: 'The engine folder was not found. Close this app and double-click START.bat. It offers to download the engine files.' }
        }
        const nodeCommand = this.options.nodeCommand ?? 'node'
        const major = await nodeMajor(nodeCommand)
        if (major === null || major < MIN_NODE_MAJOR) {
            const found = major === null ? 'not found on PATH' : `version ${String(major)} found`
            this.set('failed', `Node.js ${String(MIN_NODE_MAJOR)}+ needed (${found}).`)
            return { ok: false, code: 'NODE_MISSING', message: `Node.js ${String(MIN_NODE_MAJOR)} or newer is required for the engine (${found}).` }
        }

        let port: number
        try {
            port = await freePort()
        } catch {
            this.set('failed', 'No free local port.')
            return { ok: false, code: 'ENGINE_START_FAILED', message: 'Could not find a free local port for the engine API.' }
        }
        const token = randomBytes(32).toString('hex')
        this.options.log('info', `Engine API: starting on 127.0.0.1:${String(port)}`)

        const env: Record<string, string | undefined> = { ...process.env }
        for (const key of Object.keys(env)) if (/^ACCOUNT_\d+_/.test(key)) delete env[key]
        for (const key of STRIPPED_ENV) delete env[key]
        Object.assign(env, accountVars, {
            API_HOST: '127.0.0.1',
            API_PORT: String(port),
            API_TOKEN: token,
            API_ALLOW_CONFIG_WRITE: 'true',
            // A value no real web origin has: the Electron main process does not need CORS at all.
            API_CORS_ORIGIN: 'http://rewards-farmer.invalid',
            ...this.options.extraEnv
        })

        this.set('starting', null)
        let child: ReturnType<typeof spawn>
        try {
            child = spawn(nodeCommand, [server], {
                cwd: engineRoot,
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
                detached: !IS_WIN
            })
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            this.set('failed', 'Could not start the engine process.')
            log('error', `Engine API: spawn failed: ${redact(msg)}`)
            return { ok: false, code: 'ENGINE_START_FAILED', message: `Could not start the engine process: ${redact(msg)}` }
        }
        this.child = child
        const pidFile = this.options.pidFile
        if (pidFile !== undefined && child.pid !== undefined) {
            await writePidFile(pidFile, child.pid, server).catch(() => log('warn', 'Could not write the engine pid file.'))
        }
        const client = new EngineApi({ baseUrl: `http://127.0.0.1:${String(port)}`, token })
        this.apiClient = client
        this.launching = true

        const onLine = (level: 'info' | 'warn') => (chunk: Buffer) => {
            for (const raw of chunk.toString('utf8').split(/\r?\n/)) {
                if (raw.trim() === '') continue
                const line = redact(raw)
                this.tail = [...this.tail.slice(-29), line]
                log(level, `[engine-api] ${line}`)
            }
        }
        child.stdout?.on('data', onLine('info'))
        child.stderr?.on('data', onLine('warn'))

        let exited: { code: number | null; signal: string | null } | null = null
        child.once('error', (error) => {
            exited = { code: null, signal: null }
            this.tail = [...this.tail, redact(error.message)]
        })
        child.once('exit', (code, signal) => {
            exited = { code, signal }
            if (pidFile !== undefined) void removePidFile(pidFile).catch(() => undefined)
            if (gen === this.generation) this.handleExit(code, signal)
        })

        // Wait for /health (docs/architecture.md section 4 step 4).
        const deadline = Date.now() + (this.options.healthTimeoutMs ?? 15000)
        while (Date.now() < deadline) {
            if (exited !== null || gen !== this.generation) break
            try {
                const health = await client.health()
                if (health.ok === true) {
                    this.version = typeof health.version === 'string' ? health.version : null
                    this.launching = false
                    this.set('ready', null)
                    log('info', `Engine API: ready (engine version ${this.version ?? 'unknown'})`)
                    return { ok: true, message: 'Engine API is ready.' }
                }
            } catch {
                // not listening yet
            }
            await sleep(150)
        }

        const last = this.tail.at(-1)
        const reason = exited === null ? 'The engine API did not become ready in time.' : `The engine API exited during start${last === undefined ? '' : `: ${last}`}`
        this.launching = false
        if (gen === this.generation) {
            this.generation += 1 // the exit handler of this child must not treat the kill below as a crash
            if (child.pid !== undefined) killTree(child.pid)
            this.child = null
            this.apiClient = null
            this.set('failed', reason)
        }
        log('error', `Engine API: ${reason}`)
        return { ok: false, code: 'ENGINE_START_FAILED', message: reason }
    }

    private handleExit(code: number | null, signal: string | null): void {
        const { log } = this.options
        this.child = null
        this.apiClient = null
        if (this.launching) return
        if (this.expectedExit) {
            this.set('not-started', null)
            return
        }
        const how = signal === null ? `exit code ${String(code)}` : `signal ${signal}`
        log('error', `Engine API: stopped unexpectedly (${how}).`)
        this.emit('unexpected-exit', { code, signal })
        if (this.autoRestarts >= (this.options.maxAutoRestarts ?? 3)) {
            this.set('failed', `The engine API stopped unexpectedly and was restarted ${String(this.autoRestarts)} times. Use "Restart engine".`)
            return
        }
        this.autoRestarts += 1
        this.set('down', `The engine API stopped unexpectedly (${how}). Restarting (${String(this.autoRestarts)}/${String(this.options.maxAutoRestarts ?? 3)})...`)
        const gen = this.generation
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null
            if (gen !== this.generation) return
            void this.launch(this.lastVars)
        }, this.options.restartDelayMs ?? 1000)
    }

    // Orderly stop: POST /shutdown (the engine stops its own bot run), then kill the tree if it lingers.
    async stop(): Promise<void> {
        if (this.restartTimer !== null) {
            clearTimeout(this.restartTimer)
            this.restartTimer = null
        }
        this.generation += 1
        const child = this.child
        if (child === null) {
            if (this.link !== 'not-started') this.set('not-started', null)
            return
        }
        this.expectedExit = true
        const exitPromise = new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) return resolve()
            child.once('exit', () => resolve())
        })
        try {
            await this.apiClient?.shutdown()
        } catch {
            // API already unreachable: fall through to kill
        }
        const grace = this.options.shutdownGraceMs ?? 5000
        const orderly = await Promise.race([exitPromise.then(() => true), sleep(grace).then(() => false)])
        if (!orderly && child.pid !== undefined) {
            this.options.log('warn', 'Engine API: did not exit after /shutdown, killing the process tree.')
            killTree(child.pid)
            await Promise.race([exitPromise, sleep(3000)])
        }
        this.child = null
        this.apiClient = null
        this.set('not-started', null)
    }
}
