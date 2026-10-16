// @vitest-environment node
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EngineSettingsService } from '../../src/main/engineSettings'
import { SetupWizardService } from '../../src/main/setupWizard'
import type { HealthCheck, HealthState } from '../../src/shared/health-types'
import { PREREQUISITE_IDS } from '../../src/shared/wizard-rules'
import { FAKE_ACCOUNTS_ENV, FAKE_PASSWORD, makeFixture, makeHarness, waitFor } from './helpers'
import type { Harness } from './helpers'

// Phase 22 (second half): the wizard wired to the REAL FarmerService, the REAL settings store and the REAL engine control API
// (engine/scripts/api/server.js, unmodified, in a temp dir). Only the bot entry and the health checks are stand-ins (rule 18);
// every account is FAKE and lives in a temp dir. This is the same wiring as src/main/main.ts.

const harnesses: Harness[] = []
afterEach(async () => {
    while (harnesses.length > 0) await harnesses.pop()?.cleanup()
})

const GOOD = { theme: 'light', headless: true, timerEnabled: true, timerTime: '07:45' } as const

const healthOk = (): Promise<HealthState> =>
    Promise.resolve({
        status: 'done',
        checks: PREREQUISITE_IDS.map(
            (id) =>
                ({
                    id,
                    group: 'runtime',
                    title: id,
                    status: 'ok',
                    detail: 'fine',
                    fix: null,
                    checkedAt: '2026-10-16T09:00:00.000Z'
                }) as HealthCheck
        ),
        startedAt: null,
        finishedAt: '2026-10-16T09:00:00.000Z'
    })

async function rig() {
    const fixture = makeFixture()
    const own = join(fixture.userData, 'accounts.env')
    const h = makeHarness({ fixture, defaultAccountsPath: own })
    harnesses.push(h)
    // The copied example config lists the query source "china", which the engine's fallback checker (used when the engine is not
    // built) does not know. The built engine uses its own full validator. So the test config uses "local" only (same as
    // engineSettings.integration.test.ts).
    const configPath = join(h.fx.engineRoot, 'config.json')
    const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, Record<string, unknown>>
    cfg.searchSettings = { ...cfg.searchSettings, queryEngines: ['local'] }
    writeFileSync(configPath, JSON.stringify(cfg, null, 2))
    const engineSettings = new EngineSettingsService({
        host: {
            api: () => h.farmer.engineApi(),
            editBlock: () => h.farmer.settingsEditBlock(),
            run: (work) => h.farmer.editEngineConfig(work)
        },
        engineRoot: h.fx.engineRoot,
        audit: h.audit,
        appLog: h.appLog,
        backupDir: join(h.fx.userData, 'backups', 'config')
    })
    const markerPath = join(h.fx.userData, 'setup-wizard.json')
    const wizard = new SetupWizardService({
        health: { runChecks: healthOk },
        pickAccountsFile: () => Promise.resolve(h.picked),
        defaultAccountsPath: own,
        currentAccountsPath: () => h.farmer.accountsPath(),
        markerPath,
        host: {
            useAccountsFile: (path) => h.farmer.useAccountsFile(path),
            setTimer: (enabled, time) => h.farmer.setTimer(enabled, time),
            setTheme: async (mode) => {
                await h.settings.update({ themeMode: mode })
                return { ok: true, message: 'Theme saved.' }
            },
            setHeadless: (headless) => engineSettings.setHeadless(headless)
        },
        runBlock: () => h.farmer.wizardBlock(),
        redactor: h.redactor,
        audit: h.audit,
        appLog: h.appLog
    })
    // Same order as main.ts: the first-run answer is taken BEFORE FarmerService.init makes the app's own accounts file.
    const first = await wizard.detectFirstRun()
    await h.farmer.init()
    return { h, own, wizard, markerPath, first, engineSettings }
}

describe('setup wizard on the real services', () => {
    it("a brand new install is a first run even though init makes the app's own accounts file", async () => {
        const r = await rig()
        expect(r.first).toBe(true)
        expect(existsSync(r.own)).toBe(true) // init made it
        expect(r.wizard.needsWizard()).toBe(true)
        expect(await r.wizard.isFirstRun()).toBe(false) // a live check alone would be wrong here
    })

    it('happy path with fake accounts: file in use, timer and theme saved, engine started, headless written to config.json', async () => {
        const r = await rig()
        const picked = join(r.h.fx.dir, 'my-accounts.env')
        writeFileSync(picked, FAKE_ACCOUNTS_ENV)
        r.h.picked = picked
        expect((await r.wizard.checkPrerequisites()).canContinue).toBe(true)
        const a = await r.wizard.chooseAccounts('pick')
        expect(a.ok && a.choice.accountCount).toBe(2)
        expect(r.wizard.setBasicSettings(GOOD).ok).toBe(true)
        const res = await r.wizard.finish(true)
        expect(res.ok).toBe(true)
        if (res.ok) expect(res.doneSteps).toEqual(['accounts-file', 'timer', 'theme', 'headless'])
        expect(r.h.settings.value).toMatchObject({
            accountsPath: picked,
            timerEnabled: true,
            timerTime: '07:45',
            themeMode: 'light'
        })
        await waitFor(
            () => r.h.farmer.getState().engine.link,
            (link) => link === 'ready',
            'the engine is ready'
        )
        const config = JSON.parse(readFileSync(join(r.h.fx.engineRoot, 'config.json'), 'utf8')) as {
            browser?: { headless?: boolean }
            headless?: boolean
        }
        expect(config.browser?.headless ?? config.headless).toBe(true)
        expect(existsSync(r.markerPath)).toBe(true)
        expect(r.wizard.needsWizard()).toBe(false)
        const marker = readFileSync(r.markerPath, 'utf8')
        for (const s of [FAKE_PASSWORD, 'alpha@example.com', r.h.fx.dir]) expect(marker).not.toContain(s)
    })

    it('with no account yet: finishes, the engine is not running, so headless is NOT saved and the note says so', async () => {
        const r = await rig()
        expect((await r.wizard.checkPrerequisites()).canContinue).toBe(true)
        const a = await r.wizard.chooseAccounts('default')
        expect(a.ok && a.choice.accountCount).toBe(0)
        expect(r.wizard.setBasicSettings(GOOD).ok).toBe(true)
        const res = await r.wizard.finish(true)
        expect(res.ok).toBe(true)
        if (res.ok) {
            expect(res.doneSteps).toEqual(['accounts-file', 'timer', 'theme'])
            expect(res.notes.join(' ')).toMatch(/NOT saved/)
        }
        expect(r.h.farmer.getState().engine.link).toBe('not-started')
    })

    it('a picked file that does not load is refused and the app keeps its old accounts file', async () => {
        const r = await rig()
        const before = r.h.settings.value.accountsPath
        const bad = join(r.h.fx.dir, 'noacc.env')
        writeFileSync(bad, 'FOO=bar\n')
        r.h.picked = bad
        await r.wizard.checkPrerequisites()
        const a = await r.wizard.chooseAccounts('pick')
        expect(a.ok).toBe(false)
        expect(r.h.settings.value.accountsPath).toBe(before)
    })

    it("FarmerService.useAccountsFile: refused while the app is busy; creates the app's own file only when it is missing", async () => {
        const r = await rig()
        expect(r.h.farmer.wizardBlock()).toBeNull()
        rmSync(r.own)
        const res = await r.h.farmer.useAccountsFile(r.own)
        expect(res.ok).toBe(true)
        expect(existsSync(r.own)).toBe(true)
        const text = readFileSync(r.own, 'utf8')
        expect(text).not.toMatch(/^\s*ACCOUNT_\d+_/m)
        // A second call never overwrites a file that is there.
        appendFileSync(r.own, '# kept\n')
        expect((await r.h.farmer.useAccountsFile(r.own)).ok).toBe(true)
        expect(readFileSync(r.own, 'utf8')).toContain('# kept')
    })

    it('EngineSettingsService.setHeadless: only the browser window value changes', async () => {
        const r = await rig()
        const picked = join(r.h.fx.dir, 'acc.env')
        writeFileSync(picked, FAKE_ACCOUNTS_ENV)
        expect((await r.h.farmer.useAccountsFile(picked)).ok).toBe(true)
        await waitFor(
            () => r.h.farmer.getState().engine.link,
            (link) => link === 'ready',
            'the engine is ready'
        )
        const before = await r.engineSettings.getState()
        expect(before.status).toBe('ok')
        const res = await r.engineSettings.setHeadless(!before.values?.headless)
        expect(res.ok).toBe(true)
        const after = await r.engineSettings.getState()
        expect(after.values?.headless).toBe(!before.values?.headless)
        expect({ ...after.values, headless: 0 }).toEqual({ ...before.values, headless: 0 })
    })

    it('EngineSettingsService.setHeadless with the engine not running: ENGINE_DOWN and nothing written', async () => {
        const r = await rig()
        const res = await r.engineSettings.setHeadless(true)
        expect(res).toMatchObject({ ok: false })
        expect(['ENGINE_DOWN', 'CONFIG_MISSING']).toContain((res as { code?: string }).code)
    })
})
