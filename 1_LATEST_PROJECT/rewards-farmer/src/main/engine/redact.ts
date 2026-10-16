// Secret redaction (docs/architecture.md section 13, threat model T4). Runs in main before ANY write or send.
// Two layers: (1) a registry of exact secret values learned at runtime (passwords, TOTP, API token, ...),
// (2) generic patterns for secrets we may not know by value (bearer tokens, URLs with credentials, webhook URLs).
// Account e-mail addresses are NOT redacted (user decision 7: full e-mails visible).

export const MASK = '***'
const MIN_SECRET_LENGTH = 4 // shorter values would mangle ordinary text; documented limit

const PATTERNS: readonly RegExp[] = [
    /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    /(x-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
    /([?&]token=)[^\s&"']+/gi,
    /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*(?=@)/gi,
    /https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\S+/gi,
    // Telegram bot token. No leading word boundary: in API URLs it follows the letters "bot" (.../bot123456:AA.../sendMessage).
    /(?<![0-9A-Za-z])(?:bot)?\d{6,}:[A-Za-z0-9_-]{30,}/gi,
    /("?(?:password|passwd|totp[_-]?secret|totp|recovery[_-]?email|secret|cookie|authorization|api[_-]?key|api[_-]?token|bot[_-]?token)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
    /(ACCOUNT_\d+_(?:PASSWORD|TOTP_SECRET|RECOVERY_EMAIL|PROXY_USERNAME|PROXY_PASSWORD)\s*=\s*)\S+/gi
]

export class Redactor {
    private readonly secrets = new Set<string>()

    // Register an exact secret value. Values shorter than MIN_SECRET_LENGTH are ignored (see note above).
    add(value: string | undefined | null): void {
        if (typeof value !== 'string') return
        const v = value.trim()
        if (v.length >= MIN_SECRET_LENGTH) this.secrets.add(v)
    }

    clear(): void {
        this.secrets.clear()
    }

    // True when the text still holds a secret value this app has learned (used by the diagnostics safety check).
    containsKnownSecret(text: string): boolean {
        for (const secret of this.secrets) if (text.includes(secret)) return true
        return false
    }

    redact(text: string): string {
        let out = text
        // Longest first so a secret that contains another one is fully masked.
        const known = [...this.secrets].sort((a, b) => b.length - a.length)
        for (const secret of known) out = out.split(secret).join(MASK)
        for (const re of PATTERNS) {
            out = out.replace(re, (_match: string, prefix?: string) => `${typeof prefix === 'string' ? prefix : ''}${MASK}`)
        }
        return out
    }
}
