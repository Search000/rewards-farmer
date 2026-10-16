// @vitest-environment node
import { dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HealthService } from '../../src/main/healthService'
import type { HealthCheck } from '../../src/shared/health-types'
import { makeHarness, waitFor } from './helpers'
import type { Harness } from './helpers'

// Phase 12 against the REAL engine control API (engine/scripts/api/server.js, unmodified, in a temp dir). Only the bot entry
// is a fixture. Proves that "Engine API answers", "Engine reads its config" and "Engine version" come from the engine itself.

const harnesses: Harness[] = []
afterEach(async () => {
    while (harnesses.length > 0) await harnesses.pop()?.cleanup()
})

function healthFor(h: Harness): HealthService {
    return new HealthService({
        engineRoot: h.fx.engineRoot,
        dataDir: dirname(h.fx.engineRoot),
        networkProbe: () => Promise.resolve({ ok: true }),
        appInfo: () => ({
            name: 'Rewards Farmer LUCK',
            version: '0.0.1',
            electron: '44.7.0',
            platform: 'win32'
        }),
        accounts: () => h.farmer.getState().accounts,
        engine: () => h.supervisor.snapshot(),
        api: () => h.farmer.engineApi(),
        redact: (t) => h.redactor.redact(t),
        appLog: h.appLog,
        nodeCommand: process.execPath
    })
}

const byId = (checks: readonly HealthCheck[], id: string): HealthCheck => {
    const c = checks.find((x) => x.id === id)
    if (c === undefined) throw new Error(`no row ${id}`)
    return c
}

describe('Health panel against the real engine API', () => {
    it('before the engine starts: honest unknown rows; after it starts: the same rows come from the engine and pass', async () => {
        const h = makeHarness({ botMode: 'run' })
        harnesses.push(h)
        const svc = healthFor(h)
        await h.farmer.init()

        const before = (await svc.runChecks()).checks
        expect(byId(before, 'engine-process').status).toBe('warning')
        for (const id of ['engine-api', 'engine-config', 'engine-version'])
            expect(byId(before, id).status).toBe('unknown')
        expect(byId(before, 'accounts-file').status).toBe('warning')

        await h.farmer.pickAccounts()
        await waitFor(
            () => h.supervisor.snapshot().link,
            (v) => v === 'ready',
            'engine ready',
            30000
        )

        const after = (await svc.runChecks()).checks
        expect(byId(after, 'engine-process').status).toBe('ok')
        expect(byId(after, 'engine-api')).toMatchObject({ status: 'ok' })
        expect(byId(after, 'engine-config')).toMatchObject({ status: 'ok' })
        expect(byId(after, 'engine-version')).toMatchObject({ status: 'ok' })
        expect(byId(after, 'accounts-file').detail).toContain('2 accounts')
        expect(byId(after, 'config-valid').status).toBe('ok')
        // The version really comes from the engine's /health, not from this app.
        const real = await h.farmer.engineApi()?.health()
        expect(typeof real?.version).toBe('string')
        expect(byId(after, 'engine-version').detail).toContain(real?.version ?? '#')
    })

    it('after the engine is stopped the rows go back to unknown / warning (state is read again, not remembered)', async () => {
        const h = makeHarness({ botMode: 'run' })
        harnesses.push(h)
        const svc = healthFor(h)
        await h.farmer.init()
        await h.farmer.pickAccounts()
        await waitFor(
            () => h.supervisor.snapshot().link,
            (v) => v === 'ready',
            'engine ready',
            30000
        )
        expect(byId((await svc.runChecks()).checks, 'engine-api').status).toBe('ok')
        await h.supervisor.stop()
        const after = (await svc.runChecks()).checks
        expect(byId(after, 'engine-api').status).not.toBe('ok')
        expect(byId(after, 'engine-process').status).not.toBe('ok')
    })
})
