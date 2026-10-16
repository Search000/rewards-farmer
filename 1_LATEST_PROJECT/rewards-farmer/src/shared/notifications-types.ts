import type { ActionResult } from './farmer-types'

// Phase 16: notification service (backend only; the settings screen is Phase 17).
// RULE: a notification address, token or chat ID never travels to the renderer (rule 8, Phase 10).
// The renderer learns only "set / not set", "on / off" and a plain-language problem text.

// Channels the upstream engine really delivers at the pinned commit (see docs/configuration-reference.md, Phase 16).
export type NotifyChannelId = 'discord' | 'ntfy' | 'telegram' | 'pushplus'

// Channels that exist in the upstream folder but do NOT work through config.json. They are listed, never offered.
export type UnsupportedChannelId = 'serverchan' | 'clawbot'

// live    = the engine posts log lines while it runs.
// summary = the engine posts one summary when a run ends.
export type DeliveryKind = 'live' | 'summary'

// not-set-up    : no address / token saved yet.
// misconfigured : something saved is unusable, or the channel is ON but incomplete.
// ready-off     : everything saved and valid, channel is OFF (the engine will not use it).
// on            : everything saved and valid, channel is ON (the engine will use it on the next run).
export type ChannelReadiness = 'not-set-up' | 'misconfigured' | 'ready-off' | 'on'

export interface NotifyChannelState {
    readonly id: NotifyChannelId
    readonly label: string
    readonly delivery: DeliveryKind
    readonly deliveryText: string
    readonly readiness: ChannelReadiness
    readonly enabled: boolean
    // Plain-language things that are missing or unusable. Never contains a saved value.
    readonly problems: readonly string[]
    // null = "Send test" allowed. A string = disabled and this is why (rule 17).
    readonly testDisabledReason: string | null
    // null = Switch on / off allowed. A string = disabled and this is why.
    readonly toggleDisabledReason: string | null
}

export interface UnsupportedChannel {
    readonly id: UnsupportedChannelId
    readonly label: string
    readonly reason: string
}

// Why the state could not be read (Phase 17: the screen shows a different title for each). null when status is 'ok'.
//   missing    : config.json does not exist.
//   permission : Windows refused to let the app read config.json.
//   invalid    : config.json is not valid JSON.
//   unreadable : any other read failure.
export type StateProblem = 'missing' | 'permission' | 'invalid' | 'unreadable'

export interface NotificationsState {
    // ok = read from the real config.json. unavailable = file missing. error = file unusable / not readable.
    readonly status: 'ok' | 'unavailable' | 'error'
    readonly problem: StateProblem | null
    // webhook.webhookLogFilter.enabled of config.json. 'unknown' when config.json could not be read.
    readonly logFilter: 'on' | 'off' | 'unknown'
    readonly reason: string | null
    readonly channels: readonly NotifyChannelState[]
    readonly unsupported: readonly UnsupportedChannel[]
    readonly updatedAt: string
}

// sent            : the service accepted it (HTTP success and, where the service answers in the body, an OK answer).
// not-configured  : nothing (or not enough) is saved. NO request was made.
// misconfigured   : a saved value is unusable. NO request was made.
// permission-denied: config.json could not be read because Windows refused. NO request was made.
// too-soon        : the same channel was tested a few seconds ago. NO request was made.
// offline         : no internet or the name could not be looked up.
// unreachable     : the server did not accept the connection.
// timeout         : no answer within the time limit.
// rejected        : the service answered and refused (wrong token, deleted webhook, rate limit, server error).
// failed          : any other failure.
export type NotifyOutcome =
    | 'sent'
    | 'not-configured'
    | 'misconfigured'
    | 'permission-denied'
    | 'too-soon'
    | 'offline'
    | 'unreachable'
    | 'timeout'
    | 'rejected'
    | 'failed'

export interface NotifyTestResult extends ActionResult {
    readonly channel: NotifyChannelId | null
    readonly outcome: NotifyOutcome
    // true only when a network request was really started.
    readonly requestMade: boolean
}

export const NOTIFICATIONS_IPC = {
    getState: 'notifications:get-state',
    setEnabled: 'notifications:set-enabled',
    sendTest: 'notifications:send-test'
} as const

export interface NotificationsApi {
    getNotificationsState(): Promise<NotificationsState>
    setNotificationEnabled(id: NotifyChannelId, enabled: boolean): Promise<ActionResult>
    sendTestNotification(id: NotifyChannelId): Promise<NotifyTestResult>
}
