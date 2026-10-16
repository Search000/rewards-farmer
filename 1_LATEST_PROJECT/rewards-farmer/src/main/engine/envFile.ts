import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

// Reads the user's chosen accounts `.env` file (docs/architecture.md section 5, option 1).
// Only `ACCOUNT_<N>_*` variables are forwarded to the engine API child. The file itself is never modified,
// never copied, and its contents never go to the renderer.

export const MAX_ENV_FILE_BYTES = 256 * 1024

const KEY_RE = /^ACCOUNT_([1-9]\d*)_[A-Z0-9_]+$/
const EMAIL_KEY_RE = /^ACCOUNT_([1-9]\d*)_EMAIL$/
const SECRET_KEY_RE = /(PASSWORD|TOTP|RECOVERY|SECRET|TOKEN|PROXY_USERNAME)/

export interface ParsedAccountsFile {
    // ACCOUNT_* variables to inject into the engine API process environment.
    readonly vars: Readonly<Record<string, string>>
    readonly accountCount: number
    // Values that must be registered with the Redactor.
    readonly secretValues: readonly string[]
}

export type AccountsFileResult =
    | { readonly ok: true; readonly file: ParsedAccountsFile }
    | { readonly ok: false; readonly message: string; readonly empty?: true }

// Same grammar as the engine's own `loadEnvFile` (scripts/api/lib.js): KEY=VALUE, `#` comments, optional quotes.
export function parseEnvText(text: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed === '' || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
        ) {
            value = value.slice(1, -1)
        }
        out[key] = value
    }
    return out
}

// T10: the path comes from the OS file dialog in main, never from renderer text. Still validate it.
export function looksLikeEnvFileName(path: string): boolean {
    const name = basename(path).toLowerCase()
    return name === '.env' || name.startsWith('.env.') || name.endsWith('.env') || name.endsWith('.env.txt')
}

export async function loadAccountsFile(path: string): Promise<AccountsFileResult> {
    if (!looksLikeEnvFileName(path)) {
        return { ok: false, message: 'The file name must be ".env" or end with ".env" (for example accounts.env).' }
    }
    let size: number
    try {
        const info = await stat(path)
        if (!info.isFile()) return { ok: false, message: 'The chosen path is not a file.' }
        size = info.size
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') return { ok: false, message: 'The accounts file does not exist (moved or deleted?).' }
        if (code === 'EACCES' || code === 'EPERM') return { ok: false, message: 'Permission denied for the accounts file.' }
        return { ok: false, message: `Cannot read the accounts file (${code ?? 'unknown error'}).` }
    }
    if (size > MAX_ENV_FILE_BYTES) {
        return { ok: false, message: `The accounts file is larger than ${String(MAX_ENV_FILE_BYTES / 1024)} KB, so it is probably not an accounts file.` }
    }
    let text: string
    try {
        text = await readFile(path, 'utf8')
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        return { ok: false, message: `Cannot read the accounts file (${code ?? 'unknown error'}).` }
    }

    const all = parseEnvText(text)
    const vars: Record<string, string> = {}
    const secretValues: string[] = []
    let accountCount = 0
    for (const [key, value] of Object.entries(all)) {
        if (!KEY_RE.test(key)) continue
        if (value === '') continue
        vars[key] = value
        if (EMAIL_KEY_RE.test(key)) accountCount += 1
        else if (SECRET_KEY_RE.test(key)) secretValues.push(value)
    }
    if (accountCount === 0) {
        return {
            ok: false,
            empty: true,
            message: 'No account found. The file needs at least one line like ACCOUNT_1_EMAIL=name@example.com.'
        }
    }
    return { ok: true, file: { vars, accountCount, secretValues } }
}
