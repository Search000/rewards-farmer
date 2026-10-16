import { describe, expect, it } from 'vitest'
import {
    MAX_SECRET_LENGTH,
    SECRET_FIELDS,
    buildSecretPatch,
    isSecretId,
    readSecretValue,
    validateSecret
} from '../src/shared/secrets-rules'
import type { SecretId } from '../src/shared/secrets-types'
import { FAKE } from './fixtures/fake-secrets'

describe('secret rules (Phase 10)', () => {
    it('every field has a path that exists in the engine example config', async () => {
        const { readFileSync } = await import('node:fs')
        const { join } = await import('node:path')
        const example = JSON.parse(
            readFileSync(join(__dirname, '..', 'engine', 'config.example.json'), 'utf8')
        ) as unknown
        for (const f of SECRET_FIELDS) {
            let cur: unknown = example
            for (const key of f.path) {
                expect(
                    typeof cur === 'object' && cur !== null && key in cur,
                    `${f.id} path ${f.path.join('.')}`
                ).toBe(true)
                cur = (cur as Record<string, unknown>)[key]
            }
            expect(typeof cur, f.id).toBe('string')
        }
    })

    it('ids are unique and isSecretId only accepts known ids', () => {
        expect(new Set(SECRET_FIELDS.map((f) => f.id)).size).toBe(SECRET_FIELDS.length)
        expect(isSecretId('discordUrl')).toBe(true)
        expect(isSecretId('password')).toBe(false)
        expect(isSecretId(5)).toBe(false)
        expect(isSecretId(undefined)).toBe(false)
    })

    it('accepts a well-formed fake value for every field and trims it', () => {
        for (const id of Object.keys(FAKE) as SecretId[]) {
            const res = validateSecret(id, `  ${FAKE[id]}  `)
            expect(res, id).toEqual({ ok: true, value: FAKE[id] })
        }
    })

    it('refuses empty, non-text, too long and control-character values without echoing the value', () => {
        for (const f of SECRET_FIELDS) {
            for (const raw of [
                '',
                '   ',
                5,
                null,
                undefined,
                {},
                'x'.repeat(MAX_SECRET_LENGTH + 1),
                'ab\ncd',
                'ab\u0000cd'
            ]) {
                const res = validateSecret(f.id, raw)
                expect(res.ok, `${f.id}: ${String(raw).slice(0, 12)}`).toBe(false)
            }
        }
        const res = validateSecret('telegramBotToken', 'not-a-token-SECRETPART')
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.message).not.toContain('SECRETPART')
    })

    it('field specific formats', () => {
        expect(validateSecret('discordUrl', 'http://discord.com/api/webhooks/1/abc').ok).toBe(false)
        expect(validateSecret('discordUrl', 'https://evil.example.com/api/webhooks/1/abc').ok).toBe(false)
        expect(validateSecret('ntfyUrl', 'ftp://ntfy.example.com').ok).toBe(false)
        expect(validateSecret('ntfyUrl', 'https://user:pass@ntfy.example.com').ok).toBe(false)
        expect(validateSecret('ntfyUrl', 'http://127.0.0.1:8080').ok).toBe(true)
        expect(validateSecret('telegramChatId', '@mychannel').ok).toBe(true)
        expect(validateSecret('telegramChatId', '-100123').ok).toBe(true)
        expect(validateSecret('telegramChatId', 'chat 1').ok).toBe(false)
        expect(validateSecret('pushplusToken', 'has space 12345678').ok).toBe(false)
        expect(validateSecret('chinaApiAppkey', 'abc').ok).toBe(false)
    })

    it('buildSecretPatch changes exactly one nested field', () => {
        expect(buildSecretPatch('telegramBotToken', 'v')).toEqual({
            webhook: { telegram: { botToken: 'v' } }
        })
        expect(buildSecretPatch('chinaApiAppkey', '')).toEqual({
            searchSettings: { chinaApi: { appkey: '' } }
        })
    })

    it('readSecretValue reads the real path and returns empty text for anything else', () => {
        const cfg = {
            webhook: { discord: { url: ' https://x ' } },
            searchSettings: { chinaApi: { appkey: 5 } }
        }
        expect(readSecretValue(cfg, 'discordUrl')).toBe('https://x')
        expect(readSecretValue(cfg, 'chinaApiAppkey')).toBe('')
        expect(readSecretValue(cfg, 'ntfyToken')).toBe('')
        expect(readSecretValue(null, 'ntfyToken')).toBe('')
        expect(readSecretValue([], 'ntfyToken')).toBe('')
    })
})
