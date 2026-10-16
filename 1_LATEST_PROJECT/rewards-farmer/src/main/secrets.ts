import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ActionResult, ErrorCode } from '../shared/farmer-types'
import {
    ENGINE_MASK,
    SECRET_FIELDS,
    buildSecretPatch,
    isSecretId,
    readSecretValue,
    secretDef,
    validateSecret
} from '../shared/secrets-rules'
import type { SecretId, SecretsState } from '../shared/secrets-types'
import { AppError } from './engine/apiClient'
import type { EngineApi } from './engine/apiClient'
import type { Redactor } from './engine/redact'
import type { JsonlLog } from './jsonlLog'
import { restrictToCurrentUser } from './privatePerms'
import type { PermsResult } from './privatePerms'

// Secrets (Phase 10). Webhook tokens and the China API appkey live in the engine's config.json, because the bot reads
// them only from there (it has no environment or credential-store input for them: docs/configuration-reference.md).
// So this service never invents a second store. It makes that one file safe:
//   - write-only: values are written once and never sent back to the screen, a log or an audit line (rule 8),
//   - the real engine validates and writes (PATCH /config), the value is read back to prove it was saved (rule 4),
//   - every value is registered in the Redactor BEFORE any engine call, so an error text cannot leak it,
//   - config.json and its backup copies are limited to the current user,
//   - the engine GET /config hides only some secrets: this service reads it in main and keeps only set / not set.

export interface SecretsHost {
    api(): EngineApi | null
    // null = Set / Clear allowed. A string = why not.
    editBlock(): string | null
    run(work: () => Promise<ActionResult>): Promise<ActionResult>
}

export interface SecretsDeps {
    readonly host: SecretsHost
    readonly engineRoot: string
    readonly redactor: Redactor
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    // Backup copies of config.json. They hold secrets, so they stay in the private user-data folder.
    readonly backupDir: string
    readonly now?: () => Date
    readonly restrict?: (path: string, isDir: boolean) => Promise<PermsResult>
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

export class SecretsService {
    private queue: Promise<unknown> = Promise.resolve()

    constructor(private readonly deps: SecretsDeps) {}

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date()
    }

    private restrict(path: string, isDir: boolean): Promise<PermsResult> {
        return (this.deps.restrict ?? restrictToCurrentUser)(path, isDir)
    }

    // Teach the Redactor every secret that is currently saved, so a later log line cannot show it.
    private learn(config: unknown): void {
        for (const f of SECRET_FIELDS) {
            const v = readSecretValue(config, f.id)
            if (v !== ENGINE_MASK) this.deps.redactor.add(v)
        }
    }

    // ---- read ----------------------------------------------------------------------------------------------------

    async getState(): Promise<SecretsState> {
        const updatedAt = this.now().toISOString()
        const empty = { fields: [], updatedAt } as const
        const api = this.deps.host.api()
        if (api === null) {
            return {
                ...empty,
                status: 'unavailable',
                reason: 'The engine is not running, so the saved secrets cannot be checked. Choose your accounts file on Home first: the engine starts after that.',
                editDisabledReason: 'The engine is not ready.'
            }
        }
        try {
            const res = await api.config()
            this.learn(res.config)
            // Only set / not set leaves this function.
            const fields = SECRET_FIELDS.map((f) => ({
                id: f.id,
                label: f.label,
                group: f.group,
                help: f.help,
                isSet: readSecretValue(res.config, f.id) !== ''
            }))
            return {
                status: 'ok',
                reason: null,
                fields,
                editDisabledReason: this.deps.host.editBlock(),
                updatedAt
            }
        } catch (e) {
            const message =
                e instanceof AppError
                    ? this.deps.redactor.redact(e.message)
                    : 'The secrets could not be checked.'
            const missing = e instanceof AppError && e.code === 'NOT_FOUND'
            return {
                ...empty,
                status: missing ? 'unavailable' : 'error',
                reason: missing ? 'config.json is missing. Use "Create config" on Home first.' : message,
                editDisabledReason: missing ? 'config.json is missing.' : message
            }
        }
    }

    // ---- write ---------------------------------------------------------------------------------------------------

    set(id: unknown, raw: unknown): Promise<ActionResult> {
        if (!isSecretId(id)) return Promise.resolve(fail('BAD_REQUEST', 'Unknown secret field.'))
        const checked = validateSecret(id, raw)
        if (!checked.ok) return Promise.resolve(fail('BAD_REQUEST', checked.message))
        // Registered first: from here on the value is masked in every error text and log line.
        this.deps.redactor.add(checked.value)
        return this.serialized(() => this.apply(id, checked.value, 'secret-set'))
    }

    clear(id: unknown): Promise<ActionResult> {
        if (!isSecretId(id)) return Promise.resolve(fail('BAD_REQUEST', 'Unknown secret field.'))
        return this.serialized(() => this.apply(id, '', 'secret-clear'))
    }

    private serialized(job: () => Promise<ActionResult>): Promise<ActionResult> {
        const next = this.queue.then(job, job)
        this.queue = next.catch(() => undefined)
        return next
    }

    private apply(id: SecretId, value: string, action: 'secret-set' | 'secret-clear'): Promise<ActionResult> {
        const def = secretDef(id)
        return this.deps.host.run(async () => {
            const api = this.deps.host.api()
            if (api === null) return fail('ENGINE_DOWN', 'The engine is not ready.')

            let configPath: string
            let before: string
            try {
                const res = await api.config()
                this.learn(res.config)
                before = readSecretValue(res.config, id)
                configPath = typeof res.path === 'string' ? res.path : ''
            } catch (e) {
                return this.fromError(action, def.label, e)
            }
            if (action === 'secret-clear' && before === '')
                return { ok: true, message: `${def.label} was not set. Nothing to clear.` }

            // 1. Backup copy of the real config file (rule 10), limited to the current user. If it fails, nothing changes.
            if (configPath === '' || !isInside(this.deps.engineRoot, configPath)) {
                return fail(
                    'WRITE_FAILED',
                    'The config file is outside the engine folder, so no backup was made and nothing was changed.'
                )
            }
            const backupPath = join(this.deps.backupDir, `config-${stamp(this.now())}.json`)
            try {
                await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 })
                await this.restrict(this.deps.backupDir, true)
                await copyFile(configPath, backupPath)
                await this.restrict(backupPath, false)
            } catch (e) {
                const code = (e as NodeJS.ErrnoException).code ?? 'unknown error'
                this.audit(
                    action,
                    'error',
                    'backup-failed',
                    `${def.label}: backup failed (${code}); config.json unchanged.`
                )
                return fail('WRITE_FAILED', `Could not make a backup copy (${code}). Nothing was changed.`)
            }

            // 2. The engine validates and writes (atomic on its side).
            try {
                await api.patchConfig(buildSecretPatch(id, value))
            } catch (e) {
                return this.fromError(action, def.label, e)
            }

            // 3. The engine wrote a new file: limit it to the current user again, before anything else can fail.
            const perms = await this.restrict(configPath, false)
            if (!perms.ok) this.audit(action, 'warn', 'permissions', `config.json: ${perms.detail}`)

            // 4. Read it back (rule 4). The engine's GET /config hides some secrets (shows ENGINE_MASK), so the exact value
            //    is checked in the file itself. Read-only, inside main; the value is never logged or returned.
            try {
                const onDisk = JSON.parse(await readFile(configPath, 'utf8')) as unknown
                if (readSecretValue(onDisk, id) !== value) {
                    this.audit(
                        action,
                        'error',
                        'readback-mismatch',
                        `${def.label}: the engine accepted the change but the saved value differs.`
                    )
                    return fail(
                        'WRITE_FAILED',
                        'The engine accepted the change, but reading it back shows a different value. A backup copy exists.'
                    )
                }
            } catch {
                this.audit(
                    action,
                    'error',
                    'readback-failed',
                    `${def.label}: config.json could not be read back.`
                )
                return fail(
                    'WRITE_FAILED',
                    'The engine accepted the change, but config.json could not be read back to check it. A backup copy exists.'
                )
            }

            this.audit(
                action,
                'info',
                'ok',
                `${def.label}: ${action === 'secret-set' ? 'saved' : 'cleared'} (value not logged).`
            )
            const done = action === 'secret-set' ? `${def.label} saved.` : `${def.label} cleared.`
            return {
                ok: true,
                message: `${done} It applies from the next run.${perms.ok ? '' : ' Note: the file permissions could not be tightened. See the audit log.'}`
            }
        })
    }

    private fromError(action: string, label: string, e: unknown): ActionResult {
        if (e instanceof AppError) {
            const text = this.deps.redactor.redact(e.message)
            this.audit(action, 'error', e.code, `${label}: the engine refused or failed: ${text}`)
            const hint = e.code === 'WRITE_DISABLED' ? ' Config writes are switched off in the engine.' : ''
            return fail(e.code, `${text}${hint}`)
        }
        this.audit(action, 'error', 'unknown', `${label}: unexpected failure.`)
        return fail('ENGINE_ERROR', 'The secret could not be changed.')
    }

    private audit(action: string, level: 'info' | 'warn' | 'error', result: string, message: string): void {
        this.deps.audit.write({
            level,
            component: 'Secrets',
            action,
            result,
            message: this.deps.redactor.redact(message)
        })
    }
}
