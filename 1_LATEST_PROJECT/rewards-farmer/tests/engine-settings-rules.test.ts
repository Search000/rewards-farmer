import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDuration } from '../src/shared/duration'
import {
    buildPatch,
    changedKeys,
    extractValues,
    FIELDS,
    parseSettingsInput,
    shorterThanDefault,
    validateValues
} from '../src/shared/engine-settings-rules'
import type { EngineSettingsValues } from '../src/shared/engine-settings-types'

// Pure rules of the Settings screen (Phase 8). The example config is the REAL engine file (engine/config.example.json).
const example = JSON.parse(
    readFileSync(join(__dirname, '..', 'engine', 'config.example.json'), 'utf8')
) as unknown

function exampleValues(): EngineSettingsValues {
    const r = extractValues(example, null)
    if (!r.ok) throw new Error(r.message)
    expect(r.value.missing).toEqual([])
    return r.value.values
}

describe('engine settings rules', () => {
    it('every mapped field exists in the real engine example config (no invented fields)', () => {
        exampleValues()
        expect(FIELDS).toHaveLength(41)
    })

    it('reads the real example values', () => {
        expect(exampleValues()).toEqual({
            logLevel: 'debug',
            browser: 'chromium',
            headless: false,
            useProxyForSearchQueries: false,
            disableImages: false,
            parallelSearching: false,
            dailyQuests: true,
            punchCards: true,
            moreActivities: true,
            exploreOnBing: true,
            pcSearch: true,
            mobileSearch: true,
            readToEarn: true,
            visualSearch: false,
            prewarmDesktopLogin: false,
            dailyCheckIn: true,
            streakProtection: true,
            claimBonusPoints: true,
            activateSearchPerk: true,
            appPromotions: true,
            urlRewards: true,
            autoClaimPunchCards: false,
            skipNonPointTasks: true,
            accountDelayMin: '1min',
            accountDelayMax: '3min',
            searchDelayMin: '6min',
            searchDelayMax: '12min',
            readDelayMin: '6min',
            readDelayMax: '11min',
            globalTimeout: '50sec',
            searchResultVisitTime: '20sec',
            bonusSearches: false,
            maxBonusSearches: 110,
            runOnZeroPoints: false,
            clusterSearch: true,
            localBingQueries: false,
            queryEngines: ['china', 'local'],
            clusters: 1,
            ignoreCertificateErrors: false,
            apiSearch: false,
            apiSearchOnBing: false
        })
    })

    it('a missing field uses the fallback and is reported as missing', () => {
        const r = extractValues({ headless: true }, exampleValues())
        expect(r.ok).toBe(true)
        if (r.ok) {
            expect(r.value.values.headless).toBe(true)
            expect(r.value.missing).toContain('dailyQuests')
            expect(r.value.missing).not.toContain('headless')
        }
    })

    it('a field with the wrong type is an error, never silently fixed', () => {
        expect(extractValues({ headless: 'yes' }, null).ok).toBe(false)
        expect(extractValues({ browserChannel: 'chrome' }, null).ok).toBe(false)
        expect(extractValues({ workers: { doDailySet: 1 } }, null).ok).toBe(false)
        expect(extractValues([], null).ok).toBe(false)
    })

    it('accepts exactly the expected shape from the renderer and nothing else', () => {
        const v = exampleValues()
        expect(parseSettingsInput({ ...v })).toEqual(v)
        expect(parseSettingsInput({ ...v, extra: true })).toBeNull()
        expect(parseSettingsInput({ ...v, headless: 'true' })).toBeNull()
        expect(parseSettingsInput({ ...v, browser: 'chrome' })).toBeNull()
        expect(parseSettingsInput({ ...v, logLevel: 'trace' })).toBeNull()
        const rest: Record<string, unknown> = { ...v }
        delete rest.headless
        expect(parseSettingsInput(rest)).toBeNull()
        expect(parseSettingsInput(null)).toBeNull()
        expect(parseSettingsInput('x')).toBeNull()
        expect(parseSettingsInput([v])).toBeNull()
    })

    it('builds a patch with only the changed fields at their real config paths', () => {
        const before = exampleValues()
        const after: EngineSettingsValues = {
            ...before,
            headless: true,
            visualSearch: true,
            browser: 'msedge',
            logLevel: 'info'
        }
        const keys = changedKeys(before, after)
        expect(keys.sort()).toEqual(['browser', 'headless', 'logLevel', 'visualSearch'])
        expect(buildPatch(after, keys)).toEqual({
            headless: true,
            browserChannel: 'msedge',
            debugLogs: false,
            workers: { doVisualSearch: true }
        })
    })

    it('patch keeps nested siblings apart (workers and activities and searchSettings)', () => {
        const before = exampleValues()
        const after: EngineSettingsValues = {
            ...before,
            dailyQuests: false,
            pcSearch: false,
            exploreOnBing: false,
            parallelSearching: true
        }
        expect(buildPatch(after, changedKeys(before, after))).toEqual({
            workers: { doDailySet: false, doDesktopSearch: false },
            activities: { searchOnBing: false },
            searchSettings: { parallelSearching: true }
        })
    })

    it('no change gives an empty key list', () => {
        const v = exampleValues()
        expect(changedKeys(v, { ...v })).toEqual([])
    })

    it('never maps an evasion field (rule 9)', () => {
        const paths = FIELDS.map((f) => f.path.join('.')).join(' ')
        expect(paths).not.toMatch(/humanize|userAgent|geo|typo|random|cookie/i)
    })

    // ---- Phase 9 ----

    it('Phase 9 patch writes each new field at its real nested path', () => {
        const before = exampleValues()
        const after: EngineSettingsValues = {
            ...before,
            dailyCheckIn: false,
            urlRewards: false,
            accountDelayMin: '2min',
            searchDelayMax: '15min',
            maxBonusSearches: 50,
            queryEngines: ['local', 'wikipedia']
        }
        expect(buildPatch(after, changedKeys(before, after))).toEqual({
            workers: { doDailyCheckIn: false },
            activities: { urlReward: false },
            accountDelay: { min: '2min' },
            searchSettings: {
                searchDelay: { max: '15min' },
                maxBonusSearches: 50,
                queryEngines: ['local', 'wikipedia']
            }
        })
    })

    it('a list is compared by content and order', () => {
        const v = exampleValues()
        expect(changedKeys(v, { ...v, queryEngines: ['china', 'local'] })).toEqual([])
        expect(changedKeys(v, { ...v, queryEngines: ['local', 'china'] })).toEqual(['queryEngines'])
    })

    it('duration text needs a unit and matches what the real engine library (ms) reads', async () => {
        expect(parseDuration('6min')).toBe(360_000)
        expect(parseDuration('50 sec')).toBe(50_000)
        expect(parseDuration('1.5h')).toBe(5_400_000)
        expect(parseDuration('90')).toBeNull()
        expect(parseDuration('')).toBeNull()
        expect(parseDuration('-5min')).toBeNull()
        expect(parseDuration('5 parsecs')).toBeNull()
        // Same answers as the engine's own dependency, so the app never accepts text the engine reads differently.
        const enginePkg = join(__dirname, '..', 'engine', 'node_modules', 'ms')
        const mod = (await import(/* @vite-ignore */ enginePkg)) as {
            default: (v: string) => number | undefined
        }
        for (const t of ['6min', '50sec', '1.5h', '2 days', '500ms', '3 mins', '10s', '1hour']) {
            expect(parseDuration(t)).toBe(mod.default(t))
        }
    })

    it('validation: limits, units, min <= max, sources', () => {
        const v = exampleValues()
        expect(validateValues(v)).toEqual({})
        expect(validateValues({ ...v, searchDelayMin: '90' }).searchDelayMin).toBeDefined()
        expect(
            validateValues({ ...v, accountDelayMin: '5min', accountDelayMax: '1min' }).accountDelayMax
        ).toBeDefined()
        expect(validateValues({ ...v, globalTimeout: '0sec' }).globalTimeout).toBeDefined()
        expect(
            validateValues({ ...v, searchDelayMin: '0sec', searchDelayMax: '5sec' }).searchDelayMin
        ).toBeDefined()
        expect(
            validateValues({ ...v, readDelayMin: '500ms', readDelayMax: '5sec' }).readDelayMin
        ).toBeDefined()
        expect(validateValues({ ...v, searchDelayMin: '1sec', searchDelayMax: '2sec' })).toEqual({})
        expect(validateValues({ ...v, accountDelayMin: '0sec', accountDelayMax: '0sec' })).toEqual({})
        expect(validateValues({ ...v, clusters: 0 }).clusters).toBeDefined()
        expect(validateValues({ ...v, clusters: 9 }).clusters).toBeDefined()
        expect(validateValues({ ...v, clusters: 8 })).toEqual({})
        expect(validateValues({ ...v, searchResultVisitTime: '2days' }).searchResultVisitTime).toBeDefined()
        expect(validateValues({ ...v, maxBonusSearches: -1 }).maxBonusSearches).toBeDefined()
        expect(validateValues({ ...v, maxBonusSearches: 1001 }).maxBonusSearches).toBeDefined()
        expect(validateValues({ ...v, maxBonusSearches: Number.NaN }).maxBonusSearches).toBeDefined()
        expect(validateValues({ ...v, maxBonusSearches: 1.5 }).maxBonusSearches).toBeDefined()
        expect(validateValues({ ...v, queryEngines: [] }).queryEngines).toBeDefined()
        expect(validateValues({ ...v, queryEngines: ['china', 'china'] }).queryEngines).toBeDefined()
        expect(validateValues({ ...v, queryEngines: ['bing'] }).queryEngines).toBeDefined()
        expect(validateValues({ ...v, queryEngines: ['rss.site.feed'] })).toEqual({})
    })

    it('the main process refuses values that break a limit (the renderer is untrusted)', () => {
        const v = exampleValues()
        expect(parseSettingsInput({ ...v, searchDelayMin: '90' })).toBeNull()
        expect(parseSettingsInput({ ...v, maxBonusSearches: '5' })).toBeNull()
        expect(parseSettingsInput({ ...v, maxBonusSearches: 5000 })).toBeNull()
        expect(parseSettingsInput({ ...v, queryEngines: 'china' })).toBeNull()
        expect(parseSettingsInput({ ...v, queryEngines: [1] })).toBeNull()
        expect(parseSettingsInput({ ...v, readDelayMin: '20min', readDelayMax: '1min' })).toBeNull()
        expect(parseSettingsInput({ ...v, accountDelayMin: ' 2min ' })?.accountDelayMin).toBe('2min')
    })

    it('a number in config.json is read as milliseconds; a bad type is an error; an out of range number is shown, not hidden', () => {
        const base = JSON.parse(JSON.stringify(example)) as Record<string, unknown>
        const r = extractValues({ ...base, globalTimeout: 50000 }, null)
        expect(r.ok && r.value.values.globalTimeout).toBe('50000ms')
        expect(extractValues({ ...base, globalTimeout: 'soon' }, null).ok).toBe(false)
        expect(extractValues({ ...base, globalTimeout: true }, null).ok).toBe(false)
        const bad = extractValues(
            { ...base, searchSettings: { ...(base.searchSettings as object), maxBonusSearches: 9999 } },
            null
        )
        expect(bad.ok && bad.value.values.maxBonusSearches).toBe(9999)
        expect(bad.ok && validateValues(bad.value.values).maxBonusSearches).toBeDefined()
        expect(
            extractValues(
                { ...base, searchSettings: { ...(base.searchSettings as object), queryEngines: 'china' } },
                null
            ).ok
        ).toBe(false)
    })

    it('a delay shorter than the engine default is only a note, never an error', () => {
        const d = exampleValues()
        expect(shorterThanDefault(d, d)).toEqual([])
        const fast = { ...d, searchDelayMin: '2sec', searchDelayMax: '3sec', globalTimeout: '5sec' }
        expect(shorterThanDefault(fast, d)).toEqual(['searchDelayMin', 'searchDelayMax'])
        expect(validateValues(fast)).toEqual({})
        expect(shorterThanDefault(fast, null)).toEqual([])
    })

    it('Phase 9 does not map the excluded fields (rule 9, decision D1, secrets belong to Phase 10)', () => {
        const paths = FIELDS.map((f) => f.path.join('.'))
        for (const banned of [
            'contintueOnBotWarning',
            'scrollRandomResults',
            'clickRandomResults',
            'humanize',
            'edgeBrowsing',
            'appkey',
            'webhook',
            'sessionPath'
        ]) {
            expect(paths.join(' ')).not.toContain(banned)
        }
    })
})
