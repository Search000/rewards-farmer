import { validateSecret } from './secrets-rules'
import type { SecretId } from './secrets-types'
import type {
    ChannelReadiness,
    DeliveryKind,
    NotifyChannelId,
    NotifyChannelState,
    NotifyOutcome,
    UnsupportedChannel
} from './notifications-types'

// Phase 16: pure rules of the notification service (no file, no network). Paths are the real engine config fields
// (engine/src/interface/Config.ts, engine/src/logging/*.ts, engine/src/index.ts at the pinned commit).

export interface ChannelDef {
    readonly id: NotifyChannelId
    readonly label: string
    readonly delivery: DeliveryKind
    readonly deliveryText: string
    // Secret fields (Phase 10) this channel needs. All of them must be set and valid.
    readonly required: readonly SecretId[]
    // Optional secret field that is validated when present.
    readonly optional: readonly SecretId[]
    readonly path: readonly string[]
}

export const CHANNELS: readonly ChannelDef[] = [
    {
        id: 'discord',
        label: 'Discord',
        delivery: 'live',
        deliveryText:
            'While a run is going, the engine posts its log lines here. Debug lines are never sent. Which other lines go out depends on the log filter, see the note above the channels.',
        required: ['discordUrl'],
        optional: [],
        path: ['webhook', 'discord']
    },
    {
        id: 'ntfy',
        label: 'ntfy',
        delivery: 'live',
        deliveryText:
            'While a run is going, the engine posts its log lines here. Debug lines are never sent. Which other lines go out depends on the log filter, see the note above the channels.',
        required: ['ntfyUrl'],
        optional: ['ntfyToken'],
        path: ['webhook', 'ntfy']
    },
    {
        id: 'telegram',
        label: 'Telegram',
        delivery: 'live',
        deliveryText:
            'While a run is going, the engine posts its log lines here. Debug lines are never sent. Which other lines go out depends on the log filter, see the note above the channels.',
        required: ['telegramBotToken', 'telegramChatId'],
        optional: [],
        path: ['webhook', 'telegram']
    },
    {
        id: 'pushplus',
        label: 'PushPlus',
        delivery: 'summary',
        deliveryText: 'When a run ends, the engine posts one summary of the run.',
        required: ['pushplusToken'],
        optional: [],
        path: ['webhook', 'pushplus']
    }
]

// Evidence (Phase 16, really run): the engine's config check (engine/src/util/Validator.ts WebhookSchema) has no
// "serverchan" entry, so the engine throws that part of config.json away when it loads it. The summary code is dead.
export const UNSUPPORTED: readonly UnsupportedChannel[] = [
    {
        id: 'serverchan',
        label: 'ServerChan',
        reason: 'The engine drops the ServerChan setting when it loads config.json (its config check does not list it), so it never sends a ServerChan message. Not offered here.'
    },
    {
        id: 'clawbot',
        label: 'WeChat ClawBot',
        reason: 'It needs a QR-code login on your phone that the engine starts itself while a run begins. This app cannot do that safely, so it is not offered here.'
    }
]

export function isChannelId(value: unknown): value is NotifyChannelId {
    return typeof value === 'string' && CHANNELS.some((c) => c.id === value)
}

export function channelDef(id: NotifyChannelId): ChannelDef {
    const def = CHANNELS.find((c) => c.id === id)
    if (def === undefined) throw new Error('Unknown notification channel.')
    return def
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function walk(config: unknown, path: readonly string[]): unknown {
    let cur: unknown = config
    for (const key of path) {
        const rec = asRecord(cur)
        if (rec === null) return undefined
        cur = rec[key]
    }
    return cur
}

// The secret field names in config.json, per field id (the same paths as Phase 10).
const FIELD_KEY: Readonly<Record<string, string>> = {
    discordUrl: 'url',
    ntfyUrl: 'url',
    ntfyToken: 'token',
    telegramBotToken: 'botToken',
    telegramChatId: 'chatId',
    pushplusToken: 'token'
}

const FIELD_LABEL: Readonly<Record<string, string>> = {
    discordUrl: 'Discord webhook URL',
    ntfyUrl: 'ntfy server URL',
    ntfyToken: 'ntfy access token',
    telegramBotToken: 'Telegram bot token',
    telegramChatId: 'Telegram chat ID',
    pushplusToken: 'PushPlus token'
}

// The raw string saved for one field ('' when absent). A number chat ID is turned into text, like the engine does.
export function readField(config: unknown, def: ChannelDef, id: SecretId): string {
    const section = asRecord(walk(config, def.path))
    const key = FIELD_KEY[id]
    if (section === null || key === undefined) return ''
    const v = section[key]
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    return typeof v === 'string' ? v.trim() : ''
}

// Engine Logger.shouldPassFilter (checked in the source): with webhookLogFilter.enabled false the filter passes EVERY line,
// so every non-debug log line is posted to the live channels. Only enabled === true limits what is sent.
export function readLogFilter(config: unknown): 'on' | 'off' {
    const section = asRecord(walk(config, ['webhook', 'webhookLogFilter']))
    return section !== null && section['enabled'] === true ? 'on' : 'off'
}

export function readEnabled(config: unknown, def: ChannelDef): boolean {
    const section = asRecord(walk(config, def.path))
    return section !== null && section['enabled'] === true
}

// ntfy: the engine posts to <url>/<topic>. With no topic and no path in the address it would post to the server root,
// which ntfy does not accept for plain text. This is checked in main without sending anything.
export function ntfyTopic(config: unknown): string {
    const section = asRecord(walk(config, ['webhook', 'ntfy']))
    const t = section?.['topic']
    return typeof t === 'string' ? t.trim() : ''
}

export interface ChannelEvaluation {
    // Every needed field is saved and valid.
    readonly complete: boolean
    // At least one field is saved.
    readonly anySaved: boolean
    readonly problems: readonly string[]
    // The values, for main only. Empty strings when not saved. NEVER forward these.
    readonly values: Readonly<Record<string, string>>
}

export function evaluateChannel(config: unknown, id: NotifyChannelId): ChannelEvaluation {
    const def = channelDef(id)
    const values: Record<string, string> = {}
    const problems: string[] = []
    let anySaved = false
    let complete = true
    for (const field of [...def.required, ...def.optional]) {
        const raw = readField(config, def, field)
        values[field] = raw
        const needed = def.required.includes(field)
        if (raw === '') {
            if (needed) {
                complete = false
                problems.push(`${FIELD_LABEL[field] ?? field} is not set.`)
            }
            continue
        }
        anySaved = true
        const check = validateSecret(field, raw)
        if (!check.ok) {
            complete = false
            problems.push(`${FIELD_LABEL[field] ?? field}: ${check.message}`)
        }
    }
    if (id === 'ntfy' && values['ntfyUrl'] !== '' && complete) {
        let hasPath: boolean
        try {
            hasPath = new URL(values['ntfyUrl'] ?? '').pathname.replace(/\//g, '') !== ''
        } catch {
            hasPath = false
        }
        if (!hasPath && ntfyTopic(config) === '') {
            complete = false
            problems.push(
                'ntfy needs a topic. Put it at the end of the server address (for example https://ntfy.sh/my-topic).'
            )
        }
    }
    return { complete, anySaved, problems, values }
}

export function readinessOf(evaluation: ChannelEvaluation, enabled: boolean): ChannelReadiness {
    if (evaluation.complete) return enabled ? 'on' : 'ready-off'
    if (enabled || evaluation.anySaved) return 'misconfigured'
    return 'not-set-up'
}

export function channelState(config: unknown, id: NotifyChannelId): NotifyChannelState {
    const def = channelDef(id)
    const evaluation = evaluateChannel(config, id)
    const enabled = readEnabled(config, def)
    const readiness = readinessOf(evaluation, enabled)
    const problems = [...evaluation.problems]
    if (enabled && !evaluation.complete && !evaluation.anySaved) {
        problems.unshift('The channel is switched on in config.json but nothing is saved for it.')
    }
    const incompleteReason = problems[0] ?? 'The channel is not set up.'
    return {
        id,
        label: def.label,
        delivery: def.delivery,
        deliveryText: def.deliveryText,
        readiness,
        enabled,
        problems,
        testDisabledReason: evaluation.complete ? null : incompleteReason,
        // Switching ON needs a complete setup. Switching OFF is always allowed.
        toggleDisabledReason: enabled || evaluation.complete ? null : incompleteReason
    }
}

// Same limits as upstream (10 s timeout) and one test per channel every 5 s.
export const REQUEST_TIMEOUT_MS = 10_000
export const MIN_TEST_INTERVAL_MS = 5_000

export const TEST_TITLE = 'Rewards Farmer test'
export const TEST_TEXT =
    'Test message from the Rewards Farmer desktop app. You asked for it. Nothing is wrong and no account data is inside.'

export interface BuiltRequest {
    readonly url: string
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
    // The service answers inside the body even on HTTP 200 (PushPlus), so the body must be read.
    readonly checkBody: 'none' | 'telegram' | 'pushplus'
}

// The test message is plain text and fixed. It is NOT the engine's log format: no account, no points, no path.
export function buildRequest(
    config: unknown,
    id: NotifyChannelId,
    values: Readonly<Record<string, string>>
): BuiltRequest {
    const json = { 'Content-Type': 'application/json' }
    switch (id) {
        case 'discord':
            return {
                url: values['discordUrl'] ?? '',
                headers: json,
                body: JSON.stringify({
                    embeds: [{ title: TEST_TITLE, description: TEST_TEXT, color: 0x5865f2 }],
                    allowed_mentions: { parse: [] }
                }),
                checkBody: 'none'
            }
        case 'ntfy': {
            const base = (values['ntfyUrl'] ?? '').replace(/\/+$/, '')
            const topic = ntfyTopic(config)
            const headers: Record<string, string> = { 'Content-Type': 'text/plain', Title: TEST_TITLE }
            const token = values['ntfyToken'] ?? ''
            if (token !== '') headers['Authorization'] = `Bearer ${token}`
            return {
                url: topic === '' ? base : `${base}/${encodeURIComponent(topic)}`,
                headers,
                body: TEST_TEXT,
                checkBody: 'none'
            }
        }
        case 'telegram':
            return {
                url: `https://api.telegram.org/bot${values['telegramBotToken'] ?? ''}/sendMessage`,
                headers: json,
                // No parse_mode: the test text needs no escaping.
                body: JSON.stringify({
                    chat_id: values['telegramChatId'] ?? '',
                    text: `${TEST_TITLE}\n${TEST_TEXT}`
                }),
                checkBody: 'telegram'
            }
        case 'pushplus':
            return {
                url: 'https://www.pushplus.plus/send',
                headers: json,
                body: JSON.stringify({
                    token: values['pushplusToken'] ?? '',
                    title: TEST_TITLE,
                    content: TEST_TEXT,
                    template: 'txt'
                }),
                checkBody: 'pushplus'
            }
    }
}

export interface Classified {
    readonly outcome: NotifyOutcome
    readonly message: string
}

const OFFLINE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN'])
const REFUSED_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'EPIPE',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
])
const TIMEOUT_CODES = new Set([
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT'
])

// Finds the system error code inside a failed fetch (undici puts it in `cause`). Never returns message text.
export function errorCodeOf(error: unknown): string {
    let cur: unknown = error
    for (let i = 0; i < 4 && typeof cur === 'object' && cur !== null; i++) {
        const rec = cur as { code?: unknown; name?: unknown; cause?: unknown }
        if (typeof rec.code === 'string' && rec.code !== '') return rec.code
        if (rec.name === 'AbortError' || rec.name === 'TimeoutError') return 'TIMEOUT'
        cur = rec.cause
    }
    return ''
}

export function classifyNetworkError(error: unknown, label: string): Classified {
    const code = errorCodeOf(error)
    if (code === 'TIMEOUT' || TIMEOUT_CODES.has(code))
        return {
            outcome: 'timeout',
            message: `${label} did not answer within ${String(REQUEST_TIMEOUT_MS / 1000)} seconds. Try again in a minute. If it keeps happening, check your internet connection and that a firewall or VPN is not blocking the app.`
        }
    if (OFFLINE_CODES.has(code))
        return {
            outcome: 'offline',
            message: `No internet connection, or the address of ${label} could not be found. Check that this computer is online (open a web page), then try again.`
        }
    if (REFUSED_CODES.has(code))
        return {
            outcome: 'unreachable',
            message: `${label} could not be reached (${code}). A firewall, VPN or antivirus may be blocking the app, or the server address is wrong.`
        }
    return {
        outcome: 'failed',
        message: `The message to ${label} could not be sent${code === '' ? '' : ` (${code})`}. Nothing else was changed.`
    }
}

export function classifyHttp(status: number, label: string): Classified | null {
    if (status >= 200 && status < 300) return null
    if (status === 401 || status === 403)
        return {
            outcome: 'rejected',
            message: `${label} refused the saved token or address (HTTP ${String(status)}). Save the value again from the Secrets page, or make a new one at ${label}.`
        }
    if (status === 404)
        return {
            outcome: 'rejected',
            message: `${label} says this address does not exist (HTTP 404). The webhook or bot may have been deleted. Make a new one and save it on the Secrets page.`
        }
    if (status === 429)
        return {
            outcome: 'rejected',
            message: `${label} says you are sending too fast (HTTP 429). Wait a few minutes and try again.`
        }
    if (status >= 500)
        return {
            outcome: 'rejected',
            message: `${label} had a problem on its side (HTTP ${String(status)}). Try again later.`
        }
    return { outcome: 'rejected', message: `${label} refused the message (HTTP ${String(status)}).` }
}

// PushPlus and Telegram answer in the body. PushPlus returns HTTP 200 even for a wrong token (code != 200).
export function classifyBody(
    kind: BuiltRequest['checkBody'],
    text: string,
    label: string
): Classified | null {
    if (kind === 'none') return null
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return {
            outcome: 'rejected',
            message: `${label} answered in a form this app does not understand, so it cannot say if the message arrived.`
        }
    }
    const rec = asRecord(parsed)
    if (kind === 'telegram') {
        return rec !== null && rec['ok'] === true
            ? null
            : {
                  outcome: 'rejected',
                  message: `${label} did not accept the message. Check the bot token and the chat ID, and that the bot was added to the chat.`
              }
    }
    const code = rec?.['code']
    return code === 200
        ? null
        : {
              outcome: 'rejected',
              message: `${label} did not accept the message (answer code ${typeof code === 'number' ? String(code) : 'unknown'}). Check the token on the Secrets page.`
          }
}
