import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    CHANNELS,
    MIN_TEST_INTERVAL_MS,
    REQUEST_TIMEOUT_MS,
    TEST_TEXT,
    UNSUPPORTED,
    buildRequest,
    channelDef,
    channelState,
    classifyBody,
    classifyHttp,
    classifyNetworkError,
    errorCodeOf,
    evaluateChannel,
    isChannelId,
    readEnabled,
    readinessOf
} from '../src/shared/notifications-rules'
import type { NotifyChannelId } from '../src/shared/notifications-types'
import { FAKE } from './fixtures/fake-secrets'

// Phase 16: pure rules of the notification service. No file, no network.

const example = JSON.parse(
    readFileSync(join(__dirname, '..', 'engine', 'config.example.json'), 'utf8')
) as Record<string, Record<string, Record<string, unknown>>>

const ids = CHANNELS.map((c) => c.id)

function configWith(patch: Record<string, Record<string, unknown>>): unknown {
    const copy = JSON.parse(JSON.stringify(example)) as Record<
        string,
        Record<string, Record<string, unknown>>
    >
    for (const [channel, fields] of Object.entries(patch)) {
        copy['webhook'] = copy['webhook'] ?? {}
        copy['webhook'][channel] = { ...(copy['webhook'][channel] ?? {}), ...fields }
    }
    return copy
}

const FULL: Record<NotifyChannelId, Record<string, unknown>> = {
    discord: { url: FAKE.discordUrl },
    ntfy: { url: FAKE.ntfyUrl, topic: 'my-topic', token: FAKE.ntfyToken },
    telegram: { botToken: FAKE.telegramBotToken, chatId: FAKE.telegramChatId },
    pushplus: { token: FAKE.pushplusToken }
}

describe('notification channels match the real engine (Phase 16)', () => {
    it('every offered channel has a real section with an enabled flag in the engine example config', () => {
        for (const def of CHANNELS) {
            const section = example['webhook']?.[def.id]
            expect(section, def.id).toBeDefined()
            expect(typeof section?.['enabled'], def.id).toBe('boolean')
            expect(def.path).toEqual(['webhook', def.id])
        }
    })

    it('offers exactly the four channels that work through config.json', () => {
        expect(ids).toEqual(['discord', 'ntfy', 'telegram', 'pushplus'])
        expect(isChannelId('discord')).toBe(true)
        expect(isChannelId('serverchan')).toBe(false)
        expect(isChannelId('clawbot')).toBe(false)
        expect(isChannelId(7)).toBe(false)
        expect(isChannelId(undefined)).toBe(false)
    })

    it('lists the two channels it does not offer, each with a reason', () => {
        expect(UNSUPPORTED.map((u) => u.id)).toEqual(['serverchan', 'clawbot'])
        for (const u of UNSUPPORTED) {
            expect(u.reason.length).toBeGreaterThan(20)
            expect(ids).not.toContain(u.id)
        }
    })

    it('the engine config check really has no ServerChan entry (reason stays true)', () => {
        const validator = readFileSync(join(__dirname, '..', 'engine', 'src', 'util', 'Validator.ts'), 'utf8')
        const start = validator.indexOf('WebhookSchema')
        expect(start).toBeGreaterThan(-1)
        const block = validator.slice(start, start + 2500)
        expect(block).toMatch(/discord/i)
        expect(/serverchan/i.test(block)).toBe(false)
    })

    it('delivery kinds: three live channels and PushPlus as a run summary', () => {
        expect(channelDef('discord').delivery).toBe('live')
        expect(channelDef('ntfy').delivery).toBe('live')
        expect(channelDef('telegram').delivery).toBe('live')
        expect(channelDef('pushplus').delivery).toBe('summary')
    })
})

describe('channel state (Phase 16)', () => {
    it('an untouched example config: every channel is not-set-up, off, with test and switch disabled and a reason', () => {
        for (const id of ids) {
            const s = channelState(example, id)
            expect(s.readiness, id).toBe('not-set-up')
            expect(s.enabled, id).toBe(false)
            expect(s.testDisabledReason, id).not.toBeNull()
            expect(s.toggleDisabledReason, id).not.toBeNull()
        }
    })

    it('complete and off = ready-off; complete and on = on; switching off is always allowed', () => {
        for (const id of ids) {
            const off = channelState(configWith({ [id]: { ...FULL[id], enabled: false } }), id)
            expect(off.readiness, id).toBe('ready-off')
            expect(off.testDisabledReason, id).toBeNull()
            expect(off.toggleDisabledReason, id).toBeNull()
            const on = channelState(configWith({ [id]: { ...FULL[id], enabled: true } }), id)
            expect(on.readiness, id).toBe('on')
            expect(on.enabled, id).toBe(true)
        }
    })

    it('switched on but nothing saved = misconfigured, and says so; the switch stays usable to turn it off', () => {
        const s = channelState(configWith({ discord: { enabled: true } }), 'discord')
        expect(s.readiness).toBe('misconfigured')
        expect(s.problems[0]).toMatch(/switched on/)
        expect(s.toggleDisabledReason).toBeNull()
    })

    it('a saved but unusable value = misconfigured, and the problem never contains the value', () => {
        const bad = 'https://example.com/not-a-discord-hook-SECRETPART123'
        const s = channelState(configWith({ discord: { url: bad } }), 'discord')
        expect(s.readiness).toBe('misconfigured')
        expect(s.testDisabledReason).not.toBeNull()
        expect(JSON.stringify(s)).not.toContain('SECRETPART123')
    })

    it('Telegram needs both the token and the chat ID', () => {
        const only = channelState(configWith({ telegram: { botToken: FAKE.telegramBotToken } }), 'telegram')
        expect(only.readiness).toBe('misconfigured')
        expect(only.problems.join(' ')).toMatch(/chat ID is not set/)
        const both = channelState(configWith({ telegram: FULL.telegram }), 'telegram')
        expect(both.readiness).toBe('ready-off')
    })

    it('a chat ID saved as a number is accepted as text, like the engine does', () => {
        const cfg = configWith({ telegram: { botToken: FAKE.telegramBotToken, chatId: -1001234567890 } })
        expect(evaluateChannel(cfg, 'telegram').complete).toBe(true)
    })

    it('ntfy needs a topic: in the address or in the topic field', () => {
        const none = channelState(configWith({ ntfy: { url: FAKE.ntfyUrl, topic: '' } }), 'ntfy')
        expect(none.readiness).toBe('misconfigured')
        expect(none.problems.join(' ')).toMatch(/topic/)
        expect(
            channelState(configWith({ ntfy: { url: FAKE.ntfyUrl, topic: 'alerts' } }), 'ntfy').readiness
        ).toBe('ready-off')
        expect(
            channelState(configWith({ ntfy: { url: 'https://ntfy.example.com/alerts', topic: '' } }), 'ntfy')
                .readiness
        ).toBe('ready-off')
    })

    it('the state that goes to the screen never holds any saved value (rule 8)', () => {
        for (const id of ids) {
            const json = JSON.stringify(
                channelState(configWith({ [id]: { ...FULL[id], enabled: true } }), id)
            )
            for (const v of Object.values(FAKE))
                expect(json.includes(v), `${id} leaks ${v.slice(0, 6)}`).toBe(false)
        }
    })

    it('readEnabled only trusts a real boolean true', () => {
        const def = channelDef('discord')
        expect(readEnabled(configWith({ discord: { enabled: true } }), def)).toBe(true)
        expect(readEnabled(configWith({ discord: { enabled: 'true' } }), def)).toBe(false)
        expect(readEnabled(configWith({ discord: { enabled: 1 } }), def)).toBe(false)
        expect(readEnabled({}, def)).toBe(false)
        expect(readEnabled(null, def)).toBe(false)
        expect(readEnabled('text', def)).toBe(false)
    })

    it('readinessOf covers every combination', () => {
        const ev = (complete: boolean, anySaved: boolean) => ({
            complete,
            anySaved,
            problems: [],
            values: {}
        })
        expect(readinessOf(ev(true, true), true)).toBe('on')
        expect(readinessOf(ev(true, true), false)).toBe('ready-off')
        expect(readinessOf(ev(false, true), false)).toBe('misconfigured')
        expect(readinessOf(ev(false, false), true)).toBe('misconfigured')
        expect(readinessOf(ev(false, false), false)).toBe('not-set-up')
    })

    it('garbage config shapes do not throw', () => {
        for (const cfg of [null, undefined, 5, 'x', [], { webhook: null }, { webhook: { discord: 'x' } }]) {
            for (const id of ids) {
                expect(channelState(cfg, id).readiness, `${JSON.stringify(cfg)} ${id}`).toBe('not-set-up')
            }
        }
    })
})

describe('test request (Phase 16)', () => {
    const build = (id: NotifyChannelId) => {
        const cfg = configWith({ [id]: FULL[id] })
        return buildRequest(cfg, id, evaluateChannel(cfg, id).values)
    }

    it('goes to the right address for each channel', () => {
        expect(build('discord').url).toBe(FAKE.discordUrl)
        expect(build('ntfy').url).toBe('https://ntfy.example.com/my-topic')
        expect(build('telegram').url).toBe(`https://api.telegram.org/bot${FAKE.telegramBotToken}/sendMessage`)
        expect(build('pushplus').url).toBe('https://www.pushplus.plus/send')
    })

    it('ntfy: a trailing slash is dropped, the token goes in a header, no topic means the address is used as is', () => {
        const cfg = configWith({
            ntfy: { url: 'https://ntfy.example.com/alerts/', topic: '', token: 'tk_abcdef123456' }
        })
        const r = buildRequest(cfg, 'ntfy', evaluateChannel(cfg, 'ntfy').values)
        expect(r.url).toBe('https://ntfy.example.com/alerts')
        expect(r.headers['Authorization']).toBe('Bearer tk_abcdef123456')
        const noToken = configWith({ ntfy: { url: FAKE.ntfyUrl, topic: 'a b', token: '' } })
        const r2 = buildRequest(noToken, 'ntfy', evaluateChannel(noToken, 'ntfy').values)
        expect(r2.headers['Authorization']).toBeUndefined()
        expect(r2.url).toBe('https://ntfy.example.com/a%20b')
    })

    it('Discord test cannot mention anyone', () => {
        const body = JSON.parse(build('discord').body) as { allowed_mentions: { parse: unknown[] } }
        expect(body.allowed_mentions.parse).toEqual([])
    })

    it('only fixed text is sent: no account, path or run data', () => {
        for (const id of ids) {
            const r = build(id)
            expect(r.body, id).toContain('Rewards Farmer')
            expect(r.body, id).not.toMatch(/@example\.com|password|C:\\|points/i)
        }
        expect(TEST_TEXT).toMatch(/Nothing is wrong/)
    })

    it('Telegram and PushPlus answers are read from the body; the others are not', () => {
        expect(build('discord').checkBody).toBe('none')
        expect(build('ntfy').checkBody).toBe('none')
        expect(build('telegram').checkBody).toBe('telegram')
        expect(build('pushplus').checkBody).toBe('pushplus')
    })

    it('limits match upstream and the spec (10 s, one test per 5 s)', () => {
        expect(REQUEST_TIMEOUT_MS).toBe(10_000)
        expect(MIN_TEST_INTERVAL_MS).toBe(5_000)
    })
})

describe('failure classification (Phase 16)', () => {
    it('finds the system error code inside a nested fetch error', () => {
        expect(errorCodeOf(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))).toBe('ENOTFOUND')
        expect(errorCodeOf({ name: 'TimeoutError' })).toBe('TIMEOUT')
        expect(errorCodeOf({ name: 'AbortError' })).toBe('TIMEOUT')
        expect(errorCodeOf(new Error('plain'))).toBe('')
        expect(errorCodeOf(null)).toBe('')
        expect(errorCodeOf('text')).toBe('')
    })

    it('offline / unreachable / timeout / failed', () => {
        const withCode = (code: string) => new TypeError('fetch failed', { cause: { code } })
        expect(classifyNetworkError(withCode('ENOTFOUND'), 'Discord').outcome).toBe('offline')
        expect(classifyNetworkError(withCode('EAI_AGAIN'), 'Discord').outcome).toBe('offline')
        expect(classifyNetworkError(withCode('ENETUNREACH'), 'Discord').outcome).toBe('offline')
        expect(classifyNetworkError(withCode('ECONNREFUSED'), 'Discord').outcome).toBe('unreachable')
        expect(classifyNetworkError(withCode('ECONNRESET'), 'Discord').outcome).toBe('unreachable')
        expect(classifyNetworkError(withCode('ETIMEDOUT'), 'Discord').outcome).toBe('timeout')
        expect(classifyNetworkError({ name: 'TimeoutError' }, 'Discord').outcome).toBe('timeout')
        expect(classifyNetworkError(new Error('boom'), 'Discord').outcome).toBe('failed')
    })

    it('never puts the error text in the message (it can quote an address or token)', () => {
        const e = new TypeError('connect to https://discord.com/api/webhooks/1/SECRETTOKEN failed')
        const c = classifyNetworkError(e, 'Discord')
        expect(c.message).not.toContain('SECRETTOKEN')
    })

    it('HTTP: success passes, everything else is rejected with a plain reason', () => {
        expect(classifyHttp(200, 'Discord')).toBeNull()
        expect(classifyHttp(204, 'Discord')).toBeNull()
        expect(classifyHttp(401, 'ntfy')?.message).toMatch(/refused the saved token/)
        expect(classifyHttp(403, 'ntfy')?.outcome).toBe('rejected')
        expect(classifyHttp(404, 'Discord')?.message).toMatch(/does not exist/)
        expect(classifyHttp(429, 'Discord')?.message).toMatch(/too fast/)
        expect(classifyHttp(500, 'Discord')?.message).toMatch(/on its side/)
        expect(classifyHttp(503, 'Discord')?.outcome).toBe('rejected')
        expect(classifyHttp(400, 'Discord')?.outcome).toBe('rejected')
        expect(classifyHttp(302, 'Discord')?.outcome).toBe('rejected')
    })

    it('body: PushPlus answers 200 inside a 200 response; anything else is rejected', () => {
        expect(classifyBody('none', 'whatever', 'x')).toBeNull()
        expect(classifyBody('pushplus', '{"code":200,"msg":"ok"}', 'PushPlus')).toBeNull()
        expect(classifyBody('pushplus', '{"code":600,"msg":"bad token"}', 'PushPlus')?.outcome).toBe(
            'rejected'
        )
        expect(classifyBody('pushplus', '{"msg":"x"}', 'PushPlus')?.message).toMatch(/unknown/)
        expect(classifyBody('pushplus', '<html>', 'PushPlus')?.outcome).toBe('rejected')
        expect(classifyBody('telegram', '{"ok":true}', 'Telegram')).toBeNull()
        expect(
            classifyBody('telegram', '{"ok":false,"description":"chat not found"}', 'Telegram')?.outcome
        ).toBe('rejected')
        expect(classifyBody('telegram', 'nope', 'Telegram')?.outcome).toBe('rejected')
    })
})
