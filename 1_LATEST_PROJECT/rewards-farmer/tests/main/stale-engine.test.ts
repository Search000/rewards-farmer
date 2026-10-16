// @vitest-environment node
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_REAP_DEPS, reapStaleEngine, writePidFile } from '../../src/main/engine/staleEngine'
import { isProcessAlive } from '../../src/main/engine/supervisor-process'

// Real processes, real PID file. Linux/macOS only: command-line identity uses /proc here. The Windows PowerShell path
// is NOT TESTED in the sandbox.
const posix = process.platform !== 'win32'
const spawned: number[] = []
afterEach(() => {
    for (const pid of spawned.splice(0)) {
        try {
            process.kill(pid, 'SIGKILL')
        } catch {
            /* already gone */
        }
    }
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function startNode(script: string): number {
    const child = spawn(process.execPath, [script], { stdio: 'ignore', detached: true })
    child.unref()
    if (child.pid === undefined) throw new Error('spawn failed')
    spawned.push(child.pid)
    return child.pid
}

async function waitDead(pid: number): Promise<boolean> {
    for (let i = 0; i < 40; i += 1) {
        if (!isProcessAlive(pid)) return true
        await sleep(50)
    }
    return false
}

describe.skipIf(!posix)('leftover engine process from a force-killed app', () => {
    const logs: string[] = []
    const deps = () => DEFAULT_REAP_DEPS((_l, m) => logs.push(m))

    it('no pid file: nothing happens', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rf-stale-'))
        expect(await reapStaleEngine(join(dir, 'engine.pid'), deps())).toBe('none')
    })

    it('a leftover process whose command line is our engine server is stopped and the file removed', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rf-stale-'))
        const server = join(dir, 'server.js')
        writeFileSync(server, 'setInterval(() => {}, 1000)\n')
        const pid = startNode(server)
        const pidFile = join(dir, 'engine.pid')
        await writePidFile(pidFile, pid, server)
        await sleep(300)
        expect(isProcessAlive(pid)).toBe(true)
        expect(await reapStaleEngine(pidFile, deps())).toBe('killed')
        expect(await waitDead(pid)).toBe(true)
        expect(existsSync(pidFile)).toBe(false)
    })

    it('a live process that is NOT our engine (recycled pid) is never killed', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rf-stale-'))
        const other = join(dir, 'something-else.js')
        writeFileSync(other, 'setInterval(() => {}, 1000)\n')
        const pid = startNode(other)
        const pidFile = join(dir, 'engine.pid')
        await writePidFile(pidFile, pid, join(dir, 'server.js'))
        await sleep(300)
        expect(await reapStaleEngine(pidFile, deps())).toBe('unverified')
        expect(isProcessAlive(pid)).toBe(true)
        expect(existsSync(pidFile)).toBe(false)
        expect(logs.some((m) => m.includes('NOT stopped'))).toBe(true)
    })

    it('a dead pid or a corrupt file is cleaned up without touching anything', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rf-stale-'))
        const pidFile = join(dir, 'engine.pid')
        writeFileSync(pidFile, 'not json')
        expect(await reapStaleEngine(pidFile, deps())).toBe('gone')
        expect(existsSync(pidFile)).toBe(false)
        await writePidFile(pidFile, 2147483, join(dir, 'server.js'))
        expect(await reapStaleEngine(pidFile, deps())).toBe('gone')
    })
})
