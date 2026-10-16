import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore } from '../../src/main/appSettings'
import { Redactor } from '../../src/main/engine/redact'
import { EngineSupervisor } from '../../src/main/engine/supervisor'
import { FarmerService } from '../../src/main/farmer'
import { JsonlLog } from '../../src/main/jsonlLog'

// Test harness. Everything lives in a fresh temp dir. Accounts here are FAKE fixtures and exist only in tests.
export const REPO_ROOT = join(__dirname, '..', '..')
const REAL_ENGINE = join(REPO_ROOT, 'engine')
const FAKE_BOT = join(__dirname, '..', 'fixtures', 'fake-bot.cjs')

export const FAKE_PASSWORD = 'fake-pw-Zx81-test-only'
export const FAKE_TOTP = 'FAKETOTPSECRET234567'
export const FAKE_ACCOUNTS_ENV = [
    'ACCOUNT_1_EMAIL=alpha@example.com',
    `ACCOUNT_1_PASSWORD=${FAKE_PASSWORD}`,
    `ACCOUNT_1_TOTP_SECRET=${FAKE_TOTP}`,
    'ACCOUNT_2_EMAIL=beta@example.com',
    `ACCOUNT_2_PASSWORD=${FAKE_PASSWORD}2`,
    'ACCOUNT_2_PROXY_URL=http://proxy.example.com',
    'ACCOUNT_2_PROXY_PORT=8080',
    'ACCOUNT_2_PROXY_USERNAME=proxyuser-test',
    'ACCOUNT_2_PROXY_PASSWORD=proxypass-test-only',
    'UNRELATED_SETTING=must-not-be-forwarded',
    ''
].join('\n')

export interface EngineFixture {
    readonly dir: string
    readonly engineRoot: string
    readonly accountsFile: string
    readonly userData: string
}

export interface FixtureOptions {
    readonly built?: boolean
    readonly config?: boolean
}

// A copy of the REAL engine API scripts + a fake bot entry (see fake-bot.cjs). The API server is unmodified upstream code.
export function makeFixture(options: FixtureOptions = {}): EngineFixture {
    const dir = mkdtempSync(join(tmpdir(), 'rf-test-'))
    const engineRoot = join(dir, 'engine')
    mkdirSync(engineRoot, { recursive: true })
    cpSync(join(REAL_ENGINE, 'scripts'), join(engineRoot, 'scripts'), { recursive: true })
    cpSync(join(REAL_ENGINE, 'package.json'), join(engineRoot, 'package.json'))
    cpSync(join(REAL_ENGINE, 'config.example.json'), join(engineRoot, 'config.example.json'))
    if (options.built !== false) {
        mkdirSync(join(engineRoot, 'dist'), { recursive: true })
        writeFileSync(
            join(engineRoot, 'dist', 'index.js'),
            '// placeholder: API_RUN_COMMAND points at the fake bot in tests\n'
        )
    }
    if (options.config !== false)
        cpSync(join(REAL_ENGINE, 'config.example.json'), join(engineRoot, 'config.json'))
    const accountsFile = join(dir, 'accounts.env')
    writeFileSync(accountsFile, FAKE_ACCOUNTS_ENV)
    const userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    return { dir, engineRoot, accountsFile, userData }
}

export interface Harness {
    readonly fx: EngineFixture
    readonly farmer: FarmerService
    readonly supervisor: EngineSupervisor
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    readonly settings: AppSettingsStore
    readonly redactor: Redactor
    readonly clock: { now: number }
    picked: string | null
    cleanup(): Promise<void>
}

export interface HarnessOptions extends FixtureOptions {
    readonly botMode?: 'run' | 'finish' | 'fail'
    readonly botCommand?: string
    readonly maxAutoRestarts?: number
    readonly fixture?: EngineFixture
    readonly startTime?: number
    readonly onShutdownRequested?: () => void
    readonly defaultAccountsPath?: string
}

export function makeHarness(options: HarnessOptions = {}): Harness {
    const fx = options.fixture ?? makeFixture(options)
    const redactor = new Redactor()
    const redact = (t: string) => redactor.redact(t)
    const logsDir = join(fx.userData, 'logs')
    const appLog = new JsonlLog(logsDir, 'app.log', 'app', redact)
    const audit = new JsonlLog(logsDir, 'audit.log', 'audit', redact)
    const settings = new AppSettingsStore(fx.userData)
    const clock = { now: options.startTime ?? Date.now() }
    const supervisor = new EngineSupervisor({
        engineRoot: fx.engineRoot,
        nodeCommand: process.execPath,
        redact,
        log: (level, message) => appLog.write({ level, component: 'EngineSupervisor', message }),
        extraEnv: {
            API_RUN_COMMAND: options.botCommand ?? process.execPath,
            API_RUN_ARGS: JSON.stringify([FAKE_BOT]),
            FAKE_BOT_MODE: options.botMode ?? 'run',
            API_STOP_TIMEOUT_MS: '3000'
        },
        healthTimeoutMs: 15000,
        maxAutoRestarts: options.maxAutoRestarts ?? 3,
        restartDelayMs: 100,
        shutdownGraceMs: 8000
    })
    const harness: Harness = {
        fx,
        farmer: undefined as unknown as FarmerService,
        supervisor,
        audit,
        appLog,
        settings,
        redactor,
        clock,
        picked: fx.accountsFile,
        async cleanup() {
            await harness.farmer.dispose().catch(() => undefined)
            await supervisor.stop().catch(() => undefined)
            rmSync(fx.dir, { recursive: true, force: true })
        }
    }
    const farmer = new FarmerService({
        engineRoot: fx.engineRoot,
        settings,
        supervisor,
        audit,
        appLog,
        redactor,
        pickAccountsFile: () => Promise.resolve(harness.picked),
        ...(options.defaultAccountsPath !== undefined
            ? { defaultAccountsPath: options.defaultAccountsPath }
            : {}),
        ...(options.onShutdownRequested !== undefined
            ? { onShutdownRequested: options.onShutdownRequested }
            : {}),
        pollIdleMs: 300,
        pollActiveMs: 100,
        schedulerTickMs: 20,
        now: () => clock.now
    })
    ;(harness as { farmer: FarmerService }).farmer = farmer
    return harness
}

export async function waitFor<T>(
    fn: () => T | Promise<T>,
    ok: (v: T) => boolean,
    what: string,
    timeoutMs = 20000
): Promise<T> {
    const end = Date.now() + timeoutMs
    let last: T | undefined
    while (Date.now() < end) {
        last = await fn()
        if (ok(last)) return last
        await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`Timed out waiting for: ${what}. Last value: ${JSON.stringify(last)}`)
}

export function readLog(h: Harness, file: 'app.log' | 'audit.log'): string {
    const p = join(h.fx.userData, 'logs', file)
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
}
