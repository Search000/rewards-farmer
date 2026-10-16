// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    buildPatch,
    changedKeys,
    extractValues,
    FIELDS,
    parseSettingsInput
} from '../src/shared/engine-settings-rules'
import type { EngineSettingsValues } from '../src/shared/engine-settings-types'
// The engine's REAL zod schema (engine/src/util/Validator.ts, the pinned submodule). Needs `engine:install` (zod, ms, semver).
import { ConfigSchema } from '@engine-validator'

// Phase 9: everything this app is willing to save must also be accepted by the engine's own validator, and the values the
// app refuses must not be something the engine would have needed to accept. No invented fields, no invented limits.

const example = JSON.parse(
    readFileSync(join(__dirname, '..', 'engine', 'config.example.json'), 'utf8')
) as Record<string, unknown>

function deepMerge(base: unknown, patch: unknown): unknown {
    if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) return patch
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = deepMerge(out[k], v)
    return out
}

function base(): EngineSettingsValues {
    const r = extractValues(example, null)
    if (!r.ok) throw new Error(r.message)
    return r.value.values
}

const accepted = (v: EngineSettingsValues): boolean => {
    const parsed = parseSettingsInput({ ...v })
    if (parsed === null) return false
    const patch = buildPatch(parsed, changedKeys(base(), parsed))
    return ConfigSchema.safeParse(deepMerge(example, patch)).success
}

describe('app limits vs the real engine validator', () => {
    it('the real example config passes the real schema (sanity)', () => {
        expect(ConfigSchema.safeParse(example).success).toBe(true)
    })

    it('every one of the mapped fields exists in the schema output (no field is invented)', () => {
        const out = ConfigSchema.parse(example) as Record<string, unknown>
        for (const f of FIELDS) {
            let cur: unknown = out
            for (const part of f.path) cur = (cur as Record<string, unknown> | undefined)?.[part]
            expect(cur, f.path.join('.')).not.toBeUndefined()
        }
    })

    it('a full change of every Phase 9 field is accepted by the engine', () => {
        const v = base()
        const changed: EngineSettingsValues = {
            ...v,
            prewarmDesktopLogin: true,
            dailyCheckIn: false,
            streakProtection: false,
            claimBonusPoints: false,
            activateSearchPerk: false,
            appPromotions: false,
            urlRewards: false,
            autoClaimPunchCards: true,
            skipNonPointTasks: false,
            accountDelayMin: '30sec',
            accountDelayMax: '2h',
            searchDelayMin: '1.5min',
            searchDelayMax: '20 min',
            readDelayMin: '10sec',
            readDelayMax: '1h',
            globalTimeout: '2min',
            searchResultVisitTime: '5sec',
            bonusSearches: true,
            maxBonusSearches: 0,
            runOnZeroPoints: true,
            clusterSearch: false,
            localBingQueries: true,
            queryEngines: [
                'wikipedia',
                'google',
                'hackernews',
                'reddit',
                'wikirandom',
                'china',
                'local',
                'rss.site.feed'
            ]
        }
        expect(accepted(changed)).toBe(true)
    })

    it('boundary values the app allows are accepted by the engine', () => {
        const v = base()
        expect(accepted({ ...v, maxBonusSearches: 1000 })).toBe(true)
        expect(accepted({ ...v, globalTimeout: '1sec' })).toBe(true)
        expect(accepted({ ...v, accountDelayMin: '0ms', accountDelayMax: '0ms' })).toBe(true)
        expect(accepted({ ...v, accountDelayMin: '24h', accountDelayMax: '24h' })).toBe(true)
        expect(accepted({ ...v, searchDelayMin: '1sec', searchDelayMax: '1sec' })).toBe(true)
        expect(accepted({ ...v, clusters: 1 })).toBe(true)
        expect(accepted({ ...v, searchDelayMin: '5min', searchDelayMax: '5min' })).toBe(true)
    })

    it('values the app refuses are not saved, and the engine would also not accept the ones it can check', () => {
        const v = base()
        expect(accepted({ ...v, accountDelayMin: '5min', accountDelayMax: '1min' })).toBe(false)
        const engine = (over: Record<string, unknown>): boolean =>
            ConfigSchema.safeParse(deepMerge(example, over)).success
        expect(engine({ accountDelay: { min: '5min', max: '1min' } })).toBe(false)
        expect(engine({ searchSettings: { queryEngines: ['bing'] } })).toBe(false)
        expect(engine({ searchSettings: { searchDelay: { min: 'abc', max: '1min' } } })).toBe(false)
        // App limits that are STRICTER than the engine (documented in docs/configuration-reference.md):
        expect(engine({ searchSettings: { maxBonusSearches: 5000 } })).toBe(true)
        expect(accepted({ ...v, maxBonusSearches: 5000 })).toBe(false)
        expect(engine({ clusters: 0 })).toBe(true)
        expect(accepted({ ...v, clusters: 0 })).toBe(false)
        expect(engine({ searchSettings: { searchDelay: { min: '0sec', max: '1sec' } } })).toBe(true)
        expect(accepted({ ...v, searchDelayMin: '0sec', searchDelayMax: '1sec' })).toBe(false)
        expect(engine({ globalTimeout: '0sec' })).toBe(true)
        expect(accepted({ ...v, globalTimeout: '0sec' })).toBe(false)
    })
})
