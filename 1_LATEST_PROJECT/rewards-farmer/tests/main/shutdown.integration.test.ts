// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { makeHarness, readLog, waitFor } from './helpers'
import type { Harness } from './helpers'

// "Shutdown" (Settings screen): close the app after a run that finished without errors. Real engine API, fake bot, fake
// accounts (rule 18). The callback stands in for app.quit(); nothing is really closed here.

const harnesses: Harness[] = []
afterEach(async () => {
    while (harnesses.length > 0) await harnesses.pop()?.cleanup()
})

async function run(botMode: 'run' | 'finish' | 'fail', shutdown: boolean) {
    const calls = { n: 0 }
    const h = makeHarness({ botMode, onShutdownRequested: () => void (calls.n += 1) })
    harnesses.push(h)
    await h.farmer.init()
    await h.farmer.pickAccounts()
    expect((await h.farmer.setShutdownAfterRun(shutdown)).ok).toBe(true)
    return { h, calls }
}

describe('Shutdown after run', () => {
    it('on + run finishes by itself: the app is asked to close once, and it is written to the audit log', async () => {
        const { h, calls } = await run('finish', true)
        await h.farmer.startRun()
        await waitFor(
            () => h.farmer.getState(),
            (s) => s.notices.some((n) => n.message === 'Run finished.'),
            'run finished'
        )
        expect(calls.n).toBe(1)
        await h.audit.flush()
        expect(readLog(h, 'audit.log')).toMatch(/shutdown-after-run/)
    })

    it('off + run finishes by itself: the app stays open', async () => {
        const { h, calls } = await run('finish', false)
        await h.farmer.startRun()
        await waitFor(
            () => h.farmer.getState(),
            (s) => s.notices.some((n) => n.message === 'Run finished.'),
            'run finished'
        )
        expect(calls.n).toBe(0)
    })

    it('on + the user stops the run: the app stays open', async () => {
        const { h, calls } = await run('run', true)
        await h.farmer.startRun()
        await waitFor(
            () => h.farmer.getState().run.phase,
            (p) => p === 'running',
            'running'
        )
        await h.farmer.stopRun()
        await waitFor(
            () => h.farmer.getState(),
            (s) => s.notices.some((n) => n.message === 'Run stopped.'),
            'run stopped'
        )
        expect(calls.n).toBe(0)
    })

    it('on + the run ends with an error: the app stays open so the error can be read', async () => {
        const { h, calls } = await run('fail', true)
        await h.farmer.startRun()
        await waitFor(
            () => h.farmer.getState(),
            (s) => s.notices.some((n) => n.severity === 'error' && /ended unexpectedly/.test(n.message)),
            'run failed'
        )
        expect(calls.n).toBe(0)
    })

    it('the setting survives an app restart (read back from app-settings.json)', async () => {
        const { h } = await run('finish', true)
        const { AppSettingsStore } = await import('../../src/main/appSettings')
        const again = await new AppSettingsStore(h.fx.userData).load()
        expect(again.settings.shutdownAfterRun).toBe(true)
        expect(again.settings.schemaVersion).toBe(2)
    })
})
