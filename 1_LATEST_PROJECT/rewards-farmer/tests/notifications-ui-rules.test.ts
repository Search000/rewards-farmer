import { describe, expect, it } from 'vitest'
import type { FarmerState } from '../src/shared/farmer-types'
import { channelState } from '../src/shared/notifications-rules'
import type {
    NotificationsState,
    NotifyChannelState,
    NotifyOutcome,
    NotifyTestResult
} from '../src/shared/notifications-types'
import {
    ENGINE_NOT_READY_REASON,
    OFFLINE_NOTE,
    PAGE_FOOTER,
    PAGE_INTRO,
    READINESS_VIEW,
    RUN_ACTIVE_REASON,
    UNSUPPORTED_SHORT,
    WAITING_REASON,
    WORKING_REASON,
    bridgeFailureView,
    logFilterView,
    pageProblemView,
    summaryText,
    testDisabledReason,
    testView,
    toggleDisabledReason
} from '../src/shared/notifications-ui-rules'
import { FAKE } from './fixtures/fake-secrets'

// Phase 17: the pure rules behind the Notifications page. No window, no file, no network.

function farmer(
    over: { link?: FarmerState['engine']['link']; phase?: FarmerState['run']['phase'] } = {}
): FarmerState {
    return {
        engine: { link: over.link ?? 'ready', detail: null, version: '4.3.2.4' },
        accounts: { path: null, status: 'not-set', error: null, count: null },
        run: { phase: over.phase ?? 'idle', startedAt: null, lastExit: null },
        current: { account: null, points: null, section: null, detail: null, proxy: null },
        summary: { all: null, finished: null, failed: null },
        timer: { enabled: false, time: '00:00', nextFireAt: null },
        startDisabledReason: null,
        stopDisabledReason: null,
        notices: [],
        updatedAt: '2026-10-15T10:00:00.000Z'
    }
}

const complete = { webhook: { discord: { url: FAKE.discordUrl, enabled: false } } }
const completeOn = { webhook: { discord: { url: FAKE.discordUrl, enabled: true } } }
const empty = { webhook: {} }
const partial = { webhook: { telegram: { botToken: FAKE.telegramBotToken } } }

function result(outcome: NotifyOutcome, requestMade: boolean, message = 'Some text.'): NotifyTestResult {
    return { ok: outcome === 'sent', message, channel: 'discord', outcome, requestMade }
}

describe('readiness chip', () => {
    it('every readiness has its own words (never colour alone)', () => {
        const texts = Object.values(READINESS_VIEW).map((v) => v.text)
        expect(new Set(texts).size).toBe(4)
        expect(READINESS_VIEW.on.text).toBe('On')
        expect(READINESS_VIEW.misconfigured.color).toBe('warning')
    })
})

describe('switch: disabled reason (rule 17)', () => {
    const ready = channelState(complete, 'discord')
    const on = channelState(completeOn, 'discord')
    const notSet = channelState(empty, 'discord')
    const broken = channelState(partial, 'telegram')

    it('allowed when the channel is complete, the engine is ready and no run is active', () => {
        expect(toggleDisabledReason(farmer(), ready, false)).toBeUndefined()
        expect(toggleDisabledReason(farmer(), on, false)).toBeUndefined()
    })
    it('a channel that is not set up cannot be switched on, and says what is missing', () => {
        const reason = toggleDisabledReason(farmer(), notSet, false)
        expect(reason).toMatch(/Discord webhook URL is not set/)
    })
    it('a half-set-up channel says the first problem', () => {
        expect(toggleDisabledReason(farmer(), broken, false)).toMatch(/Telegram chat ID is not set/)
    })
    it('a channel that is already on can still be switched OFF when set up wrongly (off is always allowed by the service)', () => {
        const onButBroken = channelState({ webhook: { discord: { url: 'nope', enabled: true } } }, 'discord')
        expect(onButBroken.readiness).toBe('misconfigured')
        expect(onButBroken.toggleDisabledReason).toBeNull()
        // ...but the engine has to be ready, like for every config change.
        expect(toggleDisabledReason(farmer(), onButBroken, false)).toBeUndefined()
        expect(toggleDisabledReason(farmer({ link: 'down' }), onButBroken, false)).toBe(
            ENGINE_NOT_READY_REASON
        )
    })
    it('engine not ready: every state except ready blocks the switch', () => {
        for (const link of ['not-started', 'starting', 'down', 'failed'] as const)
            expect(toggleDisabledReason(farmer({ link }), ready, false)).toBe(ENGINE_NOT_READY_REASON)
    })
    it('a run in progress blocks the switch, an idle or unknown engine run state does not', () => {
        for (const phase of ['starting', 'running', 'stopping'] as const)
            expect(toggleDisabledReason(farmer({ phase }), ready, false)).toBe(RUN_ACTIVE_REASON)
        expect(toggleDisabledReason(farmer({ phase: 'idle' }), ready, false)).toBeUndefined()
    })
    it('while the app state is not known yet the switch says it is waiting', () => {
        expect(toggleDisabledReason(null, ready, false)).toBe(WAITING_REASON)
    })
    it('while a change is being saved the switch says Working', () => {
        expect(toggleDisabledReason(farmer(), ready, true)).toBe(WORKING_REASON)
    })
})

describe('test button: disabled reason', () => {
    it('allowed for a complete channel even when the engine is down (a test does not need the engine)', () => {
        expect(testDisabledReason(channelState(complete, 'discord'), false)).toBeUndefined()
    })
    it('blocked, with the first problem, for an incomplete channel', () => {
        expect(testDisabledReason(channelState(empty, 'discord'), false)).toMatch(
            /Discord webhook URL is not set/
        )
    })
    it('blocked while a test is going out', () => {
        expect(testDisabledReason(channelState(complete, 'discord'), true)).toMatch(/being sent/)
    })
})

describe('test result view', () => {
    const outcomes: readonly NotifyOutcome[] = [
        'sent',
        'not-configured',
        'misconfigured',
        'permission-denied',
        'too-soon',
        'offline',
        'unreachable',
        'timeout',
        'rejected',
        'failed'
    ]

    it('every outcome has its own title, so none is shown as another', () => {
        const titles = outcomes.map((o) => testView(result(o, true)).title)
        expect(new Set(titles).size).toBe(outcomes.length)
    })
    it('only "sent" is a success', () => {
        for (const o of outcomes) expect(testView(result(o, true)).tone === 'success').toBe(o === 'sent')
    })
    it('permission denied, misconfigured and offline are shown as the states the master prompt names', () => {
        expect(testView(result('permission-denied', false)).title).toMatch(/Windows blocked access/)
        expect(testView(result('misconfigured', false)).title).toMatch(/Setup problem/)
        expect(testView(result('offline', true)).title).toMatch(/No internet/)
        expect(testView(result('offline', true)).tone).toBe('warning')
    })
    it('the exact failure text of the service is kept', () => {
        expect(testView(result('rejected', true, 'Discord refused (HTTP 404).')).detail).toBe(
            'Discord refused (HTTP 404).'
        )
    })
    it('says honestly whether a request was started', () => {
        expect(testView(result('not-configured', false)).requestLine).toMatch(/No request/)
        expect(testView(result('sent', true)).requestLine).toMatch(/was sent to the service/)
    })
    it('a failed bridge call does not claim that nothing was sent', () => {
        const v = bridgeFailureView('boom')
        expect(v.requestLine).toMatch(/not known/)
        expect(v.detail).toContain('boom')
        expect(v.tone).toBe('error')
        expect(bridgeFailureView(null).detail).not.toContain('(null)')
        expect(bridgeFailureView('').detail).not.toContain('()')
    })
})

describe('page problem and summary', () => {
    const base = { channels: [], unsupported: [], updatedAt: '2026-10-15T10:00:00.000Z' } as const
    const stateOf = (over: Partial<NotificationsState>): NotificationsState => ({
        status: 'error',
        problem: 'unreadable',
        logFilter: 'unknown',
        reason: 'x',
        ...base,
        ...over
    })

    it('a readable state has no page problem', () => {
        expect(pageProblemView(stateOf({ status: 'ok', problem: null, reason: null }))).toBeNull()
    })
    it('each reason has its own title and keeps the service text', () => {
        const titles = (['missing', 'permission', 'invalid', 'unreadable'] as const).map((problem) => {
            const v = pageProblemView(
                stateOf({
                    problem,
                    status: problem === 'missing' ? 'unavailable' : 'error',
                    reason: `R-${problem}`
                })
            )
            expect(v?.detail).toBe(`R-${problem}`)
            return v?.title
        })
        expect(new Set(titles).size).toBe(4)
        expect(pageProblemView(stateOf({ problem: 'permission' }))?.title).toMatch(/Windows blocked access/)
        expect(pageProblemView(stateOf({ problem: 'missing', status: 'unavailable' }))?.tone).toBe('warning')
    })
    it('summary: none on, some on, and attention', () => {
        const none: NotifyChannelState[] = [channelState(empty, 'discord'), channelState(empty, 'ntfy')]
        expect(summaryText(none)).toBe('No channel is on. The engine sends no notifications.')
        const one: NotifyChannelState[] = [channelState(completeOn, 'discord'), channelState(empty, 'ntfy')]
        expect(summaryText(one)).toBe('1 of 2 channels is on: Discord.')
        const attn: NotifyChannelState[] = [
            channelState(completeOn, 'discord'),
            channelState(partial, 'telegram')
        ]
        expect(summaryText(attn)).toBe('1 of 2 channels is on: Discord. 1 channel needs attention.')
    })
})

describe('log filter note', () => {
    it('off = warns that everything except debug is sent; on = only matches; unknown = no claim', () => {
        expect(logFilterView('off')?.tone).toBe('warning')
        expect(logFilterView('off')?.text).toMatch(/EVERY log line except debug/)
        expect(logFilterView('on')?.text).toMatch(/only the lines that match/)
        expect(logFilterView('unknown')).toBeNull()
    })
})

describe('texts', () => {
    it('no fixed text contains anything that looks like a secret, and the footer promises only what the service does', () => {
        for (const t of [PAGE_INTRO, PAGE_FOOTER, OFFLINE_NOTE, ...Object.values(UNSUPPORTED_SHORT)]) {
            expect(t).not.toMatch(/https?:\/\//)
            expect(t).not.toMatch(/token_|bot\d/i)
        }
        expect(PAGE_FOOTER).toMatch(/only when you press "Send test message"/)
    })
    it('no typed command is told to the user (rule 27)', () => {
        for (const t of [PAGE_INTRO, PAGE_FOOTER, OFFLINE_NOTE, bridgeFailureView(null).detail])
            expect(t).not.toMatch(/npm |npx |cmd|powershell/i)
        expect(bridgeFailureView(null).detail).toMatch(/START\.bat/)
    })
})
