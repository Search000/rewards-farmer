import { summaryText } from './health-rules'
import type { HealthState } from './health-types'
import { SECRET_FIELDS } from './secrets-rules'

// Phase 14: pure rules of the diagnostics bundle (no file, no clock, no process). The service that reads files and writes the
// ZIP is main/diagnosticsService.ts.
//
// Two layers keep secrets out of the bundle (master prompt rules 8 and 9 of Phase 14: "contains no secrets, sessions, tokens,
// cookies or real account data"):
//   1. Scrubber.text() cleans every piece of free text that goes in: known secret values and secret patterns (the same
//      Redactor the log files use), cookies, web tokens, long token-like strings, e-mail addresses, IP addresses and the
//      Windows user name in folder paths.
//   2. Scrubber.verify() is a SECOND, independent look at the finished file contents. If it still finds something, the
//      service refuses to save the bundle at all.

export const BUNDLE_SCHEMA = 1

// How much of each log goes in. Only the END of the file is read (the newest lines), never the whole file, so a huge log
// cannot make the export slow or the bundle big.
export const LOG_TAIL_MAX_BYTES = 1024 * 1024
export const LOG_TAIL_MAX_LINES = 2000
export const LOG_LINE_MAX_CHARS = 4000
// A finished bundle bigger than this is refused (it cannot happen with the limits above; this is a last safety net).
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024
// config.json is never read when it is bigger than this (a real one is a few KB). Same limit as the health check.
export const MAX_CONFIG_BYTES = 1024 * 1024

// audit.log is NOT included: it records what the user changed and when. Say so, so nobody wonders.
export const LOG_FILES: readonly { readonly file: string; readonly entry: string; readonly label: string }[] =
    [
        { file: 'app.log', entry: 'logs/app.log.txt', label: 'App log' },
        { file: 'engine.log', entry: 'logs/engine.log.txt', label: 'Engine log' },
        { file: 'errors.log', entry: 'logs/errors.log.txt', label: 'Errors log (engine warnings and errors)' }
    ]

// ---- scrubbing ------------------------------------------------------------------------------------------------------

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Patterns the shared Redactor does not know. Each replacement keeps the part before the secret so the text still reads well.
const EXTRA_PATTERNS: readonly (readonly [RegExp, string])[] = [
    [/\b((?:Set-)?Cookie)\s*:\s*[^\r\n]+/gi, '$1: ***'],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '***'],
    [
        /([?&;](?:access_token|refresh_token|id_token|session_?id|sid|csrf|xsrf|code|ticket|key|secret|sig|signature|auth|token)=)[^\s&"';]+/gi,
        '$1***'
    ],
    [/(?<![A-Za-z0-9_-])[0-9a-fA-F]{32,}(?![A-Za-z0-9_-])/g, '***'],
    // A long run of letters, digits, - and _ that has BOTH a letter and a digit looks like a token, not a word.
    [
        /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g,
        '***'
    ]
]

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)'
const IPV4 = new RegExp(`(?<![\\w.])(?:${OCTET}\\.){3}${OCTET}(?![\\w])(?!\\.\\d)`, 'g')
const WIN_USER_PATH = /([A-Za-z]:[\\/]+Users[\\/]+)(?!<user>)[^\\/\s"'<>|:*?]+/gi
const POSIX_USER_PATH = /(\/(?:home|Users)\/)(?!<user>)[^/\s"'\\]+/g

export interface ScrubberDeps {
    // The shared secret redactor of the app (known values + patterns).
    readonly redact: (text: string) => string
    // True when a secret value the app knows is still inside the text.
    readonly containsKnownSecret: (text: string) => boolean
    // The user's home folders (for example C:\Users\Jahid). Replaced by <home>.
    readonly homeDirs: readonly string[]
}

const isLoopbackOrZero = (ip: string): boolean => ip.startsWith('127.') || ip === '0.0.0.0'

export class Scrubber {
    private readonly emails = new Map<string, number>()
    private readonly homeRegexes: RegExp[]
    private readonly homeVariants: string[]

    constructor(private readonly deps: ScrubberDeps) {
        const variants = new Set<string>()
        for (const dir of deps.homeDirs) {
            const d = dir.trim()
            // Too short a folder name ("/" or "C:\") would wreck every path.
            if (d.length < 4) continue
            variants.add(d)
            variants.add(d.replace(/\\/g, '/'))
            variants.add(d.replace(/\//g, '\\'))
        }
        this.homeVariants = [...variants].sort((a, b) => b.length - a.length)
        this.homeRegexes = this.homeVariants.map((v) => new RegExp(escapeRegExp(v), 'gi'))
    }

    get emailCount(): number {
        return this.emails.size
    }

    // The same address always gets the same number inside one bundle, so a reader can still tell accounts apart.
    private alias(email: string): string {
        const key = email.toLowerCase()
        let n = this.emails.get(key)
        if (n === undefined) {
            n = this.emails.size + 1
            this.emails.set(key, n)
        }
        return `<email-${String(n)}>`
    }

    text(input: string): string {
        let out = this.deps.redact(input)
        for (const [re, replacement] of EXTRA_PATTERNS) out = out.replace(re, replacement)
        out = out.replace(EMAIL, (m) => this.alias(m))
        out = out.replace(IPV4, (m) => (isLoopbackOrZero(m) ? m : '<ip>'))
        for (const re of this.homeRegexes) out = out.replace(re, '<home>')
        out = out.replace(WIN_USER_PATH, '$1<user>')
        out = out.replace(POSIX_USER_PATH, '$1<user>')
        return out
    }

    // Cleans every string inside a plain value (object keys too). Numbers, booleans and null are kept.
    value(input: unknown, depth = 0): unknown {
        if (typeof input === 'string') return this.text(input)
        if (input === null || typeof input === 'number' || typeof input === 'boolean') return input
        if (depth > 12) return '<too deep>'
        if (Array.isArray(input)) return input.map((v) => this.value(v, depth + 1))
        if (typeof input === 'object') {
            const out: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(input as Record<string, unknown>))
                out[this.text(k)] = this.value(v, depth + 1)
            return out
        }
        return undefined
    }

    // Second look at finished file contents. Returns the KINDS of problem found (never the text), [] = clean.
    verify(text: string): string[] {
        const problems: string[] = []
        const add = (label: string, found: boolean): void => {
            if (found && !problems.includes(label)) problems.push(label)
        }
        add('a secret value the app knows', this.deps.containsKnownSecret(text))
        add('a bearer token', /Bearer\s+(?!\*\*\*)[A-Za-z0-9._~+/=-]{8,}/i.test(text))
        add('a webhook address', /discord(?:app)?\.com\/api\/webhooks\/\d+/i.test(text))
        add('a Telegram bot token', /(?<![0-9A-Za-z])(?:bot)?\d{6,}:[A-Za-z0-9_-]{30,}/i.test(text))
        add(
            'a web address with a user name and password',
            /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i.test(text)
        )
        add(
            'a password or secret with a value',
            /\b(?:password|passwd|totp[_-]?secret|totp|recovery[_-]?email|cookie|authorization|api[_-]?key|api[_-]?token|bot[_-]?token|secret)"?\s*[:=]\s*"?(?!\*\*\*|<|\s|Bearer\s+\*\*\*)[^\s",;}]+/i.test(
                text
            )
        )
        add(
            'an account setting with a value',
            /ACCOUNT_\d+_(?:PASSWORD|TOTP_SECRET|RECOVERY_EMAIL|PROXY_USERNAME|PROXY_PASSWORD)\s*=\s*(?!\*\*\*)\S+/i.test(
                text
            )
        )
        add('a cookie', /\b(?:Set-)?Cookie\s*:\s*(?!\*\*\*)\S/i.test(text))
        add('a web token', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/.test(text))
        add('an e-mail address', new RegExp(EMAIL.source).test(text))
        add(
            'an IP address',
            [...text.matchAll(IPV4)].some((m) => !isLoopbackOrZero(m[0]))
        )
        add(
            'a Windows user folder name',
            /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)(?!<user>)[^\\/\s"'<>|:*?]+/i.test(text)
        )
        const homeJson = this.homeVariants.map((v) => JSON.stringify(v).slice(1, -1))
        add(
            'the folder of the Windows user',
            [...this.homeVariants, ...homeJson].some((v) => text.toLowerCase().includes(v.toLowerCase()))
        )
        return problems
    }
}

// ---- configuration (config.json) ------------------------------------------------------------------------------------

// A text value under a key like this is hidden even when it looks harmless.
const SECRETISH_KEY =
    /pass|secret|token|key|cookie|auth|webhook|url|user|mail|proxy|chat|channel|room|topic|credential|session|bearer|jwt|signature|(?:^|[a-z])Id$|^id$/i
const MAX_TEXT_VALUE = 80
const MAX_ARRAY_ITEMS = 50
const MAX_OBJECT_KEYS = 200
const MAX_DEPTH = 8

const SECRET_PATHS = new Set(SECRET_FIELDS.map((f) => f.path.join('.')))

// Copy of the engine config for the bundle. Numbers, true/false and null are kept. Text is kept only when it is short, the
// key does not look secret and the scrubber would not change it; otherwise it is replaced by <hidden>. The fields the Secrets
// page manages are replaced by <set> / <not set>. Nothing else of config.json leaves this function.
export function cleanConfig(config: unknown, scrub: Scrubber): unknown {
    const walk = (value: unknown, path: readonly string[], depth: number): unknown => {
        const joined = path.join('.')
        if (SECRET_PATHS.has(joined)) return typeof value === 'string' && value !== '' ? '<set>' : '<not set>'
        if (value === null || typeof value === 'boolean') return value
        if (typeof value === 'number') return Number.isFinite(value) ? value : null
        if (typeof value === 'string') {
            if (value === '') return ''
            const key = path[path.length - 1] ?? ''
            if (SECRETISH_KEY.test(key)) return '<hidden>'
            if (value.length > MAX_TEXT_VALUE) return '<hidden: long text>'
            return scrub.text(value) === value ? value : '<hidden>'
        }
        if (depth >= MAX_DEPTH) return '<too deep>'
        if (Array.isArray(value)) {
            const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => walk(v, path, depth + 1))
            if (value.length > MAX_ARRAY_ITEMS)
                items.push(`<${String(value.length - MAX_ARRAY_ITEMS)} more not shown>`)
            return items
        }
        if (typeof value === 'object') {
            const out: Record<string, unknown> = {}
            const entries = Object.entries(value as Record<string, unknown>)
            for (const [k, v] of entries.slice(0, MAX_OBJECT_KEYS))
                out[scrub.text(k)] = walk(v, [...path, k], depth + 1)
            if (entries.length > MAX_OBJECT_KEYS)
                out['<more keys>'] = `${String(entries.length - MAX_OBJECT_KEYS)} more keys not shown`
            return out
        }
        return '<unsupported value>'
    }
    return walk(config, [], 0)
}

// ---- logs -----------------------------------------------------------------------------------------------------------

export interface TailResult {
    readonly lines: readonly string[]
    // true when the file was longer than what was read (or more lines than the limit), so older lines are not in the bundle.
    readonly cut: boolean
}

// `chunk` is the LAST part of a file. When the read started in the middle of the file (`fromMiddle`) the first line is
// probably cut in half, so it is dropped. Control characters (a broken or binary file) become "?" and one very long line is
// shortened, so a damaged log cannot spoil the bundle.
export function tailLines(chunk: string, fromMiddle: boolean, maxLines: number): TailResult {
    const all = chunk.split(/\r?\n/)
    if (all.length > 0 && all[all.length - 1] === '') all.pop()
    let cut = fromMiddle
    if (fromMiddle) all.shift()
    let lines = all
    if (lines.length > maxLines) {
        lines = lines.slice(lines.length - maxLines)
        cut = true
    }
    return {
        lines: lines.map((l) => {
            // eslint-disable-next-line no-control-regex
            const clean = l.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '?')
            return clean.length > LOG_LINE_MAX_CHARS
                ? `${clean.slice(0, LOG_LINE_MAX_CHARS)} ...[line shortened]`
                : clean
        }),
        cut
    }
}

export type LogFileStatus = 'included' | 'empty' | 'missing' | 'unreadable'

export interface LogFileReport {
    readonly file: string
    readonly status: LogFileStatus
    readonly sizeBytes: number | null
    readonly linesIncluded: number
    // true = older lines of this file are not in the bundle.
    readonly olderLinesLeftOut: boolean
    // Error code such as EACCES when the file could not be read.
    readonly code: string | null
}

// ---- health text ----------------------------------------------------------------------------------------------------

const STATUS_WORD = { ok: 'OK', warning: 'WARNING', error: 'PROBLEM', unknown: 'UNKNOWN' } as const

export function healthText(state: HealthState, scrub: Scrubber): string {
    const t = (s: string): string => scrub.text(s)
    const out: string[] = []
    out.push('Health checks of Rewards Farmer LUCK')
    out.push(state.finishedAt === null ? 'The checks have not finished.' : `Finished at ${state.finishedAt}`)
    out.push(summaryText(state.checks))
    out.push('')
    for (const c of state.checks) {
        out.push(`[${STATUS_WORD[c.status]}] ${c.title}`)
        out.push(`    ${t(c.detail)}`)
        if (c.fix !== null) out.push(`    What to do: ${t(c.fix)}`)
        out.push(`    Checked at ${c.checkedAt}`)
        out.push('')
    }
    return out.join('\n')
}

// ---- file name, path and error messages -----------------------------------------------------------------------------

export function defaultBundleName(date: Date): string {
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${String(date.getFullYear())}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
    return `rewards-farmer-diagnostics-${stamp}.zip`
}

// The bundle is always a .zip. A name without .zip gets it added. Because of that, the export can never be written over
// .env, config.json, a log or any other file the app cares about (none of them ends in .zip).
export function ensureZipName(path: string): string {
    return /\.zip$/i.test(path) ? path : `${path}.zip`
}

// Plain-language reason for a failed write, by the real error code from the operating system.
export function writeFailureMessage(code: string | undefined, path: string): string {
    switch (code) {
        case 'EACCES':
        case 'EPERM':
            return `Windows does not allow saving to that place (${path}). Choose another folder, for example Documents or Desktop, and export again.`
        case 'ENOENT':
            return `That folder does not exist (${path}). Choose a folder that exists, for example Documents or Desktop.`
        case 'ENOSPC':
            return 'The disk is full, so the file could not be saved. Free some disk space or choose another drive, then export again.'
        case 'EROFS':
            return 'That place is read-only, so the file could not be saved. Choose another folder, for example Documents.'
        case 'EISDIR':
        case 'EEXIST':
            return 'There is already a folder with that name. Choose a different file name.'
        case 'EBUSY':
            return 'That file is open in another program. Close it or choose a different file name, then export again.'
        case 'ENAMETOOLONG':
        case 'EINVAL':
            return 'That file name or folder path is not allowed (too long or has unusual characters). Choose a shorter name in Documents.'
        default:
            return `The file could not be saved${code === undefined ? '' : ` (${code})`}. Choose another folder, for example Documents, and export again.`
    }
}
