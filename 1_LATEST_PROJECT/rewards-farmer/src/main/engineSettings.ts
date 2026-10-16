import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { buildPatch, changedKeys, extractValues, parseSettingsInput } from '../shared/engine-settings-rules'
import type { EngineSettingsState, EngineSettingsValues } from '../shared/engine-settings-types'
import type { ActionResult, ErrorCode } from '../shared/farmer-types'
import { AppError } from './engine/apiClient'
import type { EngineApi } from './engine/apiClient'
import type { JsonlLog } from './jsonlLog'
import { restrictToCurrentUser } from './privatePerms'

// Settings screen service (Phase 8, docs/requirements-matrix.md B3, B4).
// Reads the REAL config.json through the engine control API (GET /config) and writes ONLY through the engine's own
// validated PATCH /config. This app never edits config.json itself. Before every write a backup copy is made (rule 10).
// Secret fields are not touched here (Phase 9); the engine hides them in GET /config anyway.

export interface EngineSettingsHost {
    api(): EngineApi | null
    // null = Save / Reset allowed. A string = why not.
    editBlock(): string | null
    // Runs one change while the app is marked busy (Start / Stop / account edits refuse meanwhile).
    run(work: () => Promise<ActionResult>): Promise<ActionResult>
}

export interface EngineSettingsDeps {
    readonly host: EngineSettingsHost
    readonly engineRoot: string
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    // Backup copies of config.json. It can hold secrets (webhook tokens), so this stays in the private user-data folder.
    readonly backupDir: string
    readonly now?: () => Date
}

const fail = (code: ErrorCode, message: string): ActionResult => ({ ok: false, code, message })

function isInside(root: string, target: string): boolean {
    const rel = relative(resolve(root), resolve(target))
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function stamp(d: Date): string {
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    return `${String(d.getFullYear())}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}

function describe(values: EngineSettingsValues, keys: readonly string[]): string {
    return keys.map((k) => `${k}=${String(values[k as keyof EngineSettingsValues])}`).join(', ')
}

export class EngineSettingsService {
    private queue: Promise<unknown> = Promise.resolve()
    private lastBackup: Date | null = null

    constructor(private readonly deps: EngineSettingsDeps) {}

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date()
    }

    // ---- read ----------------------------------------------------------------------------------------------------

    private async readDefaults(): Promise<EngineSettingsValues | null> {
        try {
            const text = await readFile(join(this.deps.engineRoot, 'config.example.json'), 'utf8')
            const parsed = extractValues(JSON.parse(text) as unknown, null)
            // The example must contain every mapped field, otherwise it cannot serve as "defaults".
            return parsed.ok && parsed.value.missing.length === 0 ? parsed.value.values : null
        } catch {
            return null
        }
    }

    private async newestBackup(): Promise<string | null> {
        let best: Date | null = this.lastBackup
        try {
            for (const name of await readdir(this.deps.backupDir)) {
                if (!name.endsWith('.json')) continue
                const m = (await stat(join(this.deps.backupDir, name))).mtime
                if (best === null || m > best) best = m
            }
        } catch {
            // no backup folder yet = no backup yet
        }
        return best === null ? null : best.toISOString()
    }

    async getState(): Promise<EngineSettingsState> {
        const updatedAt = this.now().toISOString()
        const defaults = await this.readDefaults()
        const lastBackupAt = await this.newestBackup()
        const base = { defaults, lastBackupAt, updatedAt, values: null, missingKeys: [] } as const
        const api = this.deps.host.api()
        if (api === null) {
            return {
                ...base,
                status: 'unavailable',
                reason: 'The engine is not running, so the real settings cannot be read. Choose your accounts file on Home first: the engine starts after that.',
                editDisabledReason: 'The engine is not ready.'
            }
        }
        try {
            const res = await api.config()
            const parsed = extractValues(res.config, defaults)
            if (!parsed.ok) {
                return {
                    ...base,
                    status: 'error',
                    reason: parsed.message,
                    editDisabledReason: parsed.message
                }
            }
            return {
                ...base,
                status: 'ok',
                reason: null,
                values: parsed.value.values,
                missingKeys: parsed.value.missing,
                editDisabledReason: this.deps.host.editBlock()
            }
        } catch (e) {
            const message = e instanceof AppError ? e.message : 'The settings could not be read.'
            const missing = e instanceof AppError && e.code === 'NOT_FOUND'
            return {
                ...base,
                status: missing ? 'unavailable' : 'error',
                reason: missing ? 'config.json is missing. Use "Create config" on Home first.' : message,
                editDisabledReason: missing ? 'config.json is missing.' : message
            }
        }
    }

    // ---- write ---------------------------------------------------------------------------------------------------

    save(raw: unknown): Promise<ActionResult> {
        const values = parseSettingsInput(raw)
        if (values === null)
            return Promise.resolve(fail('BAD_REQUEST', 'The settings had an unexpected shape.'))
        return this.serialized(() => this.apply(values, 'settings-save', 'Settings saved.'))
    }

    // Phase 22 (setup wizard): change ONLY the browser window setting, keeping every other value as it is now. Same path as Save
    // (backup copy, engine validates and writes, read back). Refused when the engine cannot be read (ENGINE_DOWN / CONFIG_MISSING).
    setHeadless(headless: boolean): Promise<ActionResult> {
        if (typeof headless !== 'boolean')
            return Promise.resolve(fail('BAD_REQUEST', 'Invalid browser window value.'))
        return this.serialized(async () => {
            const state = await this.getState()
            if (state.status !== 'ok' || state.values === null) {
                const missing = state.reason !== null && /config\.json is missing/.test(state.reason)
                return fail(
                    missing
                        ? 'CONFIG_MISSING'
                        : state.status === 'unavailable'
                          ? 'ENGINE_DOWN'
                          : 'CONFIG_INVALID',
                    state.reason ?? 'The settings cannot be read now.'
                )
            }
            return this.apply(
                { ...state.values, headless },
                'wizard-headless',
                'Browser window setting saved.'
            )
        })
    }

    reset(): Promise<ActionResult> {
        return this.serialized(async () => {
            const defaults = await this.readDefaults()
            if (defaults === null) {
                return fail(
                    'CONFIG_MISSING',
                    'The engine example config (config.example.json) could not be read.'
                )
            }
            return this.apply(defaults, 'settings-reset', 'Settings reset to the engine defaults.')
        })
    }

    // One change at a time (also across Save and Reset).
    private serialized(job: () => Promise<ActionResult>): Promise<ActionResult> {
        const next = this.queue.then(job, job)
        this.queue = next.catch(() => undefined)
        return next
    }

    private apply(wanted: EngineSettingsValues, action: string, doneText: string): Promise<ActionResult> {
        return this.deps.host.run(async () => {
            const api = this.deps.host.api()
            if (api === null) return fail('ENGINE_DOWN', 'The engine is not ready.')
            let configPath: string
            let current: EngineSettingsValues
            // A field missing in config.json is compared with the engine example value, the same way the screen shows it.
            const fallbacks = await this.readDefaults()
            try {
                const res = await api.config()
                const parsed = extractValues(res.config, fallbacks)
                if (!parsed.ok) return fail('CONFIG_INVALID', parsed.message)
                current = parsed.value.values
                configPath = typeof res.path === 'string' ? res.path : ''
            } catch (e) {
                return this.fromError(action, e)
            }
            const keys = changedKeys(current, wanted)
            if (keys.length === 0)
                return {
                    ok: true,
                    message: 'Nothing to change: the saved settings are already these values.'
                }

            // 1. Backup copy of the real config file (rule 10). If it fails, nothing is changed.
            if (configPath === '' || !isInside(this.deps.engineRoot, configPath)) {
                return fail(
                    'WRITE_FAILED',
                    'The config file is outside the engine folder, so no backup was made and nothing was changed.'
                )
            }
            const backupPath = join(this.deps.backupDir, `config-${stamp(this.now())}.json`)
            try {
                await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 })
                await restrictToCurrentUser(this.deps.backupDir, true)
                await copyFile(configPath, backupPath)
                await restrictToCurrentUser(backupPath, false)
                this.lastBackup = this.now()
            } catch (e) {
                const code = (e as NodeJS.ErrnoException).code ?? 'unknown error'
                this.audit(
                    action,
                    'error',
                    'backup-failed',
                    `Backup failed (${code}); config.json unchanged.`
                )
                return fail('WRITE_FAILED', `Could not make a backup copy (${code}). Nothing was changed.`)
            }

            // 2. The engine validates and writes (atomic on its side).
            try {
                await api.patchConfig(buildPatch(wanted, keys))
            } catch (e) {
                return this.fromError(action, e)
            }

            // The engine wrote a new file; config.json can hold webhook secrets (Phase 10), so it stays private to this user.
            await restrictToCurrentUser(configPath, false)

            // 3. Read it back from the engine and compare (rule 4: no success claim without evidence).
            try {
                const back = extractValues((await api.config()).config, fallbacks)
                if (!back.ok || changedKeys(wanted, back.value.values).some((k) => keys.includes(k))) {
                    this.audit(
                        action,
                        'error',
                        'readback-mismatch',
                        'The engine accepted the change but the values read back differ.'
                    )
                    return fail(
                        'WRITE_FAILED',
                        'The engine accepted the change, but reading it back shows different values. A backup copy exists.'
                    )
                }
            } catch (e) {
                return this.fromError(action, e)
            }

            this.audit(
                action,
                'info',
                'ok',
                `Changed ${String(keys.length)} field(s): ${describe(wanted, keys)}.`
            )
            return { ok: true, message: `${doneText} They apply from the next run.` }
        })
    }

    private fromError(action: string, e: unknown): ActionResult {
        if (e instanceof AppError) {
            this.audit(action, 'error', e.code, `Engine refused or failed: ${e.message}`)
            const hint = e.code === 'WRITE_DISABLED' ? ' Config writes are switched off in the engine.' : ''
            return fail(e.code, `${e.message}${hint}`)
        }
        this.audit(action, 'error', 'unknown', 'Unexpected failure while changing the settings.')
        return fail('ENGINE_ERROR', 'The settings could not be changed.')
    }

    private audit(action: string, level: 'info' | 'warn' | 'error', result: string, message: string): void {
        this.deps.audit.write({ level, component: 'EngineSettings', action, result, message })
    }
}
