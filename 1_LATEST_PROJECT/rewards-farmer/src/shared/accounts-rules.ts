import type { AccountInput } from './accounts-types'

// Validation for one account. Used by main (authoritative) and by the dialog (instant hints).
// The rules copy what the engine enforces in `engine/src/util/Validator.ts` (AccountSchema, AccountProxySchema),
// `engine/src/util/Proxy.ts` and `engine/scripts/api/accounts.js`, so the app never writes a line the engine rejects.

export type FieldName =
    | 'email'
    | 'password'
    | 'totpSecret'
    | 'recoveryEmail'
    | 'langCode'
    | 'geoLocale'
    | 'proxyUrl'
    | 'proxyPort'
    | 'proxyUsername'
    | 'proxyPassword'

export type FieldErrors = Partial<Record<FieldName, string>>

// How a secret field changes. keep = leave the saved value alone.
export type SecretChange =
    { readonly kind: 'keep' } | { readonly kind: 'clear' } | { readonly kind: 'set'; readonly value: string }

export interface CleanAccount {
    readonly email: string
    readonly password: SecretChange
    readonly totp: SecretChange
    readonly recovery: SecretChange
    // null = remove the line (engine default).
    readonly langCode: string | null
    readonly geoLocale: string | null
    readonly proxy: {
        // null = no proxy: every ACCOUNT_N_PROXY_* line is removed.
        readonly url: string | null
        readonly port: number | null
        readonly httpToo: boolean
        readonly credentials: SecretChange
        readonly username: string
        readonly password: string
    }
}

export type CleanResult =
    { readonly ok: true; readonly value: CleanAccount } | { readonly ok: false; readonly errors: FieldErrors }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MAX_VALUE_LENGTH = 512
const BROWSER_PROXY_PROTOCOLS = ['http:', 'https:', 'socks4:', 'socks5:']
const EXPLICIT_PROTOCOL = /^[a-z][a-z\d+.-]*:\/\//i

// A value must survive the round trip through the engine's `.env` grammar (KEY=VALUE, trimmed, one pair of quotes removed).
export function valueProblem(value: string, what: string): string | null {
    if (value.length > MAX_VALUE_LENGTH)
        return `${what} is longer than ${String(MAX_VALUE_LENGTH)} characters.`
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) return `${what} contains a control character or line break.`
    if (value !== value.trim()) return `${what} starts or ends with a space, which the engine would remove.`
    return null
}

export function emailProblem(value: string, what = 'E-mail'): string | null {
    if (value === '') return `${what} is required.`
    const generic = valueProblem(value, what)
    if (generic !== null) return generic
    return EMAIL_RE.test(value) ? null : `${what} must look like name@example.com.`
}

// Engine rule: Intl.Locale must accept the tag. Returns the normalized tag or null.
export function normalizeLang(value: string): string | null {
    try {
        return new Intl.Locale(value.trim()).toString()
    } catch {
        return null
    }
}

// Engine rule: "auto" or two letters.
export function normalizeGeo(value: string): string | null {
    const t = value.trim()
    if (t.toLowerCase() === 'auto') return 'auto'
    return /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : null
}

// Same checks as the engine's parseBrowserProxyUrl. Returns the parsed URL or a message.
export function parseProxyUrl(value: string): URL | string {
    const input = value.trim()
    if (input === '') return 'Proxy URL is empty.'
    let url: URL
    try {
        url = new URL(EXPLICIT_PROTOCOL.test(input) ? input : `http://${input}`)
    } catch {
        return 'Not a valid proxy URL.'
    }
    if (!BROWSER_PROXY_PROTOCOLS.includes(url.protocol.toLowerCase())) {
        return 'Supported proxy types: http, https, socks4, socks5.'
    }
    if (url.hostname === '') return 'Not a valid proxy URL.'
    return url
}

export function parsePort(value: string): number | null {
    return /^\d{1,5}$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 65535
        ? Number(value)
        : null
}

export function stripUrlCredentials(value: string): string {
    try {
        const url = new URL(value)
        url.username = ''
        url.password = ''
        return url.toString().replace(/\/$/, '')
    } catch {
        return value.replace(/^(?:[^/@\s]+@|([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@)/i, '$1')
    }
}

function secret(
    value: string,
    clear: boolean,
    what: string,
    errors: FieldErrors,
    field: FieldName
): SecretChange {
    if (clear) return { kind: 'clear' }
    if (value === '') return { kind: 'keep' }
    const problem = valueProblem(value, what)
    if (problem !== null) {
        errors[field] = problem
        return { kind: 'keep' }
    }
    return { kind: 'set', value }
}

export interface ExistingState {
    readonly hasPassword: boolean
    readonly hasTotp: boolean
    readonly hasRecoveryEmail: boolean
    readonly hasProxyCredentials: boolean
}

const NOTHING_SAVED: ExistingState = {
    hasPassword: false,
    hasTotp: false,
    hasRecoveryEmail: false,
    hasProxyCredentials: false
}

// `others` = e-mails of the OTHER accounts in the file (duplicate check, case-insensitive).
// `existing` = what the account already has (null when adding).
export function cleanAccountInput(
    input: AccountInput,
    others: readonly string[],
    existing: ExistingState | null
): CleanResult {
    const errors: FieldErrors = {}
    const email = input.email.trim()
    const emailErr = emailProblem(email)
    if (emailErr !== null) errors.email = emailErr
    else if (others.some((o) => o.toLowerCase() === email.toLowerCase())) {
        errors.email = 'Another account in this file already uses this e-mail.'
    }

    const password = secret(input.password, input.clearPassword, 'Password', errors, 'password')
    const totp = secret(input.totpSecret, input.clearTotp, '2FA secret', errors, 'totpSecret')
    const recovery = secret(
        input.recoveryEmail,
        input.clearRecovery,
        'Recovery e-mail',
        errors,
        'recoveryEmail'
    )
    if (recovery.kind === 'set') {
        const p = emailProblem(recovery.value, 'Recovery e-mail')
        if (p !== null) errors.recoveryEmail = p
    }

    let langCode: string | null = null
    if (input.langCode.trim() !== '') {
        langCode = normalizeLang(input.langCode)
        if (langCode === null) errors.langCode = 'Not a valid language tag. Examples: en, nl, pt-BR, zh-CN.'
    }
    let geoLocale: string | null = null
    if (input.geoLocale.trim() !== '') {
        geoLocale = normalizeGeo(input.geoLocale)
        if (geoLocale === null) errors.geoLocale = 'Use "auto" or a two-letter country code such as US or BD.'
    }

    const proxyUrl = input.proxyUrl.trim()
    const portText = input.proxyPort.trim()
    const proxyUser = input.proxyUsername
    const proxyPass = input.proxyPassword
    let url: string | null = null
    let port: number | null = null
    let credentials: SecretChange = { kind: 'keep' }
    if (proxyUrl === '') {
        // No proxy. Anything else typed in the proxy section would be silently dropped, so refuse it instead.
        if (portText !== '' && portText !== '0')
            errors.proxyUrl = 'Proxy address is required when a port is given.'
        else if (proxyUser !== '' || proxyPass !== '')
            errors.proxyUrl = 'Proxy address is required when credentials are given.'
        else if (input.proxyHttpToo)
            errors.proxyUrl = 'Proxy address is required for "also use for HTTP requests".'
    } else {
        const problem = valueProblem(proxyUrl, 'Proxy address')
        const parsed = problem === null ? parseProxyUrl(proxyUrl) : problem
        if (typeof parsed === 'string') errors.proxyUrl = parsed
        else {
            url = proxyUrl
            if (parsed.username !== '' || parsed.password !== '') {
                errors.proxyUrl =
                    'Put proxy credentials in the user name / password fields, not in the address.'
            }
        }
        port = parsePort(portText)
        if (port === null) errors.proxyPort = 'A proxy port from 1 to 65535 is required.'
        if (input.clearProxyCredentials) credentials = { kind: 'clear' }
        else if (proxyUser !== '' || proxyPass !== '') {
            const uErr = valueProblem(proxyUser, 'Proxy user name')
            const pErr = valueProblem(proxyPass, 'Proxy password')
            if (proxyUser === '' || proxyPass === '') {
                errors[proxyUser === '' ? 'proxyUsername' : 'proxyPassword'] =
                    'Proxy user name and password must be given together.'
            } else if (uErr !== null) errors.proxyUsername = uErr
            else if (pErr !== null) errors.proxyPassword = pErr
            else credentials = { kind: 'set', value: proxyPass }
        }
        const willHaveCreds =
            credentials.kind === 'set' ||
            (credentials.kind === 'keep' && (existing ?? NOTHING_SAVED).hasProxyCredentials)
        if (willHaveCreds && typeof parsed !== 'string' && /^socks[45]:$/i.test(parsed.protocol)) {
            errors.proxyUsername =
                'SOCKS proxies with a user name and password are not supported by the engine.'
        }
    }

    if (Object.keys(errors).length > 0) return { ok: false, errors }
    return {
        ok: true,
        value: {
            email,
            password,
            totp,
            recovery,
            langCode,
            geoLocale,
            proxy: {
                url,
                port,
                httpToo: url !== null && input.proxyHttpToo,
                credentials,
                username: credentials.kind === 'set' ? proxyUser : '',
                password: credentials.kind === 'set' ? proxyPass : ''
            }
        }
    }
}

// ---- problems in a file that already exists --------------------------------------------------------------------------

export interface RawAccountValues {
    readonly email?: string | undefined
    readonly langCode?: string | undefined
    readonly geoLocale?: string | undefined
    readonly proxyHttp?: string | undefined
    readonly proxyUrl?: string | undefined
    readonly proxyPort?: string | undefined
    readonly hasProxyUsername: boolean
    readonly hasProxyPassword: boolean
}

// Messages the engine would raise for these values (mirrors AccountSchema; engine reads the port with parseInt).
export function engineProblems(raw: RawAccountValues): string[] {
    const out: string[] = []
    if (raw.langCode !== undefined && normalizeLang(raw.langCode) === null) {
        out.push('Language is not a valid language tag.')
    }
    if (raw.geoLocale !== undefined && normalizeGeo(raw.geoLocale) === null) {
        out.push('Region must be "auto" or a two-letter country code.')
    }
    const rawPort = raw.proxyPort === undefined ? Number.NaN : Number.parseInt(raw.proxyPort, 10)
    const port = Number.isFinite(rawPort) ? rawPort : 0
    const httpToo =
        raw.proxyHttp !== undefined && ['1', 'true', 'yes', 'on'].includes(raw.proxyHttp.toLowerCase())
    const hasUrl = raw.proxyUrl !== undefined && raw.proxyUrl.trim() !== ''
    const hasUser = raw.hasProxyUsername
    const hasPass = raw.hasProxyPassword
    if (!hasUrl) {
        if (httpToo || port !== 0 || hasUser || hasPass) {
            out.push('Proxy address is missing but other proxy settings are present.')
        }
        return out
    }
    const parsed = parseProxyUrl(raw.proxyUrl ?? '')
    if (typeof parsed === 'string') {
        out.push(`Proxy address: ${parsed}`)
        return out
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) out.push('Proxy port must be from 1 to 65535.')
    if (parsed.username !== '' || parsed.password !== '')
        out.push('Proxy credentials are inside the address.')
    if (hasUser !== hasPass) out.push('Proxy user name and password must both be set or both be empty.')
    if (/^socks[45]:$/i.test(parsed.protocol) && (hasUser || hasPass)) {
        out.push('SOCKS proxies with credentials are not supported by the engine.')
    }
    return out
}
