import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
    cleanAccountInput,
    engineProblems,
    normalizeGeo,
    normalizeLang,
    stripUrlCredentials
} from '../shared/accounts-rules'
import type { CleanAccount, ExistingState, FieldErrors, SecretChange } from '../shared/accounts-rules'
import { EMPTY_ACCOUNT_INPUT } from '../shared/accounts-types'
import type { AccountInput, AccountsState, AccountView } from '../shared/accounts-types'
import type { ActionResult, ErrorCode } from '../shared/farmer-types'
import { MAX_ENV_FILE_BYTES, parseEnvText } from './engine/envFile'
import { applyChanges, EnvEditError, listSlots, nextFreeSlot, removeSlot } from './engine/envEdit'
import type { FieldChanges, SlotRecord } from './engine/envEdit'
import type { JsonlLog } from './jsonlLog'
import { restrictToCurrentUser } from './privatePerms'

// Accounts screen service (Phase 7, docs/requirements-matrix.md B6).
// The accounts `.env` file the user chose on Home is the ONLY account store. This service lists it and changes ONE account
// at a time: backup copy first, change in memory, check that nothing else moved, replace the file in one step, read it
// back. Secret values are never returned to the renderer and never logged.

export type EditOutcome =
    | { readonly ok: true; readonly message: string }
    | { readonly ok: false; readonly code: ErrorCode; readonly message: string }

// What AccountsService needs from FarmerService. `editAccounts` marks the app busy (Start / Stop / Open refuse), runs `work`
// and, when it succeeded, restarts the engine on the changed file.
export interface AccountsHost {
    accountsPath(): string | null
    editBlock(): string | null
    editAccounts(work: (path: string) => Promise<EditOutcome>): Promise<ActionResult>
}

export interface AccountsDeps {
    readonly host: AccountsHost
    readonly redactor: { add(value: string | undefined | null): void }
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    // Folder for backup copies. Holds copies of the accounts file, so they contain secrets (never log, never commit).
    readonly backupDir: string
    readonly now?: () => Date
}

const MAX_TEXT = 2000
const BAD = (message: string, code: ErrorCode = 'BAD_REQUEST'): EditOutcome => ({ ok: false, code, message })

function str(raw: Record<string, unknown>, key: string): string | null {
    const v = raw[key]
    if (v === undefined) return ''
    return typeof v === 'string' && v.length <= MAX_TEXT ? v : null
}
function bool(raw: Record<string, unknown>, key: string): boolean | null {
    const v = raw[key]
    if (v === undefined) return false
    return typeof v === 'boolean' ? v : null
}

// The renderer is untrusted (threat model T5, T11): anything that is not exactly the expected shape is refused.
export function parseAccountInput(raw: unknown): AccountInput | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const o = raw as Record<string, unknown>
    const out = {
        email: str(o, 'email'),
        password: str(o, 'password'),
        clearPassword: bool(o, 'clearPassword'),
        totpSecret: str(o, 'totpSecret'),
        clearTotp: bool(o, 'clearTotp'),
        recoveryEmail: str(o, 'recoveryEmail'),
        clearRecovery: bool(o, 'clearRecovery'),
        langCode: str(o, 'langCode'),
        geoLocale: str(o, 'geoLocale'),
        proxyUrl: str(o, 'proxyUrl'),
        proxyPort: str(o, 'proxyPort'),
        proxyHttpToo: bool(o, 'proxyHttpToo'),
        proxyUsername: str(o, 'proxyUsername'),
        proxyPassword: str(o, 'proxyPassword'),
        clearProxyCredentials: bool(o, 'clearProxyCredentials')
    }
    if (Object.values(out).some((v) => v === null)) return null
    return { ...EMPTY_ACCOUNT_INPUT, ...(out as AccountInput) }
}

function isSlot(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function describeErrors(errors: FieldErrors): string {
    return Object.values(errors).join(' ')
}

function viewOf(rec: SlotRecord): AccountView {
    const v = rec.values
    const port = v['PROXY_PORT'] === undefined ? Number.NaN : Number.parseInt(v['PROXY_PORT'], 10)
    const httpRaw = v['PROXY_HTTP'] ?? v['PROXY_AXIOS']
    const proxyUrl = v['PROXY_URL']
    const lang = v['LANG_CODE']
    const geo = v['GEO_LOCALE']
    return {
        slot: rec.slot,
        email: v['EMAIL'] ?? '',
        hasPassword: v['PASSWORD'] !== undefined,
        hasTotp: v['TOTP_SECRET'] !== undefined,
        hasRecoveryEmail: v['RECOVERY_EMAIL'] !== undefined,
        langCode: lang === undefined ? null : (normalizeLang(lang) ?? lang),
        geoLocale: geo === undefined ? null : (normalizeGeo(geo) ?? geo),
        proxy:
            proxyUrl === undefined
                ? null
                : {
                      url: stripUrlCredentials(proxyUrl),
                      port: Number.isFinite(port) && port > 0 ? port : null,
                      httpToo:
                          httpRaw !== undefined && ['1', 'true', 'yes', 'on'].includes(httpRaw.toLowerCase()),
                      hasCredentials: v['PROXY_USERNAME'] !== undefined && v['PROXY_PASSWORD'] !== undefined
                  },
        problems: engineProblems({
            email: v['EMAIL'],
            langCode: lang,
            geoLocale: geo,
            proxyHttp: httpRaw,
            proxyUrl,
            proxyPort: v['PROXY_PORT'],
            hasProxyUsername: v['PROXY_USERNAME'] !== undefined,
            hasProxyPassword: v['PROXY_PASSWORD'] !== undefined
        })
    }
}

function existingOf(rec: SlotRecord): ExistingState {
    const v = rec.values
    return {
        hasPassword: v['PASSWORD'] !== undefined,
        hasTotp: v['TOTP_SECRET'] !== undefined,
        hasRecoveryEmail: v['RECOVERY_EMAIL'] !== undefined,
        hasProxyCredentials: v['PROXY_USERNAME'] !== undefined || v['PROXY_PASSWORD'] !== undefined
    }
}

const secretChange = (c: SecretChange): string | null | undefined =>
    c.kind === 'keep' ? undefined : c.kind === 'clear' ? null : c.value

// Value for a plain line: leave it alone when it already holds exactly this value.
function plain(existing: string | undefined, next: string | null): string | null | undefined {
    if (next === null) return existing === undefined ? undefined : null
    return existing === next ? undefined : next
}

// Turn a validated form into line changes. `existing` = the account's current values (null = new account).
export function buildChanges(
    clean: CleanAccount,
    existing: Readonly<Record<string, string>> | null
): FieldChanges {
    const v = existing ?? {}
    const changes: FieldChanges = {
        EMAIL: plain(v['EMAIL'], clean.email),
        PASSWORD: secretChange(clean.password),
        TOTP_SECRET: secretChange(clean.totp),
        RECOVERY_EMAIL: secretChange(clean.recovery),
        LANG_CODE: plain(
            v['LANG_CODE'] === undefined ? undefined : (normalizeLang(v['LANG_CODE']) ?? v['LANG_CODE']),
            clean.langCode
        ),
        GEO_LOCALE: plain(
            v['GEO_LOCALE'] === undefined ? undefined : (normalizeGeo(v['GEO_LOCALE']) ?? v['GEO_LOCALE']),
            clean.geoLocale
        )
    }
    const p = clean.proxy
    if (p.url === null) {
        // No proxy: remove every proxy line this account has (including the old PROXY_AXIOS name).
        for (const f of [
            'PROXY_URL',
            'PROXY_PORT',
            'PROXY_HTTP',
            'PROXY_AXIOS',
            'PROXY_USERNAME',
            'PROXY_PASSWORD'
        ] as const) {
            changes[f] = v[f] === undefined ? undefined : null
        }
        return changes
    }
    changes.PROXY_URL = plain(v['PROXY_URL'], p.url)
    changes.PROXY_PORT = p.port === null ? undefined : plain(v['PROXY_PORT'], String(p.port))
    const httpRaw = v['PROXY_HTTP'] ?? v['PROXY_AXIOS']
    const wasHttp = httpRaw !== undefined && ['1', 'true', 'yes', 'on'].includes(httpRaw.toLowerCase())
    if (wasHttp !== p.httpToo || (existing === null && p.httpToo)) {
        // Write the current name, drop the old one so the two can never disagree.
        changes.PROXY_HTTP = p.httpToo ? 'true' : v['PROXY_HTTP'] === undefined ? undefined : 'false'
        if (v['PROXY_AXIOS'] !== undefined) changes.PROXY_AXIOS = null
    }
    if (p.credentials.kind === 'clear') {
        changes.PROXY_USERNAME = v['PROXY_USERNAME'] === undefined ? undefined : null
        changes.PROXY_PASSWORD = v['PROXY_PASSWORD'] === undefined ? undefined : null
    } else if (p.credentials.kind === 'set') {
        changes.PROXY_USERNAME = p.username
        changes.PROXY_PASSWORD = p.password
    }
    return changes
}

// Safety net: after the edit nothing outside the edited account may have changed, and the edited account must read back as
// intended. A bug in the editor fails here, before anything is written.
export function checkEdit(
    before: string,
    after: string,
    slot: number,
    expectEmail: string | null
): string | null {
    const a = parseEnvText(before)
    const b = parseEnvText(after)
    const prefix = `ACCOUNT_${String(slot)}_`
    const outside = (m: Record<string, string>): [string, string][] =>
        Object.entries(m)
            .filter(([k]) => !k.startsWith(prefix))
            .sort((x, y) => x[0].localeCompare(y[0]))
    if (JSON.stringify(outside(a)) !== JSON.stringify(outside(b)))
        return 'The edit would change something outside this account.'
    const after1 = listSlots(after).find((s) => s.slot === slot)
    if (expectEmail === null)
        return after1 === undefined ? null : 'The account is still present after removal.'
    if (after1?.values['EMAIL'] !== expectEmail) return 'The edited account does not read back as expected.'
    return null
}

function stamp(d: Date): string {
    return d
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z')
}

export class AccountsService {
    private chain: Promise<unknown> = Promise.resolve()
    private lastBackup: string | null = null

    constructor(private readonly deps: AccountsDeps) {}

    private now(): Date {
        return this.deps.now?.() ?? new Date()
    }

    // ---- read -----------------------------------------------------------------------------------------------------

    private async readFileChecked(path: string): Promise<{ buf: Buffer; text: string } | string> {
        try {
            const info = await stat(path)
            if (!info.isFile()) return 'The chosen path is not a file.'
            if (info.size > MAX_ENV_FILE_BYTES)
                return 'The accounts file is larger than 256 KB, so it is probably not an accounts file.'
            const buf = await readFile(path)
            const text = buf.toString('utf8')
            if (!Buffer.from(text, 'utf8').equals(buf)) {
                return 'The accounts file is not valid UTF-8 text. The app will not rewrite it.'
            }
            return { buf, text }
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'ENOENT') return 'The accounts file does not exist (moved or deleted?).'
            if (code === 'EACCES' || code === 'EPERM') return 'Permission denied for the accounts file.'
            return `Cannot read the accounts file (${code ?? 'unknown error'}).`
        }
    }

    private async newestBackup(): Promise<string | null> {
        try {
            const names = (await readdir(this.deps.backupDir)).filter((n) => n.endsWith('.bak'))
            let newest = 0
            for (const n of names) {
                const t = (await stat(join(this.deps.backupDir, n))).mtimeMs
                if (t > newest) newest = t
            }
            return newest > 0 ? new Date(newest).toISOString() : null
        } catch {
            return null
        }
    }

    async getState(): Promise<AccountsState> {
        const path = this.deps.host.accountsPath()
        const updatedAt = this.now().toISOString()
        const lastBackupAt = this.lastBackup ?? (await this.newestBackup())
        const editDisabledReason = this.deps.host.editBlock()
        if (path === null) {
            return {
                status: 'not-set',
                path: null,
                error: null,
                accounts: [],
                editDisabledReason,
                lastBackupAt,
                updatedAt
            }
        }
        const read = await this.readFileChecked(path)
        if (typeof read === 'string') {
            return {
                status: 'error',
                path,
                error: read,
                accounts: [],
                editDisabledReason,
                lastBackupAt,
                updatedAt
            }
        }
        const accounts = listSlots(read.text).map(viewOf)
        return { status: 'ok', path, error: null, accounts, editDisabledReason, lastBackupAt, updatedAt }
    }

    // ---- write ----------------------------------------------------------------------------------------------------

    private serialize<T>(job: () => Promise<T>): Promise<T> {
        const run = this.chain.then(job, job)
        this.chain = run.catch(() => undefined)
        return run
    }

    private record(
        action: string,
        level: 'info' | 'warn' | 'error',
        result: string,
        message: string,
        corrId: string,
        account?: string
    ): void {
        const entry = {
            level,
            component: 'AccountsService',
            action,
            result,
            message,
            corrId,
            ...(account === undefined ? {} : { account })
        }
        this.deps.audit.write(entry)
        if (level !== 'info')
            this.deps.appLog.write({
                level,
                component: 'AccountsService',
                message: `${action}: ${message}`,
                corrId
            })
    }

    // Copy of the current file bytes, before any change. Mode 0600 because the file holds passwords.
    private async backup(orig: Buffer, path: string, label: string): Promise<string> {
        await mkdir(this.deps.backupDir, { recursive: true, mode: 0o700 })
        const name = `${basename(path)}.${stamp(this.now())}-${label}-${randomBytes(2).toString('hex')}.bak`
        const target = join(this.deps.backupDir, name)
        await writeFile(target, orig, { flag: 'wx', mode: 0o600 })
        // mode is ignored on Windows: limit the folder and the copy to the current user there (Phase 10).
        await restrictToCurrentUser(this.deps.backupDir, true)
        await restrictToCurrentUser(target, false)
        this.lastBackup = this.now().toISOString()
        return target
    }

    // Replace the file in one step: temp file in the same folder, flushed, then renamed over the original.
    private async replaceFile(path: string, content: string): Promise<void> {
        const real = await realpath(path)
        const mode = (await stat(real)).mode & 0o777
        const tmp = join(dirname(real), `.${basename(real)}.rf-${randomBytes(4).toString('hex')}.tmp`)
        try {
            const handle = await open(tmp, 'wx', mode === 0 ? 0o600 : mode)
            try {
                await handle.writeFile(content, 'utf8')
                await handle.sync()
            } finally {
                await handle.close()
            }
            await rename(tmp, real)
        } catch (error) {
            await unlink(tmp).catch(() => undefined)
            throw error
        }
    }

    private writeError(error: unknown): string {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EACCES' || code === 'EPERM')
            return 'Permission denied, or the file is locked by another program.'
        if (code === 'EBUSY') return 'The file is in use by another program.'
        if (code === 'ENOSPC') return 'The disk is full.'
        return `Write failed (${code ?? (error instanceof Error ? error.message : 'unknown error')}).`
    }

    // One complete, guarded change. `plan` decides the new text from the current text.
    private async change(
        action: 'account-add' | 'account-update' | 'account-remove',
        corrId: string,
        path: string,
        plan: (
            text: string,
            slots: SlotRecord[]
        ) =>
            | {
                  newText: string
                  slot: number
                  email: string | null
                  note: string
                  secrets: string[]
                  account: string
              }
            | EditOutcome
    ): Promise<EditOutcome> {
        const fail = (code: ErrorCode, message: string, account?: string): EditOutcome => {
            this.record(action, 'warn', code, message, corrId, account)
            return { ok: false, code, message }
        }
        const read = await this.readFileChecked(path)
        if (typeof read === 'string') return fail('ACCOUNTS_INVALID', read)

        let result: ReturnType<typeof plan>
        try {
            result = plan(read.text, listSlots(read.text))
        } catch (error) {
            if (error instanceof EnvEditError) return fail('BAD_REQUEST', error.message)
            throw error
        }
        if ('ok' in result) return result.ok ? result : fail(result.code, result.message)
        const { newText, slot, email, note, secrets, account } = result

        const selfCheck = checkEdit(read.text, newText, slot, email)
        if (selfCheck !== null) return fail('WRITE_FAILED', `${selfCheck} Nothing was changed.`, account)
        if (Buffer.byteLength(newText, 'utf8') > MAX_ENV_FILE_BYTES) {
            return fail(
                'BAD_REQUEST',
                'The accounts file would become larger than 256 KB. Nothing was changed.',
                account
            )
        }

        let backupPath: string
        try {
            backupPath = await this.backup(read.buf, path, action.replace('account-', ''))
        } catch (error) {
            return fail(
                'WRITE_FAILED',
                `Backup failed (${this.writeError(error)}) Nothing was changed.`,
                account
            )
        }

        // The file may have been edited by another program while we worked.
        const again = await this.readFileChecked(path)
        if (typeof again === 'string' || !again.buf.equals(read.buf)) {
            return fail(
                'WRITE_FAILED',
                'The accounts file changed on disk while the app was working. Nothing was changed. Try again.',
                account
            )
        }

        try {
            await this.replaceFile(path, newText)
        } catch (error) {
            return fail(
                'WRITE_FAILED',
                `${this.writeError(error)} The file was not changed (a backup copy was kept).`,
                account
            )
        }
        const verify = await this.readFileChecked(path)
        if (typeof verify === 'string' || verify.text !== newText) {
            return fail(
                'WRITE_FAILED',
                'The file was written but does not read back correctly. Restore it from the backup folder.',
                account
            )
        }

        for (const s of secrets) this.deps.redactor.add(s)
        this.record(action, 'info', 'ok', `${note} Backup: ${basename(backupPath)}`, corrId, account)
        return { ok: true, message: note }
    }

    add(raw: unknown): Promise<ActionResult> {
        const corrId = randomUUID()
        const input = parseAccountInput(raw)
        if (input === null)
            return Promise.resolve({ ok: false, code: 'BAD_REQUEST', message: 'Invalid account data.' })
        return this.serialize(() =>
            this.deps.host.editAccounts((path) =>
                this.change('account-add', corrId, path, (text, slots) => {
                    const clean = cleanAccountInput(
                        input,
                        slots.map((s) => s.values['EMAIL'] ?? ''),
                        null
                    )
                    if (!clean.ok) return BAD(describeErrors(clean.errors))
                    const slot = nextFreeSlot(text)
                    const newText = applyChanges(text, slot, buildChanges(clean.value, null))
                    return {
                        newText,
                        slot,
                        email: clean.value.email,
                        account: clean.value.email,
                        note: `Account ${clean.value.email} added.`,
                        secrets: secretsOf(clean.value)
                    }
                })
            )
        )
    }

    update(slotRaw: unknown, expectedEmail: unknown, raw: unknown): Promise<ActionResult> {
        const corrId = randomUUID()
        const input = parseAccountInput(raw)
        if (!isSlot(slotRaw) || typeof expectedEmail !== 'string' || input === null) {
            return Promise.resolve({ ok: false, code: 'BAD_REQUEST', message: 'Invalid account data.' })
        }
        const slot = slotRaw
        return this.serialize(() =>
            this.deps.host.editAccounts((path) =>
                this.change('account-update', corrId, path, (text, slots) => {
                    const current = slots.find((s) => s.slot === slot)
                    if (current === undefined)
                        return BAD(
                            'This account is no longer in the file. The list was refreshed.',
                            'NOT_FOUND'
                        )
                    if (current.values['EMAIL'] !== expectedEmail) {
                        return BAD(
                            'The list is out of date: this slot now holds a different account. The list was refreshed.',
                            'NOT_FOUND'
                        )
                    }
                    const others = slots.filter((s) => s.slot !== slot).map((s) => s.values['EMAIL'] ?? '')
                    const clean = cleanAccountInput(input, others, existingOf(current))
                    if (!clean.ok) return BAD(describeErrors(clean.errors))
                    const newText = applyChanges(text, slot, buildChanges(clean.value, current.values))
                    const renamed = clean.value.email !== expectedEmail
                    return {
                        newText,
                        slot,
                        email: clean.value.email,
                        account: clean.value.email,
                        note: renamed
                            ? `Account saved. Its e-mail changed from ${expectedEmail} to ${clean.value.email}; the engine keeps saved sessions per e-mail, so the new e-mail starts without a saved session.`
                            : `Account ${clean.value.email} saved.`,
                        secrets: secretsOf(clean.value)
                    }
                })
            )
        )
    }

    remove(slotRaw: unknown, expectedEmail: unknown): Promise<ActionResult> {
        const corrId = randomUUID()
        if (!isSlot(slotRaw) || typeof expectedEmail !== 'string') {
            return Promise.resolve({ ok: false, code: 'BAD_REQUEST', message: 'Invalid account data.' })
        }
        const slot = slotRaw
        return this.serialize(() =>
            this.deps.host.editAccounts((path) =>
                this.change('account-remove', corrId, path, (text, slots) => {
                    const current = slots.find((s) => s.slot === slot)
                    if (current === undefined)
                        return BAD(
                            'This account is no longer in the file. The list was refreshed.',
                            'NOT_FOUND'
                        )
                    if (current.values['EMAIL'] !== expectedEmail) {
                        return BAD(
                            'The list is out of date: this slot now holds a different account. The list was refreshed.',
                            'NOT_FOUND'
                        )
                    }
                    const last = slots.length === 1
                    return {
                        newText: removeSlot(text, slot),
                        slot,
                        email: null,
                        account: expectedEmail,
                        note: last
                            ? `Account ${expectedEmail} removed. The file has no account left, so the engine cannot start until you add one. Saved sessions were not deleted.`
                            : `Account ${expectedEmail} removed from the accounts file. Its saved sessions were not deleted.`,
                        secrets: []
                    }
                })
            )
        )
    }
}

function secretsOf(clean: CleanAccount): string[] {
    const out: string[] = []
    for (const c of [clean.password, clean.totp, clean.recovery, clean.proxy.credentials]) {
        if (c.kind === 'set') out.push(c.value)
    }
    if (clean.proxy.credentials.kind === 'set') out.push(clean.proxy.username)
    return out
}
