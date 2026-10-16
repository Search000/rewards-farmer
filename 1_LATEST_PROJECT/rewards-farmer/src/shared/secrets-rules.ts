import type { SecretGroup, SecretId } from './secrets-types'

// Phase 10: which config.json fields are secret, where they live, and what a valid value looks like.
// Paths are the real engine config fields (engine/src/interface/Config.ts, engine/src/util/Validator.ts).
// Messages never contain the value the person typed.

export interface SecretFieldDef {
    readonly id: SecretId
    readonly label: string
    readonly group: SecretGroup
    readonly help: string
    readonly path: readonly string[]
}

export const SECRET_FIELDS: readonly SecretFieldDef[] = [
    {
        id: 'discordUrl',
        label: 'Discord webhook URL',
        group: 'Discord',
        help: 'https://discord.com/api/webhooks/...',
        path: ['webhook', 'discord', 'url']
    },
    {
        id: 'ntfyUrl',
        label: 'ntfy server URL',
        group: 'ntfy',
        help: 'For example https://ntfy.sh. No user name or password inside the address.',
        path: ['webhook', 'ntfy', 'url']
    },
    {
        id: 'ntfyToken',
        label: 'ntfy access token',
        group: 'ntfy',
        help: 'Only needed for a protected topic.',
        path: ['webhook', 'ntfy', 'token']
    },
    {
        id: 'telegramBotToken',
        label: 'Telegram bot token',
        group: 'Telegram',
        help: 'From @BotFather. Looks like 123456789:AA...',
        path: ['webhook', 'telegram', 'botToken']
    },
    {
        id: 'telegramChatId',
        label: 'Telegram chat ID',
        group: 'Telegram',
        help: 'A number (can start with -) or @channelname.',
        path: ['webhook', 'telegram', 'chatId']
    },
    {
        id: 'pushplusToken',
        label: 'PushPlus token',
        group: 'PushPlus',
        help: 'From pushplus.plus.',
        path: ['webhook', 'pushplus', 'token']
    },
    {
        id: 'serverchanSendKey',
        label: 'ServerChan SendKey',
        group: 'ServerChan',
        help: 'From sct.ftqq.com.',
        path: ['webhook', 'serverchan', 'sendKey']
    },
    {
        id: 'chinaApiAppkey',
        label: 'China search API appkey',
        group: 'China search API',
        help: 'Optional. Empty = the free tier with rate limits.',
        path: ['searchSettings', 'chinaApi', 'appkey']
    }
]

export const MAX_SECRET_LENGTH = 512

// What the engine's GET /config puts in place of the secrets it hides (engine/scripts/api/lib.js redactSecrets).
// A field showing this text IS set, but its exact value cannot be read through the API.
export const ENGINE_MASK = '***REDACTED***'

export function isSecretId(value: unknown): value is SecretId {
    return typeof value === 'string' && SECRET_FIELDS.some((f) => f.id === value)
}

export function secretDef(id: SecretId): SecretFieldDef {
    const def = SECRET_FIELDS.find((f) => f.id === id)
    if (def === undefined) throw new Error('Unknown secret id.')
    return def
}

function hasControlCharacter(text: string): boolean {
    for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0
        if (code < 0x20 || code === 0x7f) return true
    }
    return false
}
const generic = (min: number, max: number): RegExp => new RegExp(`^\\S{${String(min)},${String(max)}}$`)

export type SecretCheck =
    { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string }

const bad = (message: string): SecretCheck => ({ ok: false, message })

export function validateSecret(id: SecretId, raw: unknown): SecretCheck {
    if (typeof raw !== 'string') return bad('The value must be text.')
    const value = raw.trim()
    if (value === '') return bad('The value is empty. Use Clear to remove a saved value.')
    if (value.length > MAX_SECRET_LENGTH)
        return bad(`The value is longer than ${String(MAX_SECRET_LENGTH)} characters.`)
    if (hasControlCharacter(value)) return bad('The value contains a line break or a control character.')
    switch (id) {
        case 'discordUrl':
            return /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(
                value
            )
                ? { ok: true, value }
                : bad(
                      'This is not a Discord webhook address (https://discord.com/api/webhooks/<id>/<token>).'
                  )
        case 'ntfyUrl': {
            let url: URL
            try {
                url = new URL(value)
            } catch {
                return bad('This is not a valid web address.')
            }
            if (url.protocol !== 'https:' && url.protocol !== 'http:')
                return bad('The address must start with https:// or http://.')
            if (url.username !== '' || url.password !== '')
                return bad(
                    'Do not put a user name or password inside the address. Use the access token field.'
                )
            return { ok: true, value }
        }
        case 'telegramBotToken':
            return /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(value)
                ? { ok: true, value }
                : bad('This does not look like a Telegram bot token (123456789:AA...).')
        case 'telegramChatId':
            return /^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(value)
                ? { ok: true, value }
                : bad('The chat ID must be a number (can start with -) or @channelname.')
        case 'ntfyToken':
        case 'pushplusToken':
        case 'serverchanSendKey':
            return generic(8, 200).test(value)
                ? { ok: true, value }
                : bad('Expected 8 to 200 characters without spaces.')
        case 'chinaApiAppkey':
            return generic(4, 200).test(value)
                ? { ok: true, value }
                : bad('Expected 4 to 200 characters without spaces.')
    }
}

function walk(config: unknown, path: readonly string[]): unknown {
    let cur: unknown = config
    for (const key of path) {
        if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined
        cur = (cur as Record<string, unknown>)[key]
    }
    return cur
}

// The saved value as the engine API returned it, or '' when absent. Internal use in main only: never forward it.
export function readSecretValue(config: unknown, id: SecretId): string {
    const v = walk(config, secretDef(id).path)
    return typeof v === 'string' ? v.trim() : ''
}

// Deep-merge body for PATCH /config that changes exactly this one field.
export function buildSecretPatch(id: SecretId, value: string): Record<string, unknown> {
    const path = secretDef(id).path
    const root: Record<string, unknown> = {}
    let cur = root
    path.forEach((key, i) => {
        if (i === path.length - 1) cur[key] = value
        else {
            const next: Record<string, unknown> = {}
            cur[key] = next
            cur = next
        }
    })
    return root
}
