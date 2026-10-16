// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { JsonlLog } from '../../src/main/jsonlLog'
import { LogService } from '../../src/main/logService'
import { join } from 'node:path'
import { FAKE_PASSWORD, makeHarness, waitFor } from './helpers'
import type { Harness } from './helpers'

// Against the REAL engine control API (engine/scripts/api/server.js, unmodified, in a temp dir). Only the bot entry is a
// fixture (tests/fixtures/fake-bot.cjs). Proves that every line the app shows really came out of the engine's own /logs.

const harnesses: Harness[] = []
const services: LogService[] = []
afterEach(async () => {
    while (services.length > 0) await services.pop()?.stop()
    while (harnesses.length > 0) await harnesses.pop()?.cleanup()
})

function makeService(h: Harness): LogService {
    const redact = (t: string): string => h.redactor.redact(t)
    const dir = join(h.fx.userData, 'logs')
    const svc = new LogService({
        api: () => h.farmer.engineApi(),
        redact,
        engineLog: new JsonlLog(dir, 'engine.log', 'engine', redact),
        errorsLog: new JsonlLog(dir, 'errors.log', 'engine', redact),
        audit: h.audit,
        appLog: h.appLog,
        pickSavePath: () => Promise.resolve(null),
        pollMs: 100,
        backoffMinMs: 50
    })
    services.push(svc)
    return svc
}

describe('Logs against the real engine API', () => {
    it('shows exactly the lines the engine buffered, keeps them after the engine stops, and starts a new session after a restart', async () => {
        const h = makeHarness({ botMode: 'run' })
        harnesses.push(h)
        const svc = makeService(h)
        svc.start()
        await h.farmer.init()
        // Before the engine exists: honest "not running", no lines.
        expect(svc.getState()).toMatchObject({ connection: 'idle', status: 'unavailable', lines: [] })

        h.redactor.add(FAKE_PASSWORD)
        await h.farmer.pickAccounts()
        const started = await h.farmer.startRun()
        expect(started, JSON.stringify(started)).toMatchObject({ ok: true })
        await waitFor(
            () => svc.getState().lines.some((l) => l.title === 'FLOW'),
            (v) => v,
            'bot FLOW line in the log view',
            30000
        )
        const state = svc.getState()
        expect(state.connection).toBe('live')

        // Every line shown exists in the engine's own buffer with the same id and message (nothing invented).
        const api = h.farmer.engineApi()
        const engineSide = (await api?.logs(500))?.logs ?? []
        const byId = new Map(engineSide.map((l) => [l.id, l]))
        const shown = svc.getState().lines
        expect(shown.length).toBeGreaterThan(0)
        for (const l of shown) {
            expect(l.id).not.toBeNull()
            const real = byId.get(l.id ?? -1)
            expect(real).toBeDefined()
            expect(l.message).toBe(real?.message)
            expect(l.title).toBe(real?.title ?? null)
        }
        expect(shown.some((l) => l.title === 'FLOW')).toBe(true)
        expect(JSON.stringify(shown)).not.toContain(FAKE_PASSWORD)
        const sessionBefore = shown[0]?.session

        // Engine stops: view says so, history stays.
        await h.farmer.stopRun()
        await h.supervisor.stop()
        await waitFor(
            () => svc.getState().connection,
            (c) => c === 'idle',
            'idle after engine stop',
            30000
        )
        expect(svc.getState().lines.length).toBeGreaterThanOrEqual(shown.length)

        // Restart: ids start again, lines get a new session number.
        expect(await h.farmer.restartEngine()).toMatchObject({ ok: true })
        await waitFor(
            () => svc.getState().connection,
            (c) => c === 'live',
            'live after restart',
            30000
        )
        await h.farmer.startRun()
        await waitFor(
            () => svc.getState().lines.some((l) => l.session !== sessionBefore),
            (v) => v,
            'lines from the new engine session',
            30000
        )
    })

    it('shows the failing bot error as an ERROR line', async () => {
        const h = makeHarness({ botMode: 'fail' })
        harnesses.push(h)
        const svc = makeService(h)
        svc.start()
        await h.farmer.init()
        await h.farmer.pickAccounts()
        await h.farmer.startRun()
        await waitFor(
            () => svc.getState().lines.find((l) => l.level === 'error'),
            (l) => l !== undefined,
            'error line',
            30000
        )
        const err = svc.getState().lines.find((l) => l.level === 'error')
        expect(err?.message).toContain('Login failed')
    })
})
