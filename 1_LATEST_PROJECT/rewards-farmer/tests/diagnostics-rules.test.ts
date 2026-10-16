// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Redactor } from '../src/main/engine/redact'
import {
    LOG_LINE_MAX_CHARS,
    Scrubber,
    cleanConfig,
    defaultBundleName,
    ensureZipName,
    healthText,
    tailLines,
    writeFailureMessage
} from '../src/shared/diagnostics-rules'
import { makeCheck } from '../src/shared/health-rules'
import { FAKE } from './fixtures/fake-secrets'

// Pure rules of the diagnostics bundle (Phase 14). All secrets here are FAKE values made for tests (rule 18).

const HOME = 'C:\\Users\\JahidTest'

// Test-only: the cleaned config is read back with free property paths.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>

function scrubber(known: readonly string[] = []): Scrubber {
    const redactor = new Redactor()
    for (const k of known) redactor.add(k)
    return new Scrubber({
        redact: (t) => redactor.redact(t),
        containsKnownSecret: (t) => redactor.containsKnownSecret(t),
        homeDirs: [HOME, '/home/jahidtest']
    })
}

describe('Scrubber.text', () => {
    it('hides known secret values and secret patterns', () => {
        const s = scrubber([FAKE.telegramBotToken, 'my-known-password-9'])
        const out = s.text(
            [
                `token ${FAKE.telegramBotToken}`,
                'login with my-known-password-9 now',
                'Authorization: Bearer abcdefghijklmnop1234',
                `hook ${FAKE.discordUrl}`,
                'proxy http://user:hunter2@proxy.example.com:8080/path',
                'ACCOUNT_1_PASSWORD=Sup3rS3cret!'
            ].join('\n')
        )
        for (const secret of [
            FAKE.telegramBotToken,
            'my-known-password-9',
            'abcdefghijklmnop1234',
            FAKE.discordUrl,
            'hunter2',
            'Sup3rS3cret'
        ])
            expect(out, secret).not.toContain(secret)
    })

    it('hides cookies, web tokens, token-like strings and long hex', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM'
        const out = scrubber().text(
            [
                'Cookie: MUID=ABC123; _U=zzz999',
                'Set-Cookie: sid=qq11; Path=/',
                `jwt ${jwt}`,
                'GET /x?access_token=abc123def&code=ZZ99&page=2',
                'blob Zk39sdf0Qa81jdhf92kdjf03Kdjs8Dfk2QweRty3',
                `sha ${'a1b2c3d4'.repeat(8)}`
            ].join('\n')
        )
        expect(out).not.toMatch(
            /MUID=ABC123|_U=zzz999|sid=qq11|SflKxwRJ|abc123def|code=ZZ99|Zk39sdf0|a1b2c3d4a1b2/
        )
        expect(out).toContain('page=2')
    })

    it('replaces e-mail addresses by a stable number, the same address getting the same number', () => {
        const s = scrubber()
        const out = s.text('a: Alpha@Example.com, b: beta@example.org, again alpha@example.com')
        expect(out).toBe('a: <email-1>, b: <email-2>, again <email-1>')
        expect(s.emailCount).toBe(2)
        expect(s.text('later: beta@example.org')).toBe('later: <email-2>')
    })

    it('hides IP addresses but keeps loopback, versions and normal numbers', () => {
        const out = scrubber().text(
            'proxy 203.0.113.45:8080 and 10.1.2.3, api 127.0.0.1:5050, Chrome 130.0.6723.58, node 24.21.0, 1.2.3.4.5 build'
        )
        expect(out).not.toContain('203.0.113.45')
        expect(out).not.toContain('10.1.2.3')
        expect(out).toContain('127.0.0.1:5050')
        expect(out).toContain('130.0.6723.58')
        expect(out).toContain('24.21.0')
        expect(out).toContain('1.2.3.4.5')
    })

    it('hides the Windows user name in paths (both slashes) and the home folder', () => {
        const out = scrubber().text(
            `at ${HOME}\\AppData\\Roaming\\x, C:/Users/OtherPerson/Documents, /home/jahidtest/p, /Users/someone/z`
        )
        expect(out).not.toMatch(/JahidTest|OtherPerson|jahidtest|someone/i)
        expect(out).toContain('<home>\\AppData\\Roaming\\x')
        expect(out).toContain('C:/Users/<user>/Documents')
    })

    it('leaves ordinary text alone', () => {
        const text =
            'Node.js 24.21.0 is installed. 3 accounts, run state: idle. Free space: 50.0 GB on the app data drive.'
        expect(scrubber().text(text)).toBe(text)
    })
})

describe('Scrubber.verify (the second, independent check)', () => {
    const s = scrubber(['known-secret-value-77'])
    const kinds = (text: string): string[] => s.verify(text)

    it('is quiet on clean text, including the cleaned placeholders', () => {
        expect(
            kinds(
                'Authorization: Bearer *** and password: *** and <email-1> and <ip> and C:\\Users\\<user>\\x'
            )
        ).toEqual([])
        expect(kinds('{ "password": "<hidden>", "secret": "", "url": "<set>" }')).toEqual([])
    })

    it('finds each kind of leak by its kind (and never returns the text)', () => {
        const cases: [string, string][] = [
            ['x known-secret-value-77 y', 'a secret value the app knows'],
            ['Bearer abcdefghijkl', 'a bearer token'],
            [FAKE.discordUrl, 'a webhook address'],
            [FAKE.telegramBotToken, 'a Telegram bot token'],
            ['http://u:p@host.example', 'a web address with a user name and password'],
            ['password=abc12345', 'a password or secret with a value'],
            ['"apiKey": "abc123"', 'a password or secret with a value'],
            ['ACCOUNT_3_PASSWORD=zzzz', 'an account setting with a value'],
            ['Cookie: a=b', 'a cookie'],
            ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM', 'a web token'],
            ['write to person@example.com', 'an e-mail address'],
            ['host 203.0.113.9', 'an IP address'],
            ['C:\\Users\\Someone\\x', 'a Windows user folder name'],
            ['{"p": "C:\\\\Users\\\\Someone\\\\x"}', 'a Windows user folder name'],
            [`in ${HOME}\\x`, 'the folder of the Windows user'],
            [`{"p": "C:\\\\Users\\\\JahidTest\\\\x"}`, 'a Windows user folder name']
        ]
        for (const [text, kind] of cases) {
            const found = kinds(text)
            expect(found, text).toContain(kind)
            expect(found.join(' ')).not.toContain('known-secret-value-77')
        }
    })

    it('whatever text() produced passes verify() (the two layers agree)', () => {
        const dirty = [
            'password=Sup3rS3cret',
            'Authorization: Bearer abcdefghijklmnop1234',
            'mail me at someone@example.com from 203.0.113.9',
            `file ${HOME}\\Documents\\x.txt`,
            'Cookie: a=b',
            'known-secret-value-77'
        ].join('\n')
        expect(kinds(s.text(dirty))).toEqual([])
    })
})

describe('cleanConfig', () => {
    const scrub = scrubber()
    const config = {
        logLevel: 'info',
        headless: true,
        clusters: 2,
        globalTimeout: '5min',
        queryEngines: ['google', 'bing'],
        webhook: {
            discord: { enabled: true, url: FAKE.discordUrl },
            telegram: { botToken: FAKE.telegramBotToken, chatId: '-100123' },
            ntfy: { url: '', token: '', topic: 'my-private-topic' }
        },
        searchSettings: { chinaApi: { appkey: FAKE.chinaApiAppkey }, bonus: 5 },
        proxy: { url: 'http://proxy.example.com', port: 8080, username: 'proxyuser', password: 'pw12345' },
        customToken: 'abcdef',
        note: 'mail me at someone@example.com',
        longNote: 'x'.repeat(200),
        deep: { a: { b: { c: { d: { e: { f: { g: { h: 'too deep' } } } } } } } },
        many: Array.from({ length: 80 }, (_v, i) => i)
    }

    it('keeps numbers, true/false and short harmless text; shows secret fields as set / not set', () => {
        const out = cleanConfig(config, scrub) as Loose
        expect(out['logLevel']).toBe('info')
        expect(out['headless']).toBe(true)
        expect(out['clusters']).toBe(2)
        expect(out['globalTimeout']).toBe('5min')
        expect(out['queryEngines']).toEqual(['google', 'bing'])
        expect(out['proxy'].port).toBe(8080)
        expect(out['searchSettings'].bonus).toBe(5)
        expect(out['webhook'].discord.url).toBe('<set>')
        expect(out['webhook'].discord.enabled).toBe(true)
        expect(out['webhook'].telegram.botToken).toBe('<set>')
        expect(out['webhook'].telegram.chatId).toBe('<set>')
        expect(out['webhook'].ntfy.url).toBe('<not set>')
        expect(out['searchSettings'].chinaApi.appkey).toBe('<set>')
    })

    it('hides every other text that could be a secret, however the key is spelled', () => {
        const out = cleanConfig(config, scrub) as Loose
        expect(out['proxy'].url).toBe('<hidden>')
        expect(out['proxy'].username).toBe('<hidden>')
        expect(out['proxy'].password).toBe('<hidden>')
        expect(out['customToken']).toBe('<hidden>')
        expect(out['webhook'].ntfy.topic).toBe('<hidden>')
        expect(out['note']).toBe('<hidden>')
        expect(out['longNote']).toBe('<hidden: long text>')
        const text = JSON.stringify(out)
        for (const secret of [
            ...Object.values(FAKE),
            'proxyuser',
            'pw12345',
            'my-private-topic',
            'someone@example.com'
        ])
            expect(text, secret).not.toContain(secret)
    })

    it('limits depth and array length instead of crashing', () => {
        const out = cleanConfig(config, scrub) as Loose
        expect(JSON.stringify(out['deep'])).toContain('<too deep>')
        expect(out['many']).toHaveLength(51)
        expect(out['many'][50]).toBe('<30 more not shown>')
    })

    it('handles non-object input', () => {
        expect(cleanConfig('plain text', scrub)).toBe('plain text')
        expect(cleanConfig(null, scrub)).toBeNull()
        expect(cleanConfig(7, scrub)).toBe(7)
    })
})

describe('tailLines', () => {
    it('drops the first line when the read started in the middle of the file', () => {
        const r = tailLines('rtial line\nfull one\nfull two\n', true, 100)
        expect(r.lines).toEqual(['full one', 'full two'])
        expect(r.cut).toBe(true)
    })

    it('keeps everything when the whole file was read', () => {
        const r = tailLines('one\r\ntwo\r\nthree', false, 100)
        expect(r.lines).toEqual(['one', 'two', 'three'])
        expect(r.cut).toBe(false)
    })

    it('keeps only the newest lines when there are too many', () => {
        const r = tailLines(Array.from({ length: 10 }, (_v, i) => `l${String(i)}`).join('\n'), false, 3)
        expect(r.lines).toEqual(['l7', 'l8', 'l9'])
        expect(r.cut).toBe(true)
    })

    it('turns control characters into ? and shortens a huge line', () => {
        const r = tailLines(`a\u0000b\u0007c\td\n${'x'.repeat(LOG_LINE_MAX_CHARS + 500)}\n`, false, 10)
        expect(r.lines[0]).toBe('a?b?c\td')
        expect(r.lines[1]?.endsWith('...[line shortened]')).toBe(true)
        expect((r.lines[1] ?? '').length).toBeLessThan(LOG_LINE_MAX_CHARS + 40)
    })
})

describe('health text', () => {
    it('is readable, cleaned, and says what to do', () => {
        const state = {
            status: 'done' as const,
            startedAt: '2026-10-14T10:00:00.000Z',
            finishedAt: '2026-10-14T10:00:02.000Z',
            checks: [
                makeCheck('app', 'ok', 'Rewards Farmer LUCK 0.0.1', null, '2026-10-14T10:00:01.000Z'),
                makeCheck(
                    'folder-data',
                    'error',
                    `The app data folder does not exist: ${HOME}\\AppData`,
                    'Write to person@example.com',
                    '2026-10-14T10:00:01.000Z'
                )
            ]
        }
        const text = healthText(state, scrubber())
        expect(text).toContain('[OK] This app')
        expect(text).toContain('[PROBLEM] App data folder (read and write)')
        expect(text).toContain('What to do: Write to <email-1>')
        expect(text).not.toContain('JahidTest')
        expect(text).toContain('1 problem')
    })
})

describe('file name and write errors', () => {
    it('suggests a dated .zip name', () => {
        expect(defaultBundleName(new Date(2026, 9, 14, 9, 5, 7))).toBe(
            'rewards-farmer-diagnostics-2026-10-14-090507.zip'
        )
    })

    it('always ends in .zip, so no important file can be written over', () => {
        expect(ensureZipName('C:\\x\\bundle')).toBe('C:\\x\\bundle.zip')
        expect(ensureZipName('C:\\x\\Bundle.ZIP')).toBe('C:\\x\\Bundle.ZIP')
        expect(ensureZipName('C:\\x\\config.json')).toBe('C:\\x\\config.json.zip')
        expect(ensureZipName('C:\\x\\accounts.env')).toBe('C:\\x\\accounts.env.zip')
    })

    it('every error code has a plain message with a next step, and none tells the user to type', () => {
        for (const code of [
            'EACCES',
            'EPERM',
            'ENOENT',
            'ENOSPC',
            'EROFS',
            'EISDIR',
            'EEXIST',
            'EBUSY',
            'ENAMETOOLONG',
            'EINVAL',
            'WEIRD',
            undefined
        ]) {
            const m = writeFailureMessage(code, 'C:\\x\\a.zip')
            expect(m.length, String(code)).toBeGreaterThan(40)
            expect(m).toMatch(/Choose|Free|Close/)
            expect(m).not.toMatch(/npm|cmd|powershell|type /i)
        }
        expect(writeFailureMessage('WEIRD', 'p')).toContain('(WEIRD)')
    })
})
