// @vitest-environment node
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { restrictToCurrentUser } from '../src/main/privatePerms'

describe('restrictToCurrentUser (Phase 10)', () => {
    it.skipIf(process.platform === 'win32')('POSIX: file 600, folder 700', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rf-perm-'))
        try {
            const file = join(dir, 'config.json')
            writeFileSync(file, '{}', { mode: 0o644 })
            expect((await restrictToCurrentUser(file, false)).ok).toBe(true)
            expect(statSync(file).mode & 0o777).toBe(0o600)
            expect((await restrictToCurrentUser(dir, true)).ok).toBe(true)
            expect(statSync(dir).mode & 0o777).toBe(0o700)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('POSIX: a missing path gives ok=false with a plain detail, no throw', async () => {
        if (process.platform === 'win32') return
        const res = await restrictToCurrentUser(join(tmpdir(), 'rf-does-not-exist-xyz'), false)
        expect(res.ok).toBe(false)
        expect(res.detail).toMatch(/could not limit permissions/i)
    })

    it('Windows: icacls is called with an argument list (no shell), inheritance removed, current user only', async () => {
        const calls: { file: string; args: readonly string[] }[] = []
        const run = (file: string, args: readonly string[]) => {
            calls.push({ file, args })
            return Promise.resolve()
        }
        const f = await restrictToCurrentUser('C:\\data\\config.json', false, {
            platform: 'win32',
            username: 'alice',
            run
        })
        const d = await restrictToCurrentUser('C:\\data\\backups', true, {
            platform: 'win32',
            username: 'alice',
            run
        })
        expect(f.ok && d.ok).toBe(true)
        expect(calls[0]).toEqual({
            file: 'icacls',
            args: ['C:\\data\\config.json', '/inheritance:r', '/grant:r', 'alice:F']
        })
        expect(calls[1]?.args).toEqual(['C:\\data\\backups', '/inheritance:r', '/grant:r', 'alice:(OI)(CI)F'])
    })

    it('Windows: a failing icacls is reported, not thrown', async () => {
        const res = await restrictToCurrentUser('C:\\x', false, {
            platform: 'win32',
            username: 'alice',
            run: () => Promise.reject(Object.assign(new Error('boom'), { code: 'ENOENT' }))
        })
        expect(res).toEqual({ ok: false, detail: 'Could not limit permissions (ENOENT).' })
    })
})
