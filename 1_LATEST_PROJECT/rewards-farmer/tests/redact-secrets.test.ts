import { describe, expect, it } from 'vitest'
import { Redactor } from '../src/main/engine/redact'
import { FAKE } from './fixtures/fake-secrets'

// Phase 10: redaction tests with deliberately fake token strings (test-only, isolated).
describe('redaction of Phase 10 secrets', () => {
    it('masks every value the app knows by value, in any text, longest first', () => {
        const r = new Redactor()
        for (const v of Object.values(FAKE)) r.add(v)
        const text = Object.values(FAKE)
            .map((v) => `value=${v}`)
            .join('\n')
        const out = r.redact(text)
        for (const v of Object.values(FAKE)) expect(out).not.toContain(v)
    })

    it('masks Discord webhook addresses and Telegram bot tokens even when the value was never registered', () => {
        const r = new Redactor()
        const out = r.redact(`POST ${FAKE.discordUrl} and /bot${FAKE.telegramBotToken}/sendMessage`)
        expect(out).not.toContain('FAKEdiscordTOKEN')
        expect(out).not.toContain('FAKEtelegramTOKEN')
    })

    it('masks key=value forms used in config and env style text', () => {
        const r = new Redactor()
        const out = r.redact(
            `botToken: ${FAKE.pushplusToken}\napi_key=${FAKE.chinaApiAppkey}\nauthorization: Bearer ${FAKE.ntfyToken}`
        )
        expect(out).not.toContain(FAKE.pushplusToken)
        expect(out).not.toContain(FAKE.chinaApiAppkey)
        expect(out).not.toContain(FAKE.ntfyToken)
    })
})
