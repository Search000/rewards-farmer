// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cleanAccountInput, engineProblems } from '../../src/shared/accounts-rules'
import { EMPTY_ACCOUNT_INPUT } from '../../src/shared/accounts-types'
import type { AccountInput } from '../../src/shared/accounts-types'
import { buildChanges, checkEdit } from '../../src/main/accounts'
import {
    applyChanges,
    EnvEditError,
    formatValue,
    listSlots,
    nextFreeSlot,
    removeSlot
} from '../../src/main/engine/envEdit'

// Pure tests of the accounts-file editor and of the validation rules. All accounts here are FAKE fixtures (rule 18).

const BASE = [
    '# My accounts',
    'API_TOKEN=keep-this',
    '',
    '# Account 1',
    'ACCOUNT_1_EMAIL=alpha@example.com',
    'ACCOUNT_1_PASSWORD=pw-alpha-1',
    '#ACCOUNT_1_TOTP_SECRET=',
    'ACCOUNT_1_LANG_CODE=en',
    'ACCOUNT_1_SAVE_FINGERPRINT_DESKTOP=true',
    '',
    '# Account 3',
    'ACCOUNT_3_EMAIL=gamma@example.com',
    ''
].join('\n')

const input = (over: Partial<AccountInput>): AccountInput => ({ ...EMPTY_ACCOUNT_INPUT, ...over })

describe('listSlots', () => {
    it('lists accounts in slot order and ignores slots without an e-mail', () => {
        const text =
            'ACCOUNT_5_PASSWORD=x1234\nACCOUNT_2_EMAIL=b@example.com\nACCOUNT_1_EMAIL=a@example.com\nACCOUNT_4_EMAIL=\n'
        expect(listSlots(text).map((s) => s.slot)).toEqual([1, 2])
    })
    it('reads quotes, comments and CRLF like the engine', () => {
        const text = '# c\r\nACCOUNT_1_EMAIL="a@example.com"\r\nACCOUNT_1_PASSWORD=\'p w\'\r\n'
        const [s] = listSlots(text)
        expect(s?.values['EMAIL']).toBe('a@example.com')
        expect(s?.values['PASSWORD']).toBe('p w')
    })
    it('a UTF-8 BOM in front of the first line does not hide the first account', () => {
        expect(listSlots('\uFEFFACCOUNT_1_EMAIL=a@example.com\n')).toHaveLength(1)
    })
})

describe('nextFreeSlot', () => {
    it('is max + 1, also counting slots that have no e-mail', () => {
        expect(nextFreeSlot(BASE)).toBe(4)
        expect(nextFreeSlot('ACCOUNT_7_PASSWORD=abcd\n')).toBe(8)
        expect(nextFreeSlot('')).toBe(1)
    })
})

describe('formatValue', () => {
    it('keeps plain values and wraps values that start and end with the same quote', () => {
        expect(formatValue('abc#def=ghi')).toBe('abc#def=ghi')
        expect(formatValue('"abc"')).toBe('""abc""')
        expect(formatValue("'abc'")).toBe('"\'abc\'"')
        expect(formatValue('"abc')).toBe('"abc')
    })
    it('refuses line breaks, control characters and edge spaces', () => {
        expect(() => formatValue('a\nb')).toThrow(EnvEditError)
        expect(() => formatValue('a\u0000b')).toThrow(EnvEditError)
        expect(() => formatValue(' a')).toThrow(EnvEditError)
        expect(() => formatValue('a ')).toThrow(EnvEditError)
    })
    it('round trip: what is written is read back unchanged', () => {
        for (const v of ['p@ss#word', '"quoted"', "'x'", 'a=b', '"half', "it's"]) {
            const text = applyChanges('', 1, { EMAIL: 'a@example.com', PASSWORD: v })
            expect(listSlots(text)[0]?.values['PASSWORD']).toBe(v)
        }
    })
})

describe('applyChanges: edit existing account', () => {
    it('changes one line and leaves every other byte alone', () => {
        const out = applyChanges(BASE, 1, { PASSWORD: 'new-pass-9' })
        expect(out).toBe(BASE.replace('pw-alpha-1', 'new-pass-9'))
    })
    it('adds a missing line after the last line of that account', () => {
        const out = applyChanges(BASE, 1, { RECOVERY_EMAIL: 'rec@example.com' })
        const lines = out.split('\n')
        const i = lines.indexOf('ACCOUNT_1_SAVE_FINGERPRINT_DESKTOP=true')
        expect(lines[i + 1]).toBe('ACCOUNT_1_RECOVERY_EMAIL=rec@example.com')
        expect(lines[i + 2]).toBe('')
    })
    it('removes a line, keeps commented lines of the same account', () => {
        const out = applyChanges(BASE, 1, { LANG_CODE: null })
        expect(out).not.toContain('ACCOUNT_1_LANG_CODE')
        expect(out).toContain('#ACCOUNT_1_TOTP_SECRET=')
    })
    it('undefined leaves a field alone, null on a missing field does nothing', () => {
        expect(applyChanges(BASE, 1, { PASSWORD: undefined, TOTP_SECRET: null })).toBe(BASE)
    })
    it('never touches variables it does not manage', () => {
        const out = applyChanges(BASE, 1, { EMAIL: 'z@example.com' })
        expect(out).toContain('ACCOUNT_1_SAVE_FINGERPRINT_DESKTOP=true')
        expect(out).toContain('API_TOKEN=keep-this')
    })
    it('changes every duplicate of a key so the result does not depend on which one the engine reads', () => {
        const text = 'ACCOUNT_1_EMAIL=a@example.com\nACCOUNT_1_PASSWORD=old1\nACCOUNT_1_PASSWORD=old2\n'
        const out = applyChanges(text, 1, { PASSWORD: 'fresh1' })
        expect(out).toBe(
            'ACCOUNT_1_EMAIL=a@example.com\nACCOUNT_1_PASSWORD=fresh1\nACCOUNT_1_PASSWORD=fresh1\n'
        )
    })
    it('keeps indentation, CRLF line endings and a BOM', () => {
        const text = '\uFEFF  ACCOUNT_1_EMAIL=a@example.com\r\nACCOUNT_1_PASSWORD=old1\r\n'
        const out = applyChanges(text, 1, { EMAIL: 'b@example.com', TOTP_SECRET: 'ABCDEF234567' })
        expect(out).toBe(
            '\uFEFF  ACCOUNT_1_EMAIL=b@example.com\r\nACCOUNT_1_PASSWORD=old1\r\nACCOUNT_1_TOTP_SECRET=ABCDEF234567\r\n'
        )
    })
    it('a file without a final newline stays without one when the last line changes', () => {
        expect(applyChanges('ACCOUNT_1_EMAIL=a@example.com', 1, { EMAIL: 'b@example.com' })).toBe(
            'ACCOUNT_1_EMAIL=b@example.com'
        )
    })
    it('adding a line after a last line without newline keeps the file well formed', () => {
        const out = applyChanges('ACCOUNT_1_EMAIL=a@example.com', 1, { PASSWORD: 'secret1' })
        expect(out).toBe('ACCOUNT_1_EMAIL=a@example.com\nACCOUNT_1_PASSWORD=secret1')
    })
})

describe('applyChanges: new account', () => {
    it('is appended with a header after one blank line', () => {
        const out = applyChanges(BASE, 4, { EMAIL: 'delta@example.com', PASSWORD: 'pw-delta' })
        expect(out.startsWith(BASE)).toBe(true)
        expect(out.slice(BASE.length)).toBe(
            '\n# Account 4\nACCOUNT_4_EMAIL=delta@example.com\nACCOUNT_4_PASSWORD=pw-delta\n'
        )
    })
    it('works on an empty file and on a file that does not end with a newline', () => {
        expect(applyChanges('', 1, { EMAIL: 'a@example.com' })).toBe(
            '# Account 1\nACCOUNT_1_EMAIL=a@example.com\n'
        )
        const out = applyChanges('X=1', 1, { EMAIL: 'a@example.com' })
        expect(out).toBe('X=1\n\n# Account 1\nACCOUNT_1_EMAIL=a@example.com')
    })
    it('uses CRLF when the file uses CRLF', () => {
        const out = applyChanges('X=1\r\n', 1, { EMAIL: 'a@example.com', PASSWORD: 'secret1' })
        expect(out).toBe(
            'X=1\r\n\r\n# Account 1\r\nACCOUNT_1_EMAIL=a@example.com\r\nACCOUNT_1_PASSWORD=secret1\r\n'
        )
    })
})

describe('removeSlot', () => {
    it('removes that account and its header, nothing else', () => {
        const out = removeSlot(BASE, 3)
        expect(out).not.toContain('ACCOUNT_3_')
        expect(out).not.toContain('# Account 3')
        expect(out).toContain('ACCOUNT_1_EMAIL=alpha@example.com')
        expect(out).toContain('API_TOKEN=keep-this')
    })
    it('keeps commented-out lines and the other accounts byte for byte', () => {
        const out = removeSlot(BASE, 1)
        expect(out).toContain('#ACCOUNT_1_TOTP_SECRET=')
        expect(out).toContain('ACCOUNT_3_EMAIL=gamma@example.com')
        expect(out).not.toContain('ACCOUNT_1_EMAIL')
    })
    it('a missing slot changes nothing', () => {
        expect(removeSlot(BASE, 9)).toBe(BASE)
    })
    it('removing the final line of a file without final newline leaves no dangling newline', () => {
        expect(removeSlot('X=1\nACCOUNT_1_EMAIL=a@example.com', 1)).toBe('X=1')
    })
})

describe('checkEdit (safety net)', () => {
    it('accepts a correct edit and refuses one that touches other variables', () => {
        const ok = applyChanges(BASE, 1, { PASSWORD: 'new-pass-9' })
        expect(checkEdit(BASE, ok, 1, 'alpha@example.com')).toBeNull()
        const broken = ok.replace('API_TOKEN=keep-this', 'API_TOKEN=changed')
        expect(checkEdit(BASE, broken, 1, 'alpha@example.com')).not.toBeNull()
    })
    it('detects an account that is still there after removal', () => {
        expect(checkEdit(BASE, BASE, 1, null)).not.toBeNull()
        expect(checkEdit(BASE, removeSlot(BASE, 1), 1, null)).toBeNull()
    })
})

describe('validation rules (mirror of the engine validator)', () => {
    const ok = (
        over: Partial<AccountInput>,
        others: string[] = [],
        existing = null as Parameters<typeof cleanAccountInput>[2]
    ) => cleanAccountInput(input({ email: 'a@example.com', ...over }), others, existing)

    it('requires a plausible e-mail and refuses a duplicate (case-insensitive)', () => {
        expect(ok({ email: '' }).ok).toBe(false)
        expect(ok({ email: 'not-an-email' }).ok).toBe(false)
        expect(ok({ email: 'A@Example.com' }, ['a@example.com']).ok).toBe(false)
        expect(ok({}).ok).toBe(true)
    })
    it('language must be a valid BCP 47 tag and is normalised', () => {
        expect(ok({ langCode: 'pt-br' })).toMatchObject({ ok: true, value: { langCode: 'pt-BR' } })
        expect(ok({ langCode: 'not a tag' }).ok).toBe(false)
        expect(ok({ langCode: '' })).toMatchObject({ ok: true, value: { langCode: null } })
    })
    it('region is "auto" or two letters', () => {
        expect(ok({ geoLocale: 'bd' })).toMatchObject({ ok: true, value: { geoLocale: 'BD' } })
        expect(ok({ geoLocale: 'AUTO' })).toMatchObject({ ok: true, value: { geoLocale: 'auto' } })
        expect(ok({ geoLocale: 'USA' }).ok).toBe(false)
    })
    it('secrets: empty keeps, clear removes, a value sets; bad characters are refused', () => {
        expect(ok({})).toMatchObject({ value: { password: { kind: 'keep' } } })
        expect(ok({ clearPassword: true })).toMatchObject({ value: { password: { kind: 'clear' } } })
        expect(ok({ password: 'abc123' })).toMatchObject({
            value: { password: { kind: 'set', value: 'abc123' } }
        })
        expect(ok({ password: 'abc\n123' }).ok).toBe(false)
        expect(ok({ password: ' abc123' }).ok).toBe(false)
    })
    it('recovery e-mail must look like an e-mail', () => {
        expect(ok({ recoveryEmail: 'x' }).ok).toBe(false)
        expect(ok({ recoveryEmail: 'r@example.com' }).ok).toBe(true)
    })
    it('proxy: address, port, credentials pair, socks rule', () => {
        expect(ok({ proxyUrl: 'proxy.example.com', proxyPort: '8080' }).ok).toBe(true)
        expect(ok({ proxyUrl: 'proxy.example.com' }).ok).toBe(false)
        expect(ok({ proxyUrl: 'proxy.example.com', proxyPort: '70000' }).ok).toBe(false)
        expect(ok({ proxyUrl: 'ftp://proxy.example.com', proxyPort: '21' }).ok).toBe(false)
        expect(ok({ proxyUrl: 'http://u:p@proxy.example.com', proxyPort: '80' }).ok).toBe(false)
        expect(ok({ proxyUrl: 'proxy.example.com', proxyPort: '80', proxyUsername: 'u' }).ok).toBe(false)
        expect(
            ok({
                proxyUrl: 'proxy.example.com',
                proxyPort: '80',
                proxyUsername: 'user',
                proxyPassword: 'pass'
            }).ok
        ).toBe(true)
        expect(
            ok({
                proxyUrl: 'socks5://proxy.example.com',
                proxyPort: '1080',
                proxyUsername: 'user',
                proxyPassword: 'pass'
            }).ok
        ).toBe(false)
    })
    it('socks proxy with credentials that are already saved is refused too', () => {
        const saved = {
            hasPassword: false,
            hasTotp: false,
            hasRecoveryEmail: false,
            hasProxyCredentials: true
        }
        expect(ok({ proxyUrl: 'socks5://proxy.example.com', proxyPort: '1080' }, [], saved).ok).toBe(false)
        expect(
            ok(
                { proxyUrl: 'socks5://proxy.example.com', proxyPort: '1080', clearProxyCredentials: true },
                [],
                saved
            ).ok
        ).toBe(true)
    })
    it('proxy fields without a proxy address are refused instead of silently dropped', () => {
        expect(ok({ proxyPort: '80' }).ok).toBe(false)
        expect(ok({ proxyUsername: 'u', proxyPassword: 'p' }).ok).toBe(false)
        expect(ok({ proxyHttpToo: true }).ok).toBe(false)
    })
})

describe('engineProblems (what the engine would reject in an existing file)', () => {
    const none = { hasProxyUsername: false, hasProxyPassword: false }
    it('finds nothing in a clean account', () => {
        expect(engineProblems({ email: 'a@example.com', ...none })).toEqual([])
        expect(
            engineProblems({
                email: 'a@example.com',
                proxyUrl: 'http://p.example.com',
                proxyPort: '8080',
                ...none
            })
        ).toEqual([])
    })
    it('finds bad language, region, proxy', () => {
        expect(engineProblems({ langCode: 'x y', ...none })).toHaveLength(1)
        expect(engineProblems({ geoLocale: 'USA', ...none })).toHaveLength(1)
        expect(engineProblems({ proxyPort: '80', ...none })).toHaveLength(1)
        expect(engineProblems({ proxyUrl: 'http://p.example.com', ...none })).toHaveLength(1)
        expect(
            engineProblems({
                proxyUrl: 'http://p.example.com',
                proxyPort: '80',
                hasProxyUsername: true,
                hasProxyPassword: false
            })
        ).toHaveLength(1)
    })
    it('reads the port the way the engine does (parseInt)', () => {
        expect(engineProblems({ proxyUrl: 'http://p.example.com', proxyPort: '80abc', ...none })).toEqual([])
    })
})

describe('buildChanges', () => {
    const clean = (over: Partial<AccountInput>, existing: Parameters<typeof cleanAccountInput>[2] = null) => {
        const r = cleanAccountInput(input({ email: 'alpha@example.com', ...over }), [], existing)
        if (!r.ok) throw new Error(JSON.stringify(r.errors))
        return r.value
    }
    it('saving an unchanged account produces no changes at all', () => {
        const slot = listSlots(BASE).find((s) => s.slot === 1)
        const c = buildChanges(
            clean(
                { langCode: 'en' },
                { hasPassword: true, hasTotp: false, hasRecoveryEmail: false, hasProxyCredentials: false }
            ),
            slot?.values ?? {}
        )
        expect(Object.values(c).every((v) => v === undefined)).toBe(true)
    })
    it('removing the proxy removes every proxy line, including the old PROXY_AXIOS name', () => {
        const values = {
            EMAIL: 'a@example.com',
            PROXY_URL: 'http://p.example.com',
            PROXY_PORT: '80',
            PROXY_AXIOS: 'true',
            PROXY_USERNAME: 'u1',
            PROXY_PASSWORD: 'p1'
        }
        const c = buildChanges(clean({}), values)
        expect(c).toMatchObject({
            PROXY_URL: null,
            PROXY_PORT: null,
            PROXY_AXIOS: null,
            PROXY_USERNAME: null,
            PROXY_PASSWORD: null
        })
    })
    it('switching "also use for HTTP" writes the current name and drops the old one', () => {
        const values = {
            EMAIL: 'alpha@example.com',
            PROXY_URL: 'http://p.example.com',
            PROXY_PORT: '80',
            PROXY_AXIOS: 'true'
        }
        const c = buildChanges(
            clean({ proxyUrl: 'http://p.example.com', proxyPort: '80', proxyHttpToo: false }),
            values
        )
        expect(c.PROXY_AXIOS).toBeNull()
        expect(c.PROXY_HTTP).toBeUndefined()
    })
})
