import type { FarmerState } from './farmer-types'
import type {
    ChannelReadiness,
    NotificationsState,
    NotifyChannelState,
    NotifyOutcome,
    NotifyTestResult,
    UnsupportedChannelId
} from './notifications-types'

// Phase 17: the pure rules behind the Notifications page. No window, no file, no network. Every text the page shows
// that is not a service message lives here, so it can be tested and checked for secrets and typed commands (rule 27).

export type Tone = 'success' | 'info' | 'warning' | 'error'

// ---------------------------------------------------------------------------------------------------------------------
// Channel chip. Words, never colour alone.
// ---------------------------------------------------------------------------------------------------------------------

export interface ReadinessView {
    readonly text: string
    readonly color: 'default' | 'success' | 'warning'
}

export const READINESS_VIEW: Readonly<Record<ChannelReadiness, ReadinessView>> = {
    on: { text: 'On', color: 'success' },
    'ready-off': { text: 'Off - ready to switch on', color: 'default' },
    misconfigured: { text: 'Needs attention', color: 'warning' },
    'not-set-up': { text: 'Not set up', color: 'default' }
}

// ---------------------------------------------------------------------------------------------------------------------
// Disabled reasons (rule 17): a disabled control always says why.
// ---------------------------------------------------------------------------------------------------------------------

export const ENGINE_NOT_READY_REASON =
    'The engine is not ready, so the setting cannot be saved now. Start the engine from Home or the Health page.'
export const RUN_ACTIVE_REASON =
    'A run is active. Switches are locked until it ends, because the engine reads its settings when a run starts.'
export const WAITING_REASON = 'Waiting for the app to report the engine state.'
export const WORKING_REASON = 'Working...'
const TEST_BUSY_REASON = 'A test message is being sent. Wait for the result.'

const RUN_BUSY: ReadonlySet<FarmerState['run']['phase']> = new Set(['starting', 'running', 'stopping'])

// undefined = the switch may be used.
export function toggleDisabledReason(
    farmer: FarmerState | null,
    channel: NotifyChannelState,
    busy: boolean
): string | undefined {
    if (busy) return WORKING_REASON
    if (farmer === null) return WAITING_REASON
    // Switching OFF is always allowed by the service; it only refuses to switch ON a channel that is not complete.
    if (channel.toggleDisabledReason !== null) return channel.toggleDisabledReason
    if (farmer.engine.link !== 'ready') return ENGINE_NOT_READY_REASON
    if (RUN_BUSY.has(farmer.run.phase)) return RUN_ACTIVE_REASON
    return undefined
}

// A test needs no engine: it reads config.json and sends one request itself.
export function testDisabledReason(channel: NotifyChannelState, testing: boolean): string | undefined {
    if (testing) return TEST_BUSY_REASON
    return channel.testDisabledReason ?? undefined
}

// ---------------------------------------------------------------------------------------------------------------------
// Test result.
// ---------------------------------------------------------------------------------------------------------------------

export interface TestView {
    readonly tone: Tone
    readonly title: string
    // The exact text of the service. Never rewritten.
    readonly detail: string
    // Says honestly whether a network request was started.
    readonly requestLine: string
}

const OUTCOME_VIEW: Readonly<Record<NotifyOutcome, { readonly tone: Tone; readonly title: string }>> = {
    sent: { tone: 'success', title: 'Test message sent' },
    'not-configured': { tone: 'warning', title: 'Not set up - nothing was sent' },
    misconfigured: { tone: 'warning', title: 'Setup problem - nothing was sent' },
    'permission-denied': { tone: 'error', title: 'Windows blocked access - nothing was sent' },
    'too-soon': { tone: 'info', title: 'Too soon - nothing was sent' },
    offline: { tone: 'warning', title: 'No internet connection' },
    unreachable: { tone: 'error', title: 'Could not connect' },
    timeout: { tone: 'error', title: 'No answer in time' },
    rejected: { tone: 'error', title: 'The service refused the message' },
    failed: { tone: 'error', title: 'The message could not be sent' }
}

export function testView(result: NotifyTestResult): TestView {
    const v = OUTCOME_VIEW[result.outcome]
    return {
        tone: v.tone,
        title: v.title,
        detail: result.message,
        requestLine: result.requestMade
            ? 'A message was sent to the service.'
            : 'No request was sent to any service.'
    }
}

// The call itself failed (for example the bridge closed). Whether something went out is NOT known, so say so.
export function bridgeFailureView(message: string | null): TestView {
    const why = message !== null && message.trim() !== '' ? ` (${message.trim()})` : ''
    return {
        tone: 'error',
        title: 'The test could not be run',
        detail: `The app could not reach its own settings service${why}. Close the app and open it again with START.bat.`,
        requestLine: 'It is not known whether a message was sent.'
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Page state.
// ---------------------------------------------------------------------------------------------------------------------

export interface ProblemView {
    readonly tone: Tone
    readonly title: string
    readonly detail: string
}

const PROBLEM_TITLE: Readonly<
    Record<NonNullable<NotificationsState['problem']>, { tone: Tone; title: string }>
> = {
    missing: { tone: 'warning', title: 'config.json is missing' },
    permission: { tone: 'error', title: 'Windows blocked access to config.json' },
    invalid: { tone: 'error', title: 'config.json is not valid' },
    unreadable: { tone: 'error', title: 'config.json could not be read' }
}

// null = the settings were read, show the channels.
export function pageProblemView(state: NotificationsState): ProblemView | null {
    if (state.problem === null) return null
    const v = PROBLEM_TITLE[state.problem]
    return {
        tone: v.tone,
        title: v.title,
        detail: state.reason ?? 'The notification settings are not available.'
    }
}

export function summaryText(channels: readonly NotifyChannelState[]): string {
    const on = channels.filter((c) => c.readiness === 'on')
    const attention = channels.filter((c) => c.readiness === 'misconfigured').length
    const first =
        on.length === 0
            ? 'No channel is on. The engine sends no notifications.'
            : `${on.length} of ${channels.length} channels ${on.length === 1 ? 'is' : 'are'} on: ${on
                  .map((c) => c.label)
                  .join(', ')}.`
    if (attention === 0) return first
    return `${first} ${attention} ${attention === 1 ? 'channel needs' : 'channels need'} attention.`
}

// ---------------------------------------------------------------------------------------------------------------------
// Fixed page texts.
// ---------------------------------------------------------------------------------------------------------------------

export const PAGE_INTRO =
    'Choose where the engine sends messages while it works. A switch is saved at once. Addresses, tokens and chat IDs are saved on the Secrets & API keys page and are never shown here.'

export interface LogFilterView {
    readonly tone: Tone
    readonly text: string
}

// What the engine will really send to Discord, ntfy and Telegram (PushPlus sends one run summary and is not affected).
export function logFilterView(filter: NotificationsState['logFilter']): LogFilterView | null {
    switch (filter) {
        case 'off':
            return {
                tone: 'warning',
                text: 'No log filter is switched on in config.json, so the engine sends EVERY log line except debug lines to Discord, ntfy and Telegram while a run is going. That can be many messages, and the lines can contain your account e-mail addresses. This app cannot edit the filter yet.'
            }
        case 'on':
            return {
                tone: 'info',
                text: 'A log filter is switched on in config.json (webhookLogFilter), so Discord, ntfy and Telegram get only the lines that match it. This app cannot edit the filter yet.'
            }
        default:
            return null
    }
}

export const OFFLINE_NOTE =
    'This computer looks offline. A test may fail until the connection is back. You can still try it: the result below is the real one.'

export const UNSUPPORTED_SHORT: Readonly<Record<UnsupportedChannelId, string>> = {
    serverchan: 'the engine ignores this setting',
    clawbot: 'needs a QR login on your phone that this app cannot do safely'
}

export const PAGE_FOOTER =
    'A message goes out only when you press "Send test message", or while a run is going for a channel that is On. Opening this page sends nothing.'
