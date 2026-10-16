// @vitest-environment node
import { createServer } from 'node:net'
import type { Server } from 'node:net'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
    defaultDiskProbe,
    defaultFolderProbe,
    defaultNetworkProbe,
    HealthService
} from '../../src/main/healthService'
import type { DiskProbe, FolderProbe, NetworkProbe } from '../../src/main/healthService'
import type { HealthCheck, HealthCheckId } from '../../src/shared/health-types'

// Phase 13: disk space, folder permissions, internet. Failures are produced by isolated stand-ins or by REAL local state
// (a missing folder, a file where a folder should be, a local port with nobody listening, a local server). Nothing here
// depends on this machine's real disk or real internet, and no test touches a real user folder.

const dirs: string[] = []
const servers: Server[] = []
afterEach(() => {
    while (dirs.length > 0) {
        const d = dirs.pop() ?? ''
        try {
            chmodSync(d, 0o700)
        } catch {
            /* gone */
        }
        rmSync(d, { recursive: true, force: true })
    }
    while (servers.length > 0) servers.pop()?.close()
})

const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'rf-sys-'))
    dirs.push(d)
    return d
}

interface Probes {
    readonly disk?: DiskProbe
    readonly folder?: FolderProbe
    readonly net?: NetworkProbe
    readonly dataDir?: string
    readonly engineRoot?: string
    readonly target?: { host: string; port: number }
}

const GB = 1024 ** 3
const MB = 1024 ** 2

async function rows(p: Probes = {}): Promise<Record<HealthCheckId, HealthCheck>> {
    const svc = new HealthService({
        engineRoot: p.engineRoot ?? tmp(),
        dataDir: p.dataDir ?? tmp(),
        appInfo: () => ({ name: 'x', version: '1', electron: '1', platform: 'win32' }),
        accounts: () => ({ status: 'ok', error: null, count: 1 }),
        engine: () => ({ link: 'ready', detail: null, version: null }),
        api: () => null,
        redact: (t) => t,
        runCommand: () => Promise.resolve({ ok: true, stdout: 'v24.21.0' }),
        diskProbe: p.disk ?? (() => Promise.resolve({ freeBytes: 50 * GB })),
        networkProbe: p.net ?? (() => Promise.resolve({ ok: true })),
        ...(p.folder === undefined ? {} : { folderProbe: p.folder }),
        ...(p.target === undefined ? {} : { networkTarget: p.target })
    })
    const state = await svc.runChecks()
    return Object.fromEntries(state.checks.map((c) => [c.id, c])) as Record<HealthCheckId, HealthCheck>
}

describe('free disk space', () => {
    it('plenty of space -> ok and shows both places', async () => {
        const r = await rows()
        expect(r['disk-space'].status).toBe('ok')
        expect(r['disk-space'].detail).toMatch(/50\.0 GB on the app data drive, 50\.0 GB on the engine drive/)
    })

    it('under 1 GB -> warning; under 200 MB -> error; each with a clear fix (drive letter when the path has one)', async () => {
        const warn = await rows({ disk: () => Promise.resolve({ freeBytes: 600 * MB }) })
        expect(warn['disk-space'].status).toBe('warning')
        expect(warn['disk-space'].detail).toContain('getting full')
        const low = await rows({
            disk: () => Promise.resolve({ freeBytes: 50 * MB }),
            dataDir: 'C:\\Users\\me\\AppData',
            engineRoot: 'C:\\rf\\engine'
        })
        expect(low['disk-space'].status).toBe('error')
        expect(low['disk-space'].detail).toContain('almost full')
        expect(low['disk-space'].fix).toContain('drive C:')
        expect(low['disk-space'].fix).toContain('Recycle Bin')
    })

    it('the LOWEST of the two drives decides', async () => {
        const disk: DiskProbe = (path) =>
            Promise.resolve({ freeBytes: path.includes('data') ? 10 * GB : 100 * MB })
        const r = await rows({ disk, dataDir: 'D:\\data', engineRoot: 'E:\\engine' })
        expect(r['disk-space'].status).toBe('error')
        expect(r['disk-space'].fix).toContain('drive E:')
    })

    it('one place cannot be measured -> the other still counts and the text says so; both fail -> unknown (never ok)', async () => {
        const one = await rows({
            disk: (path) =>
                path.includes('engine')
                    ? Promise.reject(new Error('x'))
                    : Promise.resolve({ freeBytes: 100 * MB }),
            dataDir: '/data',
            engineRoot: '/engine'
        })
        expect(one['disk-space'].status).toBe('error')
        expect(one['disk-space'].detail).toMatch(/could not be measured/)
        const none = await rows({ disk: () => Promise.reject(new Error('x')) })
        expect(none['disk-space'].status).toBe('unknown')
    })

    it('the real disk probe returns a positive number of free bytes for a real folder', async () => {
        const info = await defaultDiskProbe(tmp())
        expect(info.freeBytes).toBeGreaterThan(0)
        await expect(defaultDiskProbe(join(tmp(), 'nope'))).rejects.toThrow()
    })
})

describe('folder read/write', () => {
    it('real folders -> ok, and the test file is gone again (the folder is exactly as before)', async () => {
        const data = tmp()
        const engine = tmp()
        writeFileSync(join(data, 'settings.json'), '{"keep":true}')
        const before = readdirSync(data)
        const r = await rows({ dataDir: data, engineRoot: engine })
        expect(r['folder-data'].status).toBe('ok')
        expect(r['folder-engine'].status).toBe('ok')
        expect(r['folder-data'].detail).toContain(data)
        expect(readdirSync(data)).toEqual(before)
        expect(readdirSync(engine)).toEqual([])
    })

    it('a folder that does not exist (real state) -> error; a FILE where the folder should be -> error', async () => {
        const base = tmp()
        const asFile = join(base, 'iamafile')
        writeFileSync(asFile, 'x')
        const r = await rows({ dataDir: join(base, 'missing'), engineRoot: asFile })
        expect(r['folder-data'].status).toBe('error')
        expect(r['folder-data'].detail).toMatch(/does not exist/)
        expect(r['folder-data'].fix).toContain('START.bat')
        expect(r['folder-engine'].status).toBe('error')
        expect(r['folder-engine'].fix).toContain('START.bat')
    })

    it('permission denied / read-only / disk full / other (isolated stand-in) -> error with plain-language advice', async () => {
        const mk =
            (code: string): FolderProbe =>
            () =>
                Promise.resolve({ ok: false, code })
        const denied = await rows({ folder: mk('EACCES') })
        expect(denied['folder-data'].status).toBe('error')
        expect(denied['folder-data'].detail).toMatch(/does not allow the app to write/)
        expect(denied['folder-data'].fix).toMatch(/Documents/)
        expect(denied['folder-data'].fix).toMatch(/Controlled folder access/)
        expect((await rows({ folder: mk('EPERM') }))['folder-engine'].detail).toMatch(/does not allow/)
        expect((await rows({ folder: mk('EROFS') }))['folder-data'].detail).toMatch(/read-only/)
        expect((await rows({ folder: mk('ENOSPC') }))['folder-data'].detail).toMatch(/disk is full/)
        const other = await rows({ folder: mk('EMFILE') })
        expect(other['folder-data'].detail).toContain('EMFILE')
        expect(other['folder-data'].fix).not.toBeNull()
    })

    it('a test file that cannot be deleted again -> warning that names the file pattern', async () => {
        const r = await rows({ folder: () => Promise.resolve({ ok: true, leftover: true }) })
        expect(r['folder-data'].status).toBe('warning')
        expect(r['folder-data'].fix).toContain('.rf-health-probe')
    })

    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
        'REAL permission denied: a read-only folder is detected (skipped as root and on Windows, where it cannot be made)',
        async () => {
            const d = tmp()
            mkdirSync(join(d, 'ro'))
            chmodSync(join(d, 'ro'), 0o500)
            expect(await defaultFolderProbe(join(d, 'ro'))).toEqual({ ok: false, code: 'EACCES' })
        }
    )

    it('the real probe never overwrites or removes an existing file', async () => {
        const d = tmp()
        for (let i = 0; i < 5; i += 1) writeFileSync(join(d, `f${String(i)}.txt`), `data${String(i)}`)
        const r = await defaultFolderProbe(d)
        expect(r).toEqual({ ok: true, leftover: false })
        expect(readdirSync(d).sort()).toEqual(['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt'])
        expect(existsSync(join(d, 'f3.txt'))).toBe(true)
    })
})

describe('internet connection', () => {
    it('reachable -> ok, and the text says nothing was sent', async () => {
        const r = await rows()
        expect(r.network.status).toBe('ok')
        expect(r.network.detail).toContain('rewards.bing.com')
        expect(r.network.detail).toMatch(/nothing was sent/)
    })

    it('the name cannot be looked up (offline) -> error with advice and the Re-run button name', async () => {
        const r = await rows({ net: () => Promise.resolve({ ok: false, stage: 'dns', code: 'ENOTFOUND' }) })
        expect(r.network.status).toBe('error')
        expect(r.network.detail).toMatch(/looks offline/)
        expect(r.network.fix).toContain('Re-run checks')
        expect(r.network.fix).toContain('VPN')
    })

    it('name found but no connection (firewall / proxy) -> warning, not error (a proxy can make this normal)', async () => {
        const r = await rows({
            net: () => Promise.resolve({ ok: false, stage: 'connect', code: 'ETIMEDOUT' })
        })
        expect(r.network.status).toBe('warning')
        expect(r.network.detail).toContain('ETIMEDOUT')
        expect(r.network.fix).toMatch(/proxy/)
    })

    it('a probe that throws -> unknown, never ok', async () => {
        const r = await rows({ net: () => Promise.reject(new Error('boom')) })
        expect(r.network.status).toBe('unknown')
    })

    it('REAL connection to a local server -> ok, and no byte is sent to it', async () => {
        let received = 0
        let connected = 0
        const server = createServer((socket) => {
            connected += 1
            socket.on('data', (b) => {
                received += b.length
            })
        })
        servers.push(server)
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const port = (server.address() as { port: number }).port
        const res = await defaultNetworkProbe('127.0.0.1', port, 3000)
        expect(res).toEqual({ ok: true })
        await new Promise((r) => setTimeout(r, 100))
        expect(connected).toBe(1)
        expect(received).toBe(0)
        const viaService = await rows({ net: defaultNetworkProbe, target: { host: '127.0.0.1', port } })
        expect(viaService.network.status).toBe('ok')
    })

    it('REAL closed port (nobody listening) -> connect failure -> warning', async () => {
        const server = createServer()
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const port = (server.address() as { port: number }).port
        await new Promise<void>((resolve) => server.close(() => resolve()))
        const res = await defaultNetworkProbe('127.0.0.1', port, 3000)
        expect(res).toMatchObject({ ok: false, stage: 'connect', code: 'ECONNREFUSED' })
        const r = await rows({ net: defaultNetworkProbe, target: { host: '127.0.0.1', port } })
        expect(r.network.status).toBe('warning')
    })

    it('REAL name that does not exist (.invalid is reserved) -> DNS failure -> error', async () => {
        const res = await defaultNetworkProbe('rf-no-such-host.invalid', 443, 3000)
        expect(res).toMatchObject({ ok: false, stage: 'dns' })
    }, 20000)
})

describe('every new warning/error row tells the user what to do', () => {
    it('across all failure scenarios no fix is missing, and no typed command is asked', async () => {
        const scenarios: Probes[] = [
            {
                disk: () => Promise.resolve({ freeBytes: 10 * MB }),
                folder: () => Promise.resolve({ ok: false, code: 'EACCES' }),
                net: () => Promise.resolve({ ok: false, stage: 'dns', code: 'ENOTFOUND' })
            },
            {
                disk: () => Promise.resolve({ freeBytes: 500 * MB }),
                folder: () => Promise.resolve({ ok: false, code: 'EROFS' }),
                net: () => Promise.resolve({ ok: false, stage: 'connect', code: 'ECONNREFUSED' })
            },
            { folder: () => Promise.resolve({ ok: true, leftover: true }) }
        ]
        let n = 0
        for (const s of scenarios) {
            const r = await rows(s)
            for (const id of ['disk-space', 'folder-data', 'folder-engine', 'network'] as const) {
                const c = r[id]
                if (c.status !== 'warning' && c.status !== 'error') continue
                n += 1
                expect((c.fix ?? '').length, id).toBeGreaterThan(30)
                expect(c.fix, id).not.toMatch(/npm |chmod|icacls|cmd |powershell/i)
            }
        }
        expect(n).toBeGreaterThanOrEqual(9)
    })
})
