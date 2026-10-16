import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, writeFile, constants as fsConstants } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isValidTime } from '../shared/farmer-types'
import type {
    ActionResult,
    ErrorCode,
    FarmerNotice,
    FarmerState,
    LastExit,
    PersistedSettings,
    RunPhase
} from '../shared/farmer-types'
import type { AppSettingsStore } from './appSettings'
import { AppError } from './engine/apiClient'
import type { EngineApi } from './engine/apiClient'
import type { EditOutcome } from './accounts'
import { loadAccountsFile } from './engine/envFile'
import type { ParsedAccountsFile } from './engine/envFile'
import type { Redactor } from './engine/redact'
import { repairConfigFile } from './configRepair'
import { buildHomeNumbers, latestActivity, parsePhase, statusLastExit } from './engine/snapshot'
import type { HomeNumbers } from './engine/snapshot'
import type { EngineSupervisor } from './engine/supervisor'
import { isProcessAlive, killTree } from './engine/supervisor'
import type { JsonlLog } from './jsonlLog'
import { Scheduler } from './scheduler'

// The Home / Farmer service (docs/architecture.md sections 2, 4, 7). Everything shown on the Home screen comes
// from here, and every number is real engine data or null. No renderer string is ever used as a file path.

export interface FarmerDeps {
    readonly engineRoot: string
    readonly settings: AppSettingsStore
    readonly supervisor: EngineSupervisor
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    readonly redactor: Redactor
    // Opens the OS file dialog (Electron `dialog` in production). Returns null when the user cancels.
    readonly pickAccountsFile: () => Promise<string | null>
    // Where the app creates its own accounts file when none was ever chosen (production: <app data>/accounts.env).
    readonly defaultAccountsPath?: string
    // Called after a run that finished without errors when "Shutdown" is on. In production this closes the app.
    readonly onShutdownRequested?: () => void
    readonly pollIdleMs?: number
    readonly pollActiveMs?: number
    readonly schedulerTickMs?: number
    readonly now?: () => number
}

type Busy = 'starting' | 'stopping' | 'picking' | 'engine' | null
type Listener = (state: FarmerState) => void

const ACTIVE: readonly RunPhase[] = ['starting', 'running', 'stopping']

// The file the app creates for itself. Comment lines only: no account, no fake value.
export const DEFAULT_ACCOUNTS_TEXT = [
    '# Rewards Farmer LUCK - accounts file. The app created this file for you.',
    '# Add your accounts on the Accounts page of the app. You do not have to edit this file by hand.',
    '# Passwords are stored in this file on THIS computer only. Never send it to anyone and never paste it into a chat.',
    '# One account looks like: ACCOUNT_1_EMAIL=...  and  ACCOUNT_1_PASSWORD=...',
    ''
].join('\n')

interface StartBlock {
    readonly code: ErrorCode
    readonly message: string
}

const EMPTY_NUMBERS: HomeNumbers = {
    account: null,
    points: null,
    proxy: null,
    all: null,
    finished: null,
    failed: null
}

export class FarmerService {
    private readonly listeners = new Set<Listener>()
    private readonly scheduler: Scheduler
    private settingsNotice: string | null = null
    private accountsFile: ParsedAccountsFile | null = null
    private accountsStatus: 'not-set' | 'ok' | 'error' = 'not-set'
    private accountsError: string | null = null
    // True when the app's own accounts file exists but has no account in it yet (the user has not added one).
    private accountsEmpty = false
    private busy: Busy = null
    // Phase 21: true while a restore or an undo holds the app (see runRestoreExclusive).
    private restoring = false
    private phase: RunPhase = 'unknown'
    private startedAt: string | null = null
    private lastExit: LastExit | null = null
    /** Set while a requested run has not been seen ending. A start that fails at once (for example the bot cannot be launched)
     *  can go starting -> idle between two refreshes; without this the app would never report it. `at` is the exit time that was
     *  already known when the run was requested, so an old exit is never mistaken for the new one. */
    private pendingRun: { at: string | null } | null = null
    private numbers: HomeNumbers = EMPTY_NUMBERS
    private section: string | null = null
    private detail: string | null = null
    private lastBotPid: number | null = null
    private stopRequested = false
    private runNotice: FarmerNotice | null = null
    private timerNotice: FarmerNotice | null = null
    private pollTimer: NodeJS.Timeout | null = null
    private refreshing = false
    private disposed = false
    private lastKey = ''

    constructor(private readonly deps: FarmerDeps) {
        this.scheduler = new Scheduler({
            now: deps.now ?? Date.now,
            tickMs: deps.schedulerTickMs ?? 1000,
            onFire: (info) => void this.onTimerFire(info.scheduledFor),
            onMissed: (info) => this.onTimerMissed(info.scheduledFor, info.lateByMs)
        })
        deps.supervisor.on('change', () => this.emit())
        deps.supervisor.on('unexpected-exit', () => this.onEngineCrashed())
    }

    // ---- lifecycle -----------------------------------------------------------------------------------------

    async init(): Promise<void> {
        const loaded = await this.deps.settings.load()
        this.settingsNotice = loaded.notice
        this.log('info', 'FarmerService', 'init')
        const s = loaded.settings
        if (s.accountsPath !== null) await this.applyAccountsPath(s.accountsPath, 'startup')
        else await this.ensureDefaultAccountsFile()
        this.scheduler.configure(s.timerEnabled, s.timerTime)
        this.schedulePoll()
        this.emit()
    }

    async dispose(): Promise<void> {
        this.disposed = true
        if (this.pollTimer !== null) clearTimeout(this.pollTimer)
        this.scheduler.dispose()
        this.audit('quit', 'info', 'ok', 'App is closing; engine is being stopped.')
        await this.deps.supervisor.stop()
        // The engine stops its own bot on /shutdown. If the bot is still alive (engine had to be killed), kill it too.
        if (this.lastBotPid !== null && isProcessAlive(this.lastBotPid)) {
            killTree(this.lastBotPid)
            this.audit(
                'quit',
                'warn',
                'killed-bot',
                'Bot process was still alive after engine shutdown and was killed.'
            )
        }
        await Promise.all([this.deps.audit.flush(), this.deps.appLog.flush()])
    }

    onChange(listener: Listener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    // ---- state -----------------------------------------------------------------------------------------------

    getState(): FarmerState {
        const sup = this.deps.supervisor.snapshot()
        const block = this.startBlock()
        return {
            engine: { link: sup.link, detail: sup.detail, version: sup.version },
            accounts: {
                path: this.deps.settings.value.accountsPath,
                status: this.accountsStatus,
                error: this.accountsError,
                count: this.accountsEmpty ? 0 : (this.accountsFile?.accountCount ?? null)
            },
            run: { phase: this.phase, startedAt: this.startedAt, lastExit: this.lastExit },
            // "Current account" means the account being processed right now. When no run is active the honest value
            // is "none" (screenshot 1 shows "Current account: None" when idle), not the last account of an old run.
            current:
                this.phase === 'idle'
                    ? { account: null, points: null, section: null, detail: null, proxy: null }
                    : {
                          account: this.numbers.account,
                          points: this.numbers.points,
                          section: this.section,
                          detail: this.detail,
                          proxy: this.numbers.proxy
                      },
            summary: { all: this.numbers.all, finished: this.numbers.finished, failed: this.numbers.failed },
            timer: this.scheduler.state(),
            startDisabledReason: block === null ? null : block.message,
            stopDisabledReason: this.stopDisabledReason(),
            notices: this.buildNotices(),
            updatedAt: new Date().toISOString()
        }
    }

    private emit(): void {
        const state = this.getState()
        const { updatedAt: _ignored, ...rest } = state
        void _ignored
        const key = JSON.stringify(rest)
        if (key === this.lastKey) return
        this.lastKey = key
        for (const l of this.listeners) l(state)
    }

    private engineBuilt(): boolean {
        return existsSync(join(this.deps.engineRoot, 'dist', 'index.js'))
    }
    private engineExists(): boolean {
        return existsSync(join(this.deps.engineRoot, 'scripts', 'api', 'server.js'))
    }
    private configExists(): boolean {
        return existsSync(join(this.deps.engineRoot, 'config.json'))
    }

    // First reason that blocks Start, or null. Order matters: the user fixes the first thing first.
    private startBlock(): StartBlock | null {
        const link = this.deps.supervisor.snapshot().link
        if (this.busy === 'starting') return { code: 'RUN_ACTIVE', message: 'Starting...' }
        if (this.busy === 'stopping') return { code: 'RUN_ACTIVE', message: 'Stopping...' }
        if (this.busy === 'picking' || this.busy === 'engine')
            return { code: 'RUN_ACTIVE', message: 'Please wait, the engine is being prepared.' }
        if (this.accountsStatus === 'not-set')
            return { code: 'ACCOUNTS_NOT_SET', message: 'Choose an accounts file first (Open).' }
        if (this.accountsEmpty)
            return { code: 'ACCOUNTS_NOT_SET', message: 'Add your first account on the Accounts page.' }
        if (this.accountsStatus === 'error')
            return {
                code: 'ACCOUNTS_INVALID',
                message: `Accounts file problem: ${this.accountsError ?? 'unknown'}`
            }
        if (!this.engineExists())
            return {
                code: 'ENGINE_MISSING',
                message:
                    'Engine folder not found. Close this app and double-click START.bat. It offers to download the engine files.'
            }
        if (!this.engineBuilt())
            return {
                code: 'ENGINE_NOT_BUILT',
                message:
                    'Engine is not built yet. Close this app and double-click START.bat. It builds the engine.'
            }
        if (!this.configExists())
            return {
                code: 'CONFIG_MISSING',
                message: 'Engine config.json is missing. Use "Create config" above.'
            }
        if (link !== 'ready') return { code: 'ENGINE_DOWN', message: `Engine API is not ready (${link}).` }
        if (this.phase === 'unknown')
            return { code: 'ENGINE_DOWN', message: 'Engine state unknown: the engine API is not reachable.' }
        if (ACTIVE.includes(this.phase))
            return { code: 'RUN_ACTIVE', message: `A run is already ${this.phase}.` }
        return null
    }

    private stopDisabledReason(): string | null {
        if (this.busy === 'stopping' || this.phase === 'stopping') return 'Already stopping...'
        if (this.phase === 'starting' || this.phase === 'running') return null
        if (this.phase === 'unknown') return 'Engine state unknown: the engine API is not reachable.'
        return 'No run in progress.'
    }

    private buildNotices(): FarmerNotice[] {
        const out: FarmerNotice[] = []
        const sup = this.deps.supervisor.snapshot()
        if (this.settingsNotice !== null)
            out.push({ id: 'settings', severity: 'warning', message: this.settingsNotice })
        if (this.accountsStatus === 'error' && this.accountsError !== null)
            out.push({ id: 'accounts', severity: 'error', message: `Accounts file: ${this.accountsError}` })
        if (!this.engineExists()) {
            out.push({
                id: 'engine-missing',
                severity: 'error',
                message:
                    'Engine folder not found. Close this app and double-click START.bat. It offers to download the engine files.'
            })
        } else {
            if (!this.engineBuilt())
                out.push({
                    id: 'engine-not-built',
                    severity: 'warning',
                    message:
                        'Engine is not built yet. Close this app and double-click START.bat. It builds the engine.'
                })
            if (!this.configExists())
                out.push({
                    id: 'config-missing',
                    severity: 'warning',
                    message: 'Engine config.json is missing.',
                    action: 'create-config'
                })
        }
        if (sup.link === 'failed' || sup.link === 'down')
            out.push({
                id: 'engine-link',
                severity: sup.link === 'failed' ? 'error' : 'warning',
                message: sup.detail ?? 'The engine API is not running.',
                ...(sup.link === 'failed' ? { action: 'restart-engine' as const } : {})
            })
        if (this.runNotice !== null) out.push(this.runNotice)
        if (this.timerNotice !== null) out.push(this.timerNotice)
        const logErr = this.deps.audit.lastError
        if (logErr !== null)
            out.push({
                id: 'audit-log',
                severity: 'warning',
                message: `The audit log cannot be written (${logErr}).`
            })
        return out
    }

    // ---- logging -----------------------------------------------------------------------------------------------

    private log(level: 'info' | 'warn' | 'error', component: string, message: string, corrId?: string): void {
        this.deps.appLog.write({ level, component, message, ...(corrId === undefined ? {} : { corrId }) })
    }

    private audit(
        action: string,
        level: 'info' | 'warn' | 'error',
        result: string,
        message: string,
        corrId?: string
    ): void {
        this.deps.audit.write({
            level,
            component: 'Farmer',
            action,
            result,
            message,
            ...(corrId === undefined ? {} : { corrId })
        })
    }

    private fail(action: string, corrId: string, code: ErrorCode, message: string): ActionResult {
        this.audit(action, 'warn', code, message, corrId)
        return { ok: false, code, message }
    }

    // First use: when no accounts file was ever chosen, the app creates its own (an .env file with no account in it) in the
    // app data folder, so the Accounts page works at once and nothing has to be created by hand. An existing file is NEVER
    // overwritten (rule 10): if the file is already there it is just used. Fake accounts are never written (rule 3).
    private async ensureDefaultAccountsFile(): Promise<void> {
        const path = this.deps.defaultAccountsPath
        if (path === undefined) return
        const corrId = randomUUID()
        let created = false
        try {
            await mkdir(dirname(path), { recursive: true })
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
            this.audit(
                'accounts-auto-create',
                'warn',
                'WRITE_FAILED',
                `Could not create the accounts file (${code}).`,
                corrId
            )
            return
        }
        try {
            await writeFile(path, DEFAULT_ACCOUNTS_TEXT, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
            created = true
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
                this.audit(
                    'accounts-auto-create',
                    'warn',
                    'WRITE_FAILED',
                    `Could not create the accounts file (${code}).`,
                    corrId
                )
                return
            }
        }
        await this.applyAccountsPath(path, 'startup', corrId)
        if (this.accountsStatus === 'error') return
        await this.deps.settings.update({ accountsPath: path }).catch((error: unknown) => {
            this.log(
                'error',
                'FarmerService',
                `settings write failed: ${error instanceof Error ? error.message : String(error)}`
            )
        })
        this.audit(
            'accounts-auto-create',
            'info',
            'ok',
            created
                ? 'Accounts file created in the app data folder (no account in it).'
                : 'Existing accounts file in the app data folder is used.',
            corrId
        )
    }

    // ---- accounts file -----------------------------------------------------------------------------------------

    private async applyAccountsPath(
        path: string,
        source: 'pick' | 'startup',
        corrId = randomUUID()
    ): Promise<ActionResult> {
        const result = await loadAccountsFile(path)
        this.accountsEmpty = false
        if (
            !result.ok &&
            result.empty === true &&
            source === 'startup' &&
            path === this.deps.defaultAccountsPath
        ) {
            // The file the app created itself, with no account in it yet. (A file the user chose is different: if it has no account it
            // is reported as a problem, because it may be the wrong file.) Not an error: the Accounts
            // page can add the first account. The engine is not started until there is one.
            this.accountsFile = null
            this.accountsStatus = 'ok'
            this.accountsError = null
            this.accountsEmpty = true
            return { ok: true, message: 'The accounts file has no account yet.' }
        }
        if (!result.ok) {
            if (source === 'startup') {
                // The saved file is gone or broken: keep the path visible so the user sees what is wrong.
                this.accountsFile = null
                this.accountsStatus = 'error'
                this.accountsError = result.message
            }
            return this.fail('accounts-file', corrId, 'ACCOUNTS_INVALID', result.message)
        }
        this.accountsFile = result.file
        this.accountsStatus = 'ok'
        this.accountsError = null
        for (const secret of result.file.secretValues) this.deps.redactor.add(secret)
        this.busy = 'engine'
        this.emit()
        try {
            const started = await this.deps.supervisor.start(result.file.vars)
            this.audit(
                'accounts-file',
                started.ok ? 'info' : 'error',
                started.ok ? 'ok' : (started.code ?? 'ENGINE_START_FAILED'),
                `Accounts file ready (${String(result.file.accountCount)} accounts). Engine ${started.ok ? 'started' : 'did not start'}.`,
                corrId
            )
            await this.refresh()
            return started.ok
                ? { ok: true, message: `${String(result.file.accountCount)} account(s) found.` }
                : started
        } finally {
            this.busy = null
            this.emit()
        }
    }

    async pickAccounts(): Promise<{ cancelled: boolean; result: ActionResult }> {
        const corrId = randomUUID()
        if (this.busy !== null || ACTIVE.includes(this.phase)) {
            return {
                cancelled: false,
                result: this.fail(
                    'pick-accounts',
                    corrId,
                    'RUN_ACTIVE',
                    'The accounts file cannot be changed while a run is active or the engine is busy.'
                )
            }
        }
        this.busy = 'picking'
        this.emit()
        let path: string | null
        try {
            path = await this.deps.pickAccountsFile()
        } finally {
            this.busy = null
        }
        if (path === null) {
            this.emit()
            return { cancelled: true, result: { ok: true, message: 'Cancelled.' } }
        }
        const result = await this.applyAccountsPath(path, 'pick', corrId)
        if (result.ok) {
            await this.deps.settings.update({ accountsPath: path }).catch((error: unknown) => {
                this.log(
                    'error',
                    'FarmerService',
                    `settings write failed: ${error instanceof Error ? error.message : String(error)}`
                )
            })
        }
        this.emit()
        return { cancelled: false, result }
    }

    // null = the setup wizard may change files and settings now (Phase 22). A string = why not. Same rule as every other edit:
    // never during a run, never while the engine is starting or stopping.
    wizardBlock(): string | null {
        if (this.busy !== null) return 'The app is busy (engine starting or stopping). Try again in a moment.'
        if (ACTIVE.includes(this.phase))
            return 'A run is active. Stop it first: the setup cannot change files during a run.'
        return null
    }

    // Phase 22: the wizard says "use this accounts file". The path comes from the main process only (the app's own file or the
    // OS file dialog), never from the screen. The app's own file is created empty when it is missing (never overwritten, rule 10);
    // any other file must already exist and load. The chosen path is saved only after the file loaded.
    async useAccountsFile(path: string): Promise<ActionResult> {
        const corrId = randomUUID()
        const block = this.wizardBlock()
        if (block !== null) return this.fail('wizard-accounts', corrId, 'RUN_ACTIVE', block)
        const isDefault =
            this.deps.defaultAccountsPath !== undefined && path === this.deps.defaultAccountsPath
        if (isDefault && !existsSync(path)) {
            await this.ensureDefaultAccountsFile()
            if (!existsSync(path) || this.accountsStatus === 'error') {
                return this.fail(
                    'wizard-accounts',
                    corrId,
                    'WRITE_FAILED',
                    this.accountsError ?? 'The accounts file could not be created in the app data folder.'
                )
            }
            this.emit()
            return { ok: true, message: "The app's own accounts file was created (no account in it yet)." }
        }
        const result = await this.applyAccountsPath(path, isDefault ? 'startup' : 'pick', corrId)
        if (!result.ok) {
            this.emit()
            return result
        }
        try {
            await this.deps.settings.update({ accountsPath: path })
        } catch (error) {
            return this.fail(
                'wizard-accounts',
                corrId,
                'WRITE_FAILED',
                `The accounts file works, but the choice could not be saved (${error instanceof Error ? error.message : 'unknown error'}).`
            )
        }
        this.emit()
        return result
    }

    // ---- accounts screen (Phase 7) -----------------------------------------------------------------------------

    accountsPath(): string | null {
        return this.deps.settings.value.accountsPath
    }

    // null = the accounts file may be edited now. A string = why not (shown on the disabled controls, rule 17).
    accountsEditBlock(): string | null {
        if (this.busy !== null) return 'The app is busy (engine starting or stopping). Try again in a moment.'
        if (ACTIVE.includes(this.phase))
            return 'A run is active. Stop it first: accounts cannot change during a run.'
        if (this.deps.settings.value.accountsPath === null) {
            return 'No accounts file chosen yet. Choose it on Home (Accounts Path / Open).'
        }
        return null
    }

    // null = a restore may be checked and prepared now (Phase 20). A string = why not. Same rule as every file edit: never while
    // a run is active or the engine is starting or stopping. While the restore itself holds the lock (Phase 21) the busy mark
    // is its own, so it does not block itself.
    restoreBlock(): string | null {
        if (!this.restoring && this.busy !== null)
            return 'The app is busy (engine starting or stopping). Try again in a moment.'
        if (ACTIVE.includes(this.phase))
            return 'A run is active. Stop it first: files cannot be restored during a run.'
        return null
    }

    // Phase 21: runs one restore or one undo while the app is marked busy, so Start, account edits and settings edits are refused
    // until it is over and nothing else can write the files at the same time. `refused` builds the answer when the app is not
    // free (a run is active, the engine is starting or stopping, or another restore is running).
    async runRestoreExclusive<T>(work: () => Promise<T>, refused: (why: string) => T): Promise<T> {
        const why = this.restoring ? 'Another restore or undo is running.' : this.restoreBlock()
        if (why !== null) return refused(why)
        this.restoring = true
        this.busy = 'engine'
        this.emit()
        try {
            return await work()
        } finally {
            this.restoring = false
            this.busy = null
            this.emit()
        }
    }

    // Phase 21: after a restore or an undo changed files, the app reads them again: app settings (theme, timer, accounts file
    // place), then the accounts file, and the engine is restarted on them, so nothing keeps working with an old copy in memory.
    // Returns a plain remark for the user. Called inside runRestoreExclusive.
    async reloadAfterRestore(): Promise<string | null> {
        const loaded = await this.deps.settings.load()
        this.settingsNotice = loaded.notice
        const s = loaded.settings
        this.scheduler.configure(s.timerEnabled, s.timerTime)
        let result: ActionResult
        if (s.accountsPath !== null) {
            result = await this.applyAccountsPath(s.accountsPath, 'startup')
        } else {
            await this.ensureDefaultAccountsFile()
            result = { ok: true, message: '' }
        }
        this.audit(
            'restore-reload',
            result.ok ? 'info' : 'warn',
            result.ok ? 'ok' : (result.code ?? 'ENGINE_ERROR'),
            'Settings and accounts were read again after a restore or an undo.',
            randomUUID()
        )
        await this.refresh()
        return result.ok
            ? 'The app read the changed files again and restarted the engine on them.'
            : `The app read the changed files again, but: ${result.message}`
    }

    // null = engine settings (config.json) may be changed now. A string = why not (shown on the disabled controls, rule 17).
    // Settings apply from the next run, so a change during a run would only confuse: it is refused.
    settingsEditBlock(): string | null {
        if (this.busy !== null) return 'The app is busy (engine starting or stopping). Try again in a moment.'
        if (ACTIVE.includes(this.phase))
            return 'A run is active. Stop it first: settings apply from the next run.'
        if (this.deps.supervisor.api === null)
            return 'The engine is not ready, so the settings cannot be saved. See the notice on Home.'
        return null
    }

    engineApi(): EngineApi | null {
        return this.deps.supervisor.api
    }

    // Runs one config.json change while the app is marked busy, so Start / Stop / account edits cannot overlap with it.
    async editEngineConfig(work: () => Promise<ActionResult>): Promise<ActionResult> {
        const block = this.settingsEditBlock()
        if (block !== null) {
            return {
                ok: false,
                code: ACTIVE.includes(this.phase) ? 'RUN_ACTIVE' : 'ENGINE_DOWN',
                message: block
            }
        }
        this.busy = 'engine'
        this.emit()
        try {
            return await work()
        } finally {
            this.busy = null
            this.emit()
        }
    }

    // Runs one accounts-file change while the app is marked busy, then restarts the engine on the changed file so the
    // engine never works with an old copy of the accounts. `work` does the file change and writes its own audit line.
    async editAccounts(work: (path: string) => Promise<EditOutcome>): Promise<ActionResult> {
        const corrId = randomUUID()
        const path = this.deps.settings.value.accountsPath
        const block = this.accountsEditBlock()
        if (block !== null || path === null) {
            return this.fail(
                'accounts-edit',
                corrId,
                path === null ? 'ACCOUNTS_NOT_SET' : 'RUN_ACTIVE',
                block ?? 'No accounts file chosen yet.'
            )
        }
        this.busy = 'engine'
        this.emit()
        try {
            const outcome = await work(path)
            if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message }
            const reload = await this.reloadAccountsFile(path, corrId)
            return reload.ok
                ? outcome
                : {
                      ok: true,
                      message: `${outcome.message} The engine did not restart on the new file: ${reload.message}`
                  }
        } finally {
            this.busy = null
            this.emit()
        }
    }

    // Read the (just changed) accounts file again and restart the engine with it. When the file is no longer usable
    // (for example the last account was removed) the engine is stopped, so it cannot keep running with old accounts.
    private async reloadAccountsFile(path: string, corrId: string): Promise<ActionResult> {
        const result = await loadAccountsFile(path)
        this.accountsEmpty = false
        if (!result.ok) {
            this.accountsFile = null
            this.accountsStatus = 'error'
            this.accountsError = result.message
            await this.deps.supervisor.stop()
            await this.refresh()
            return this.fail('accounts-file', corrId, 'ACCOUNTS_INVALID', result.message)
        }
        this.accountsFile = result.file
        this.accountsStatus = 'ok'
        this.accountsError = null
        for (const secret of result.file.secretValues) this.deps.redactor.add(secret)
        const started = await this.deps.supervisor.start(result.file.vars)
        this.audit(
            'accounts-file',
            started.ok ? 'info' : 'error',
            started.ok ? 'ok' : (started.code ?? 'ENGINE_START_FAILED'),
            `Accounts file reloaded after a change (${String(result.file.accountCount)} accounts). Engine ${started.ok ? 'restarted' : 'did not start'}.`,
            corrId
        )
        await this.refresh()
        return started
    }

    // ---- run control -------------------------------------------------------------------------------------------

    async startRun(source: 'user' | 'timer' = 'user'): Promise<ActionResult> {
        const corrId = randomUUID()
        const block = this.startBlock()
        if (block !== null) return this.fail('start', corrId, block.code, block.message)
        const api = this.deps.supervisor.api
        if (api === null) return this.fail('start', corrId, 'ENGINE_DOWN', 'The engine API is not ready.')

        this.busy = 'starting' // duplicate-start guard: a second click or the timer sees `busy` and is refused
        this.emit()
        try {
            const exitBefore = this.lastExit?.at ?? null
            await api.start({})
            this.pendingRun = { at: exitBefore }
            this.stopRequested = false
            this.runNotice = null
            this.phase = 'starting'
            this.audit('start', 'info', 'ok', `Run requested (${source}). POST /start -> 202.`, corrId)
            this.log('info', 'FarmerService', `run requested (${source})`, corrId)
            await this.refresh()
            return { ok: true, message: 'Run started.' }
        } catch (error) {
            const app = toAppError(error)
            if (app.code === 'RUN_ACTIVE') await this.refresh() // engine says a run exists: show the truth
            return this.fail('start', corrId, app.code, app.message)
        } finally {
            this.busy = null
            this.emit()
        }
    }

    async stopRun(): Promise<ActionResult> {
        const corrId = randomUUID()
        const reason = this.stopDisabledReason()
        if (reason !== null)
            return this.fail('stop', corrId, this.phase === 'unknown' ? 'ENGINE_DOWN' : 'NOT_RUNNING', reason)
        const api = this.deps.supervisor.api
        if (api === null) return this.fail('stop', corrId, 'ENGINE_DOWN', 'The engine API is not ready.')
        this.busy = 'stopping'
        this.stopRequested = true
        this.emit()
        try {
            await api.stop()
            this.audit('stop', 'info', 'ok', 'Stop requested. POST /stop -> 202.', corrId)
            await this.refresh()
            return { ok: true, message: 'Stopping...' }
        } catch (error) {
            const app = toAppError(error)
            if (app.code !== 'NOT_RUNNING') this.stopRequested = false
            await this.refresh()
            return this.fail('stop', corrId, app.code, app.message)
        } finally {
            this.busy = null
            this.emit()
        }
    }

    async restartEngine(): Promise<ActionResult> {
        const corrId = randomUUID()
        if (ACTIVE.includes(this.phase) || this.busy !== null)
            return this.fail('restart-engine', corrId, 'RUN_ACTIVE', 'Stop the run first.')
        if (this.accountsFile === null)
            return this.fail(
                'restart-engine',
                corrId,
                'ACCOUNTS_NOT_SET',
                'Choose a valid accounts file first.'
            )
        this.busy = 'engine'
        this.emit()
        try {
            const res = await this.deps.supervisor.start(this.accountsFile.vars)
            this.audit(
                'restart-engine',
                res.ok ? 'info' : 'error',
                res.ok ? 'ok' : (res.code ?? 'ENGINE_START_FAILED'),
                res.message,
                corrId
            )
            await this.refresh()
            return res
        } finally {
            this.busy = null
            this.emit()
        }
    }

    // Copies config.example.json to config.json, ONLY if config.json does not exist (rule 10: never overwrite).
    async createConfig(): Promise<ActionResult> {
        const corrId = randomUUID()
        const target = join(this.deps.engineRoot, 'config.json')
        const source = join(this.deps.engineRoot, 'config.example.json')
        if (existsSync(target))
            return this.fail(
                'create-config',
                corrId,
                'BAD_REQUEST',
                'config.json already exists. It was not changed.'
            )
        try {
            await copyFile(source, target, fsConstants.COPYFILE_EXCL)
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            return this.fail(
                'create-config',
                corrId,
                'WRITE_FAILED',
                `Could not create config.json (${code ?? 'unknown error'}).`
            )
        }
        this.audit('create-config', 'info', 'ok', 'config.json created from config.example.json.', corrId)
        this.emit()
        return { ok: true, message: 'config.json created from the engine example.' }
    }

    // Repairs a broken config.json: keeps a copy, keeps the settings that still have a good value (docs: troubleshooting guide).
    async repairConfig(): Promise<ActionResult> {
        const corrId = randomUUID()
        if (ACTIVE.includes(this.phase) || this.busy !== null)
            return this.fail(
                'repair-config',
                corrId,
                'RUN_ACTIVE',
                'Stop the run first. The config is not changed during a run.'
            )
        if (!this.engineExists())
            return this.fail('repair-config', corrId, 'ENGINE_MISSING', 'The engine folder was not found.')
        this.busy = 'engine'
        this.emit()
        try {
            const out = await repairConfigFile(this.deps.engineRoot)
            if (!out.ok) return this.fail('repair-config', corrId, out.code ?? 'WRITE_FAILED', out.message)
            this.audit(
                'repair-config',
                'info',
                'ok',
                `config.json repaired; copy saved as ${out.backupName ?? 'unknown'}.`,
                corrId
            )
            // The engine reads config.json when it starts: start it again so it uses the repaired file.
            let tail = ''
            if (this.accountsFile !== null) {
                const res = await this.deps.supervisor.start(this.accountsFile.vars)
                tail = res.ok
                    ? ' The engine was restarted.'
                    : ' The engine could not be restarted; press "Restart engine" on the Home page.'
            }
            await this.refresh()
            return { ok: true, message: `${out.message}${tail}` }
        } finally {
            this.busy = null
            this.emit()
        }
    }

    // ---- shutdown after run ------------------------------------------------------------------------------------

    async setShutdownAfterRun(enabled: boolean): Promise<ActionResult> {
        const corrId = randomUUID()
        try {
            await this.deps.settings.update({ shutdownAfterRun: enabled })
        } catch (error) {
            return this.fail(
                'set-shutdown',
                corrId,
                'WRITE_FAILED',
                `Could not save the Shutdown setting (${error instanceof Error ? error.message : 'unknown error'}).`
            )
        }
        this.audit('set-shutdown', 'info', 'ok', `Shutdown after run ${enabled ? 'on' : 'off'}.`, corrId)
        return {
            ok: true,
            message: enabled
                ? 'Shutdown on: this app closes after a run that finished without errors.'
                : 'Shutdown off.'
        }
    }

    // ---- timer -------------------------------------------------------------------------------------------------

    async setTimer(enabled: boolean, time: string): Promise<ActionResult> {
        const corrId = randomUUID()
        if (!isValidTime(time))
            return this.fail('set-timer', corrId, 'INVALID_TIME', 'Time must be HH:MM (24 hours).')
        try {
            await this.deps.settings.update({ timerEnabled: enabled, timerTime: time })
        } catch (error) {
            return this.fail(
                'set-timer',
                corrId,
                'WRITE_FAILED',
                `Could not save the timer (${error instanceof Error ? error.message : 'unknown error'}).`
            )
        }
        this.scheduler.configure(enabled, time)
        this.timerNotice = null
        this.audit('set-timer', 'info', 'ok', `Timer ${enabled ? 'on' : 'off'}, time ${time}.`, corrId)
        this.emit()
        return {
            ok: true,
            message: enabled ? `Timer on: starts every day at ${time} while this app is open.` : 'Timer off.'
        }
    }

    private async onTimerFire(scheduledFor: string): Promise<void> {
        this.audit('timer-fire', 'info', 'fired', `Timer fired (scheduled ${scheduledFor}).`)
        const res = await this.startRun('timer')
        if (!res.ok) {
            this.timerNotice = {
                id: 'timer',
                severity: 'warning',
                message: `The timer could not start a run: ${res.message}`
            }
            this.emit()
        } else {
            this.timerNotice = null
        }
    }

    private onTimerMissed(scheduledFor: string, lateByMs: number): void {
        const mins = Math.round(lateByMs / 60000)
        this.audit(
            'timer-missed',
            'warn',
            'missed',
            `Timer for ${scheduledFor} missed by ${String(mins)} min (PC asleep or app busy). Not started late.`
        )
        this.timerNotice = {
            id: 'timer',
            severity: 'warning',
            message: `The timer time passed ${String(mins)} minutes ago while the app was not running it. No run was started. The next start is tomorrow.`
        }
        this.emit()
    }

    // ---- polling -----------------------------------------------------------------------------------------------

    private schedulePoll(): void {
        if (this.disposed) return
        const delay = ACTIVE.includes(this.phase)
            ? (this.deps.pollActiveMs ?? 1000)
            : (this.deps.pollIdleMs ?? 5000)
        this.pollTimer = setTimeout(() => {
            void this.refresh().finally(() => this.schedulePoll())
        }, delay)
        this.pollTimer.unref()
    }

    // Pull fresh data from the engine. Public so tests and the UI "refresh" can force it.
    async refresh(): Promise<void> {
        if (this.refreshing) return
        this.refreshing = true
        const before = this.phase
        try {
            const api = this.deps.supervisor.api
            if (api === null) {
                this.phase = 'unknown'
                this.numbers = EMPTY_NUMBERS
                this.section = null
                this.detail = null
                return
            }
            try {
                const [status, points, accounts] = await Promise.all([
                    api.status(),
                    api.points(),
                    api.accounts()
                ])
                const history =
                    points.accounts !== undefined && points.accounts.length > 0
                        ? null
                        : await api.history().catch(() => null)
                this.phase = parsePhase(status.state)
                this.startedAt = typeof status.startedAt === 'string' ? status.startedAt : null
                this.lastExit = statusLastExit(status)
                if (typeof status.pid === 'number') this.lastBotPid = status.pid
                this.numbers = buildHomeNumbers({ points, accounts, history })
                if (this.phase === 'running') {
                    const logs = await api.logs(30).catch(() => null)
                    const act = latestActivity(logs, (s) => this.deps.redactor.redact(s))
                    this.section = act.section
                    this.detail = act.detail
                } else {
                    this.section = null
                    this.detail = null
                }
                if (this.phase === 'idle') this.lastBotPid = null
                if (ACTIVE.includes(this.phase)) this.pendingRun = null // seen active: the normal path reports its end
                const endedUnseen =
                    this.pendingRun !== null &&
                    this.phase === 'idle' &&
                    this.lastExit !== null &&
                    this.lastExit.at !== this.pendingRun.at
                if ((ACTIVE.includes(before) && this.phase === 'idle') || endedUnseen) {
                    this.pendingRun = null
                    await this.onRunEnded(api)
                }
            } catch {
                this.phase = 'unknown'
                this.numbers = EMPTY_NUMBERS
                this.section = null
                this.detail = null
            }
        } finally {
            this.refreshing = false
            this.emit()
        }
    }

    private async onRunEnded(api: NonNullable<EngineSupervisor['api']>): Promise<void> {
        const exit = this.lastExit
        const code = exit?.code ?? null
        if (this.stopRequested) {
            this.runNotice = { id: 'run', severity: 'info', message: 'Run stopped.' }
            this.audit('run-ended', 'info', 'stopped', 'Run stopped by request.')
        } else if (code === 0 && exit?.error === undefined) {
            this.runNotice = { id: 'run', severity: 'info', message: 'Run finished.' }
            this.audit('run-ended', 'info', 'finished', 'Run finished with exit code 0.')
            // "Shutdown" closes this app only after a clean finish: a stop by the user or an error needs the user to look.
            if (this.deps.settings.value.shutdownAfterRun) {
                this.audit(
                    'shutdown-after-run',
                    'info',
                    'requested',
                    'Run finished and Shutdown is on: closing the app.'
                )
                this.deps.onShutdownRequested?.()
            }
        } else {
            const errors = await api.errors(5).catch(() => null)
            // Prefer the bot's own last error line over the API controller's generic "Run finished (code N)".
            const list = errors?.errors ?? []
            const lastErr = (list.filter((e) => e.source !== 'controller').at(-1) ?? list.at(-1))?.message
            const extra =
                typeof lastErr === 'string' && lastErr !== ''
                    ? ` Last engine error: ${this.deps.redactor.redact(lastErr)}`
                    : ''
            const how =
                exit?.error !== undefined
                    ? this.deps.redactor.redact(exit.error)
                    : exit?.signal != null
                      ? `signal ${exit.signal}`
                      : `exit code ${String(code)}`
            this.runNotice = {
                id: 'run',
                severity: 'error',
                message: `The run ended unexpectedly (${how}).${extra}`
            }
            this.audit('run-ended', 'error', 'unexpected-exit', `Run ended unexpectedly (${how}).${extra}`)
        }
        this.stopRequested = false
    }

    private onEngineCrashed(): void {
        const wasActive = ACTIVE.includes(this.phase)
        this.phase = 'unknown'
        this.numbers = EMPTY_NUMBERS
        this.section = null
        this.detail = null
        this.audit('engine-crash', 'error', 'api-exited', 'The engine API process exited unexpectedly.')
        // T8: the API died. A bot it started may still run with nobody controlling it. Stop it.
        if (this.lastBotPid !== null && isProcessAlive(this.lastBotPid)) {
            killTree(this.lastBotPid)
            this.audit(
                'engine-crash',
                'warn',
                'killed-bot',
                `Bot process ${String(this.lastBotPid)} was killed to avoid an orphan.`
            )
            this.runNotice = {
                id: 'run',
                severity: 'error',
                message:
                    'The engine API crashed during a run. The bot process was stopped. The run is incomplete.'
            }
        } else if (wasActive) {
            this.runNotice = {
                id: 'run',
                severity: 'error',
                message: 'The engine API stopped during a run. The run is incomplete.'
            }
        }
        this.lastBotPid = null
        this.stopRequested = false
        this.emit()
    }

    get settings(): PersistedSettings {
        return this.deps.settings.value
    }
}

function toAppError(error: unknown): AppError {
    return error instanceof AppError
        ? error
        : new AppError('ENGINE_ERROR', error instanceof Error ? error.message : 'Unknown error.')
}
