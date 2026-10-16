import { describe, expect, it } from 'vitest'
import type { HealthCheck, HealthStatus } from '../src/shared/health-types'
import {
    PREREQUISITE_IDS,
    accountsPathProblem,
    buildReview,
    evaluatePrerequisites,
    fileNameOf,
    furthestStep,
    stepAllowed,
    validateBasicSettings
} from '../src/shared/wizard-rules'
import type { AccountsChoice, BasicSettings } from '../src/shared/wizard-types'

// Phase 22 (first half): the pure rules of the setup wizard. Stand-in health rows are fine here (rule 18: tests only).

const T = '2026-10-16T08:00:00.000Z'
const row = (id: string, status: HealthStatus, detail = 'detail', fix: string | null = null): HealthCheck =>
    ({
        id,
        group: 'runtime',
        title: `Title ${id}`,
        status,
        detail,
        fix,
        checkedAt: T
    }) as HealthCheck
const allOk = (): HealthCheck[] => PREREQUISITE_IDS.map((id) => row(id, 'ok'))

describe('prerequisites', () => {
    it('all rows fine: the wizard may go on, rows come in a fixed order', () => {
        const r = evaluatePrerequisites(allOk().reverse(), T)
        expect(r.canContinue).toBe(true)
        expect(r.blockers).toEqual([])
        expect(r.rows.map((x) => x.id)).toEqual([...PREREQUISITE_IDS])
        expect(r.checkedAt).toBe(T)
    })

    it('a warning on Git does not stop the wizard', () => {
        const checks = allOk().map((c) =>
            c.id === 'git' ? row('git', 'warning', 'Git not found', 'Install Git') : c
        )
        const r = evaluatePrerequisites(checks, T)
        expect(r.canContinue).toBe(true)
        expect(r.rows.find((x) => x.id === 'git')?.fix).toBe('Install Git')
    })

    for (const id of ['node', 'engine-files', 'engine-packages', 'engine-built']) {
        it(`a red ${id} row stops the wizard and says why`, () => {
            const checks = allOk().map((c) =>
                c.id === id ? row(id, 'error', 'It is broken.', 'Click Fix') : c
            )
            const r = evaluatePrerequisites(checks, T)
            expect(r.canContinue).toBe(false)
            expect(r.blockers).toHaveLength(1)
            expect(r.blockers[0]).toContain('It is broken.')
        })
        it(`an unknown ${id} row stops the wizard (unknown is never ok)`, () => {
            const checks = allOk().map((c) => (c.id === id ? row(id, 'unknown', 'Could not run.') : c))
            const r = evaluatePrerequisites(checks, T)
            expect(r.canContinue).toBe(false)
            expect(r.blockers[0]).toMatch(/could not be checked/)
        })
    }

    it('a row that did not run at all stops the wizard when it is required', () => {
        const r = evaluatePrerequisites(
            allOk().filter((c) => c.id !== 'node'),
            T
        )
        expect(r.canContinue).toBe(false)
        expect(r.rows.find((x) => x.id === 'node')?.status).toBe('unknown')
    })

    it('an unknown Git row alone does not stop the wizard', () => {
        const checks = allOk().map((c) => (c.id === 'git' ? row('git', 'unknown') : c))
        expect(evaluatePrerequisites(checks, T).canContinue).toBe(true)
    })
})

describe('accounts path', () => {
    const good = [
        'C:\\Users\\me\\accounts.env',
        'D:/data/.env',
        '\\\\server\\share\\accounts.env',
        '/home/me/accounts.env'
    ]
    for (const p of good) it(`accepts ${p}`, () => expect(accountsPathProblem(p)).toBeNull())
    const bad: Array<[string, unknown]> = [
        ['undefined', undefined],
        ['null', null],
        ['a number', 5],
        ['an empty text', ''],
        ['a relative path', 'accounts.env'],
        ['a dot path', '..\\..\\accounts.env'],
        ['a NUL character', 'C:\\a\u0000.env'],
        ['a very long path', `C:\\${'a'.repeat(2000)}.env`],
        ['an object', {}]
    ]
    for (const [label, v] of bad) {
        it(`refuses ${label}`, () => {
            const p = accountsPathProblem(v)
            expect(p).not.toBeNull()
            expect((p as string).length).toBeGreaterThan(10)
        })
    }
    it('file name only, never the folder', () => {
        expect(fileNameOf('C:\\Users\\me\\accounts.env')).toBe('accounts.env')
        expect(fileNameOf('/home/me/x/.env')).toBe('.env')
    })
})

describe('basic settings', () => {
    const ok = { theme: 'dark', headless: true, timerEnabled: false, timerTime: '08:30' }
    it('accepts a good set and drops extra keys', () => {
        const r = validateBasicSettings({ ...ok, password: 'must-not-travel' })
        expect(r.ok).toBe(true)
        if (r.ok) {
            expect(r.value).toEqual(ok)
            expect(JSON.stringify(r.value)).not.toContain('must-not-travel')
        }
    })
    it('accepts light, headless off, timer on', () => {
        const r = validateBasicSettings({
            theme: 'light',
            headless: false,
            timerEnabled: true,
            timerTime: '23:59'
        })
        expect(r.ok).toBe(true)
    })
    const cases: Array<[string, string, unknown]> = [
        ['theme', 'a theme that does not exist', { ...ok, theme: 'blue' }],
        ['theme', 'a missing theme', { ...ok, theme: undefined }],
        ['headless', 'the text "true"', { ...ok, headless: 'true' }],
        ['headless', 'the number 1', { ...ok, headless: 1 }],
        ['timerEnabled', 'null', { ...ok, timerEnabled: null }],
        ['timerTime', 'hour 24', { ...ok, timerTime: '24:00' }],
        ['timerTime', 'minute 60', { ...ok, timerTime: '12:60' }],
        ['timerTime', 'text', { ...ok, timerTime: 'noon' }],
        ['timerTime', 'a number', { ...ok, timerTime: 830 }],
        ['timerTime', 'one digit', { ...ok, timerTime: '8:30' }]
    ]
    for (const [field, label, input] of cases) {
        it(`refuses ${label} and names the field ${field}`, () => {
            const r = validateBasicSettings(input)
            expect(r.ok).toBe(false)
            if (!r.ok) {
                expect(Object.keys(r.errors)).toContain(field)
                expect(Object.values(r.errors).every((t) => (t as string).length > 5)).toBe(true)
            }
        })
    }
    for (const [label, input] of [
        ['null', null],
        ['undefined', undefined],
        ['a text', 'x'],
        ['an array', []]
    ] as Array<[string, unknown]>) {
        it(`refuses ${label} as a whole`, () => expect(validateBasicSettings(input).ok).toBe(false))
    }
})

describe('steps and review', () => {
    const accounts: AccountsChoice = { source: 'pick', fileName: 'a.env', accountCount: 2, willCreate: false }
    const settings: BasicSettings = { theme: 'dark', headless: false, timerEnabled: true, timerTime: '07:00' }
    it('each step needs the one before it', () => {
        expect(furthestStep({ prerequisitesOk: false, accounts, settings })).toBe('prerequisites')
        expect(furthestStep({ prerequisitesOk: true, accounts: null, settings })).toBe('accounts')
        expect(furthestStep({ prerequisitesOk: true, accounts, settings: null })).toBe('settings')
        expect(furthestStep({ prerequisitesOk: true, accounts, settings })).toBe('review')
        expect(stepAllowed('accounts', { furthestStep: 'settings' })).toBe(true)
        expect(stepAllowed('review', { furthestStep: 'settings' })).toBe(false)
    })
    it('the review lists what will be set, with the timer warning', () => {
        const r = buildReview(accounts, settings)
        expect(r.lines.map((l) => l.label)).toEqual([
            'Accounts file',
            'Theme',
            'Browser window',
            'Daily timer'
        ])
        expect(r.lines[0]?.value).toBe('a.env (2 accounts)')
        expect(r.lines[3]?.value).toBe('On, every day at 07:00')
        expect(r.warnings.join(' ')).toMatch(/only while this app is open/)
        expect(r.canFinish).toBe(true)
    })
    it('an empty file and a file that will be created are said plainly', () => {
        const r = buildReview(
            { ...accounts, accountCount: 0, willCreate: true },
            { ...settings, timerEnabled: false }
        )
        expect(r.lines[0]?.value).toBe('a.env (will be created, no account yet)')
        expect(r.warnings.join(' ')).toMatch(/no account yet/)
        expect(r.lines[3]?.value).toBe('Off')
    })
    it('one account is written in the singular', () => {
        expect(buildReview({ ...accounts, accountCount: 1 }, settings).lines[0]?.value).toBe(
            'a.env (1 account)'
        )
    })
})

describe('review: the browser window setting with no account yet (Phase 22, second half)', () => {
    const settings = { theme: 'dark', headless: true, timerEnabled: false, timerTime: '08:00' } as const
    it('no account yet: a warning says the setting is not saved now', () => {
        const r = buildReview(
            { source: 'default', fileName: 'accounts.env', accountCount: 0, willCreate: true },
            settings
        )
        expect(r.warnings.join(' ')).toMatch(/not saved now/)
        expect(r.warnings.join(' ')).toMatch(/Settings page/)
    })
    it('with accounts: no such warning', () => {
        const r = buildReview(
            { source: 'pick', fileName: 'a.env', accountCount: 2, willCreate: false },
            settings
        )
        expect(r.warnings.join(' ')).not.toMatch(/not saved now/)
    })
})
