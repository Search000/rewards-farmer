// @vitest-environment node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EngineSettingsService } from '../../src/main/engineSettings'
import type { EngineSettingsValues } from '../../src/shared/engine-settings-types'
import { makeHarness, readLog, waitFor } from './helpers'
import type { Harness } from './helpers'

// Settings against the REAL engine control API (engine/scripts/api/server.js, copied unmodified into a temp dir).
// Only the bot entry is a fixture. Config values in this file live in a temp dir only (rule 18).

const harnesses: Harness[] = []
afterEach(async () => {
    while (harnesses.length > 0) await harnesses.pop()?.cleanup()
})

interface Rig {
    readonly h: Harness
    readonly settings: EngineSettingsService
    readonly backupDir: string
    readonly configPath: string
}

// The copied example config lists the query source "china", which the engine's fallback checker (used when the engine is not
// built) does not know. The built engine uses its own full validator. So the test config uses "local" only.
function prepareConfig(path: string, edit?: (cfg: Record<string, unknown>) => void): void {
    const cfg = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    ;(cfg.searchSettings as Record<string, unknown>).queryEngines = ['local']
    edit?.(cfg)
    writeFileSync(path, JSON.stringify(cfg, null, 2))
}

async function rig(edit?: (cfg: Record<string, unknown>) => void): Promise<Rig> {
    const h = makeHarness()
    harnesses.push(h)
    const configPath = join(h.fx.engineRoot, 'config.json')
    prepareConfig(configPath, edit)
    const backupDir = join(h.fx.userData, 'backups', 'config')
    const settings = new EngineSettingsService({
        host: {
            api: () => h.farmer.engineApi(),
            editBlock: () => h.farmer.settingsEditBlock(),
            run: (work) => h.farmer.editEngineConfig(work)
        },
        engineRoot: h.fx.engineRoot,
        audit: h.audit,
        appLog: h.appLog,
        backupDir
    })
    await h.farmer.init()
    return { h, settings, backupDir, configPath }
}

function useLocalOnlyExample(r: Rig): void {
    const p = join(r.h.fx.engineRoot, 'config.example.json')
    const ex = JSON.parse(readFileSync(p, 'utf8')) as Record<string, Record<string, unknown>>
    ex.searchSettings = { ...ex.searchSettings, queryEngines: ['local'] }
    writeFileSync(p, JSON.stringify(ex, null, 2))
}

async function ready(edit?: (cfg: Record<string, unknown>) => void): Promise<Rig> {
    const r = await rig(edit)
    expect((await r.h.farmer.pickAccounts()).result.ok).toBe(true)
    await waitFor(
        () => r.h.farmer.getState().engine.link,
        (v) => v === 'ready',
        'engine ready'
    )
    return r
}

const disk = (r: Rig): Record<string, unknown> =>
    JSON.parse(readFileSync(r.configPath, 'utf8')) as Record<string, unknown>
const backups = (r: Rig): string[] =>
    existsSync(r.backupDir) ? readdirSync(r.backupDir).filter((n) => n.endsWith('.json')) : []
async function values(r: Rig): Promise<EngineSettingsValues> {
    const s = await r.settings.getState()
    if (s.values === null) throw new Error(`no values: ${s.reason ?? ''}`)
    return s.values
}

describe('Settings: reading the real config', () => {
    it('before an accounts file is chosen the engine is down: unavailable, no values, edit disabled with a reason', async () => {
        const r = await rig()
        const s = await r.settings.getState()
        expect(s.status).toBe('unavailable')
        expect(s.values).toBeNull()
        expect(s.editDisabledReason).not.toBeNull()
        expect(s.reason).toMatch(/accounts file/i)
        // The engine example is a local file, so the defaults are known even now.
        expect(s.defaults).not.toBeNull()
    })

    it('shows the values of the real config.json and allows edits when idle', async () => {
        const r = await ready()
        const s = await r.settings.getState()
        expect(s.status).toBe('ok')
        expect(s.editDisabledReason).toBeNull()
        expect(s.missingKeys).toEqual([])
        expect(s.values).toMatchObject({
            logLevel: 'debug',
            browser: 'chromium',
            headless: false,
            dailyQuests: true,
            visualSearch: false,
            parallelSearching: false
        })
        expect(s.lastBackupAt).toBeNull()
    })

    it('reports a field that is missing in config.json instead of inventing a saved value', async () => {
        const r = await ready((cfg) => {
            delete (cfg.workers as Record<string, unknown>).doReadToEarn
        })
        const s = await r.settings.getState()
        expect(s.status).toBe('ok')
        expect(s.missingKeys).toEqual(['readToEarn'])
    })
})

describe('Settings: saving', () => {
    it('writes only the changed fields through the engine, makes a backup first, and reads the values back', async () => {
        const r = await ready()
        const before = disk(r)
        const beforeBytes = readFileSync(r.configPath)
        const v = await values(r)
        const res = await r.settings.save({
            ...v,
            headless: true,
            visualSearch: true,
            browser: 'msedge',
            logLevel: 'info'
        })
        expect(res).toMatchObject({ ok: true })
        expect(res.message).toMatch(/next run/i)

        const after = disk(r)
        expect(after.headless).toBe(true)
        expect(after.browserChannel).toBe('msedge')
        expect(after.debugLogs).toBe(false)
        expect((after.workers as Record<string, unknown>).doVisualSearch).toBe(true)

        // Everything else is exactly as before (webhooks, delays, accounts-related keys, other workers).
        const strip = (c: Record<string, unknown>): Record<string, unknown> => {
            const copy = JSON.parse(JSON.stringify(c)) as Record<string, Record<string, unknown>> &
                Record<string, unknown>
            delete copy.headless
            delete copy.browserChannel
            delete copy.debugLogs
            delete copy.workers?.doVisualSearch
            return copy
        }
        expect(strip(after)).toEqual(strip(before))

        const files = backups(r)
        expect(files).toHaveLength(1)
        expect(readFileSync(join(r.backupDir, files[0] ?? ''))).toEqual(beforeBytes)

        const s = await r.settings.getState()
        expect(s.values).toMatchObject({
            headless: true,
            visualSearch: true,
            browser: 'msedge',
            logLevel: 'info'
        })
        expect(s.lastBackupAt).not.toBeNull()
    })

    it('a save that changes nothing writes nothing and makes no backup', async () => {
        const r = await ready()
        const bytes = readFileSync(r.configPath)
        const res = await r.settings.save({ ...(await values(r)) })
        expect(res.ok).toBe(true)
        expect(res.message).toMatch(/nothing to change/i)
        expect(readFileSync(r.configPath)).toEqual(bytes)
        expect(backups(r)).toHaveLength(0)
    })

    it('refuses data that is not exactly the expected shape and changes nothing', async () => {
        const r = await ready()
        const bytes = readFileSync(r.configPath)
        const v = await values(r)
        for (const bad of [
            null,
            'x',
            { ...v, extra: 1 },
            { ...v, headless: 'true' },
            { ...v, browser: 'chrome' }
        ]) {
            const res = await r.settings.save(bad)
            expect(res).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
        }
        expect(readFileSync(r.configPath)).toEqual(bytes)
        expect(backups(r)).toHaveLength(0)
    })

    it('when the engine rejects the config (422) nothing is changed and the reason is shown', async () => {
        // errorDiagnostics = "yes" is not a boolean (a field this page does not show); the engine refuses any write that keeps it.
        const r = await ready((cfg) => {
            cfg.errorDiagnostics = 'yes'
        })
        const bytes = readFileSync(r.configPath)
        const res = await r.settings.save({ ...(await values(r)), headless: true })
        expect(res).toMatchObject({ ok: false, code: 'CONFIG_INVALID' })
        expect(readFileSync(r.configPath)).toEqual(bytes)
        // The backup was made before the attempt (rule 10) and holds the same bytes.
        const files = backups(r)
        expect(files).toHaveLength(1)
        expect(readFileSync(join(r.backupDir, files[0] ?? ''))).toEqual(bytes)
        await r.h.audit.flush()
        expect(readLog(r.h, 'audit.log')).toMatch(/CONFIG_INVALID/)
    })

    it('if the backup cannot be made, nothing is changed', async () => {
        const r = await ready()
        // A FILE where the backup folder should be: mkdir fails.
        writeFileSync(join(r.h.fx.userData, 'backups'), 'not a folder')
        const bytes = readFileSync(r.configPath)
        const res = await r.settings.save({ ...(await values(r)), headless: true })
        expect(res).toMatchObject({ ok: false, code: 'WRITE_FAILED' })
        expect(res.message).toMatch(/backup/i)
        expect(readFileSync(r.configPath)).toEqual(bytes)
    })

    it('is refused while a run is active, and the file stays as it was', async () => {
        const r = await ready()
        expect((await r.h.farmer.startRun()).ok).toBe(true)
        await waitFor(
            () => r.h.farmer.getState().run.phase,
            (p) => p === 'running',
            'run active'
        )
        const bytes = readFileSync(r.configPath)
        const s = await r.settings.getState()
        expect(s.editDisabledReason).toMatch(/run is active/i)
        const res = await r.settings.save({ ...(await values(r)), headless: true })
        expect(res).toMatchObject({ ok: false, code: 'RUN_ACTIVE' })
        expect(readFileSync(r.configPath)).toEqual(bytes)
    })

    it('writes an audit line with the changed fields and no secret', async () => {
        const secret = 'https://discord.example.invalid/api/webhooks/SECRET-TEST-ONLY-123'
        const r = await ready((cfg) => {
            ;(
                (cfg.webhook as Record<string, Record<string, unknown>>).discord as Record<string, unknown>
            ).url = secret
        })
        r.h.redactor.add(secret)
        await r.settings.save({ ...(await values(r)), headless: true })
        await r.h.audit.flush()
        const log = readLog(r.h, 'audit.log')
        expect(log).toMatch(/settings-save/)
        expect(log).toMatch(/headless=true/)
        expect(log).not.toContain('SECRET-TEST-ONLY-123')
    })
})

describe('Settings: reset to defaults', () => {
    it('restores the engine example values for the mapped fields only, with a backup, and keeps everything else', async () => {
        const hook = 'https://discord.example.invalid/api/webhooks/KEEP-TEST-ONLY'
        const r = await ready((cfg) => {
            ;(
                (cfg.webhook as Record<string, Record<string, unknown>>).discord as Record<string, unknown>
            ).url = hook
            cfg.headless = true
            cfg.browserChannel = 'msedge'
            ;(cfg.workers as Record<string, unknown>).doVisualSearch = true
            ;(cfg.workers as Record<string, unknown>).doDailySet = false
        })
        // Same harness limit as prepareConfig: the fallback checker does not know "china". The real example (with china) is
        // checked against the engine's real zod schema in tests/engine-validator.parity.test.ts.
        useLocalOnlyExample(r)
        const res = await r.settings.reset()
        expect(res).toMatchObject({ ok: true })
        const after = disk(r)
        expect(after.headless).toBe(false)
        expect(after.browserChannel).toBe('chromium')
        expect((after.workers as Record<string, unknown>).doVisualSearch).toBe(false)
        expect((after.workers as Record<string, unknown>).doDailySet).toBe(true)
        // Not part of this screen: untouched.
        expect(
            ((after.webhook as Record<string, Record<string, unknown>>).discord as Record<string, unknown>)
                .url
        ).toBe(hook)
        expect(backups(r)).toHaveLength(1)
        const s = await r.settings.getState()
        expect(s.values).toEqual(s.defaults)
    })

    it('reset is refused when the example config cannot be read', async () => {
        const r = await ready()
        writeFileSync(join(r.h.fx.engineRoot, 'config.example.json'), '{ not json')
        const bytes = readFileSync(r.configPath)
        const s = await r.settings.getState()
        expect(s.defaults).toBeNull()
        expect(await r.settings.reset()).toMatchObject({ ok: false, code: 'CONFIG_MISSING' })
        expect(readFileSync(r.configPath)).toEqual(bytes)
    })
})

describe('Settings: Phase 9 fields (login, timing, search options) against the real engine API', () => {
    it('reads the Phase 9 values of the real config.json and reports none missing', async () => {
        const r = await ready()
        const s = await r.settings.getState()
        expect(s.status).toBe('ok')
        expect(s.missingKeys).toEqual([])
        expect(s.values).toMatchObject({
            dailyCheckIn: true,
            prewarmDesktopLogin: false,
            accountDelayMin: '1min',
            searchDelayMax: '12min',
            globalTimeout: '50sec',
            maxBonusSearches: 110,
            queryEngines: ['local']
        })
    })

    it('saves login, timing and search options at their real paths; arrays replace; nothing else changes', async () => {
        const r = await ready()
        const before = disk(r)
        const beforeBytes = readFileSync(r.configPath)
        const res = await r.settings.save({
            ...(await values(r)),
            dailyCheckIn: false,
            urlRewards: false,
            accountDelayMin: '2min',
            accountDelayMax: '4min',
            searchDelayMax: '15min',
            globalTimeout: '1min',
            maxBonusSearches: 50,
            queryEngines: ['local', 'wikipedia']
        })
        expect(res).toMatchObject({ ok: true })
        const after = disk(r)
        expect((after.workers as Record<string, unknown>).doDailyCheckIn).toBe(false)
        expect((after.activities as Record<string, unknown>).urlReward).toBe(false)
        expect(after.accountDelay).toEqual({ min: '2min', max: '4min' })
        expect(after.globalTimeout).toBe('1min')
        const ss = after.searchSettings as Record<string, unknown>
        expect(ss.searchDelay).toEqual({ min: '6min', max: '15min' })
        expect(ss.maxBonusSearches).toBe(50)
        expect(ss.queryEngines).toEqual(['local', 'wikipedia'])
        // Untouched: the read delay, webhooks, humanize block, everything not on the page.
        expect(ss.readDelay).toEqual((before.searchSettings as Record<string, unknown>).readDelay)
        expect(after.webhook).toEqual(before.webhook)
        expect(after.humanize).toEqual(before.humanize)
        expect(backups(r)).toHaveLength(1)
        expect(readFileSync(join(r.backupDir, backups(r)[0] ?? ''))).toEqual(beforeBytes)
        const back = await values(r)
        expect(back).toMatchObject({ dailyCheckIn: false, accountDelayMax: '4min', maxBonusSearches: 50 })
        expect(back.queryEngines).toEqual(['local', 'wikipedia'])
    })

    it('the app refuses values outside its limits before they reach the engine (file and backups unchanged)', async () => {
        const r = await ready()
        const bytes = readFileSync(r.configPath)
        const v = await values(r)
        for (const bad of [
            { ...v, searchDelayMin: '90' },
            { ...v, accountDelayMin: '10min', accountDelayMax: '1min' },
            { ...v, globalTimeout: '0sec' },
            { ...v, maxBonusSearches: -5 },
            { ...v, queryEngines: [] }
        ]) {
            expect(await r.settings.save(bad)).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
        }
        expect(readFileSync(r.configPath)).toEqual(bytes)
        expect(backups(r)).toHaveLength(0)
    })

    it('a number already in config.json (milliseconds) is shown with a unit and is not rewritten by an unrelated save', async () => {
        const r = await ready((cfg) => {
            cfg.globalTimeout = 50000
        })
        expect((await values(r)).globalTimeout).toBe('50000ms')
        expect(await r.settings.save({ ...(await values(r)), headless: true })).toMatchObject({ ok: true })
        expect(disk(r).globalTimeout).toBe(50000)
    })

    it('a config.json that already breaks min <= max is shown, refused for an unrelated save, and fixed by saving both values', async () => {
        const r = await ready((cfg) => {
            cfg.accountDelay = { min: '5min', max: '1min' }
        })
        const v = await values(r)
        expect(v).toMatchObject({ accountDelayMin: '5min', accountDelayMax: '1min' })
        expect(await r.settings.save({ ...v, headless: true })).toMatchObject({
            ok: false,
            code: 'BAD_REQUEST'
        })
        expect(
            await r.settings.save({ ...v, accountDelayMin: '1min', accountDelayMax: '3min' })
        ).toMatchObject({ ok: true })
        expect(disk(r).accountDelay).toEqual({ min: '1min', max: '3min' })
    })

    it('reset restores the Phase 9 fields to the example values and keeps webhooks and the humanize block', async () => {
        const r = await ready((cfg) => {
            cfg.prewarmDesktopLogin = true
            cfg.accountDelay = { min: '9min', max: '10min' }
            ;(cfg.workers as Record<string, unknown>).doDailyCheckIn = false
            ;(cfg.searchSettings as Record<string, unknown>).maxBonusSearches = 5
            ;(cfg.searchSettings as Record<string, unknown>).queryEngines = ['local', 'reddit']
        })
        const before = disk(r)
        useLocalOnlyExample(r)
        expect(await r.settings.reset()).toMatchObject({ ok: true })
        const after = disk(r)
        expect(after.prewarmDesktopLogin).toBe(false)
        expect(after.accountDelay).toEqual({ min: '1min', max: '3min' })
        expect((after.workers as Record<string, unknown>).doDailyCheckIn).toBe(true)
        expect((after.searchSettings as Record<string, unknown>).maxBonusSearches).toBe(110)
        expect((after.searchSettings as Record<string, unknown>).queryEngines).toEqual(['local'])
        expect(after.webhook).toEqual(before.webhook)
        expect(after.humanize).toEqual(before.humanize)
        const s = await r.settings.getState()
        expect(s.values).toEqual(s.defaults)
    })

    it('the audit line names the Phase 9 fields that changed', async () => {
        const r = await ready()
        await r.settings.save({ ...(await values(r)), searchDelayMin: '7min', maxBonusSearches: 60 })
        await r.h.audit.flush()
        const log = readLog(r.h, 'audit.log')
        expect(log).toMatch(/searchDelayMin=7min/)
        expect(log).toMatch(/maxBonusSearches=60/)
    })
})
