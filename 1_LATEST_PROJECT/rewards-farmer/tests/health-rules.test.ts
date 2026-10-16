import { describe, expect, it } from 'vitest'
import {
    CHECK_DEFS,
    DISK_ERROR_BYTES,
    DISK_WARNING_BYTES,
    driveOf,
    evaluateDisk,
    formatBytes,
    recheckKey,
    countChecks,
    makeCheck,
    overallStatus,
    parseGitVersion,
    parseNodeMajor,
    parseNodeVersion,
    sameVersion,
    summaryText
} from '../src/shared/health-rules'
import type { HealthCheckId } from '../src/shared/health-types'

const T = '2026-10-14T10:00:00.000Z'

describe('health rules (Phase 12)', () => {
    it('every check id has exactly one definition (title and group)', () => {
        const ids = CHECK_DEFS.map((d) => d.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).toHaveLength(17)
        for (const d of CHECK_DEFS) {
            expect(d.title.length).toBeGreaterThan(0)
            expect(['runtime', 'config', 'engine', 'system']).toContain(d.group)
        }
    })

    it('parses Node, Git and version texts, and returns null for anything else (never guesses)', () => {
        expect(parseNodeMajor('v24.21.0\n')).toBe(24)
        expect(parseNodeMajor('v22.22.2')).toBe(22)
        expect(parseNodeMajor('node 24')).toBeNull()
        expect(parseNodeMajor('')).toBeNull()
        expect(parseNodeVersion('v24.21.0\r\n')).toBe('24.21.0')
        expect(parseNodeVersion('x')).toBeNull()
        expect(parseGitVersion('git version 2.45.1.windows.1\n')).toBe('2.45.1.windows.1')
        expect(parseGitVersion('hello')).toBeNull()
        expect(sameVersion('4.3.2', 'v4.3.2')).toBe(true)
        expect(sameVersion('4.3.2', '4.3.3')).toBe(false)
        expect(sameVersion('4.3.2-beta', '4.3.2')).toBeNull()
    })

    it('a warning or error row without a fix text is a programming error; ok and unknown need none', () => {
        expect(() => makeCheck('node', 'error', 'bad', null, T)).toThrow(/no fix text/)
        expect(() => makeCheck('node', 'warning', 'bad', '  ', T)).toThrow(/no fix text/)
        expect(makeCheck('node', 'ok', 'fine', 'ignored', T).fix).toBeNull()
        expect(makeCheck('node', 'unknown', 'dunno', null, T).fix).toBeNull()
        expect(makeCheck('node', 'error', 'bad', 'Do this.', T)).toMatchObject({
            id: 'node',
            group: 'runtime',
            status: 'error',
            fix: 'Do this.',
            checkedAt: T
        })
    })

    it('summary never counts "unknown" as good', () => {
        const mk = (id: HealthCheckId, s: 'ok' | 'warning' | 'error' | 'unknown') =>
            makeCheck(id, s, 'd', s === 'warning' || s === 'error' ? 'fix' : null, T)
        expect(summaryText([])).toBe('No check has run yet.')
        const allOk = [mk('app', 'ok'), mk('node', 'ok')]
        expect(summaryText(allOk)).toBe('All 2 checks passed.')
        expect(overallStatus(allOk)).toBe('ok')
        const mixed = [
            mk('app', 'ok'),
            mk('node', 'error'),
            mk('git', 'warning'),
            mk('engine-api', 'unknown')
        ]
        expect(countChecks(mixed)).toEqual({ ok: 1, warning: 1, error: 1, unknown: 1 })
        expect(summaryText(mixed)).toBe('1 problem, 1 warning, 1 could not be checked. 1 of 4 checks passed.')
        expect(overallStatus(mixed)).toBe('error')
        expect(overallStatus([mk('app', 'ok'), mk('engine-api', 'unknown')])).toBe('unknown')
        expect(summaryText([mk('app', 'ok'), mk('engine-api', 'unknown')])).not.toMatch(/All/)
    })

    it('Phase 13: disk thresholds, byte text, drive letter and the re-check key', () => {
        expect(evaluateDisk(DISK_ERROR_BYTES - 1)).toBe('error')
        expect(evaluateDisk(DISK_ERROR_BYTES)).toBe('warning')
        expect(evaluateDisk(DISK_WARNING_BYTES - 1)).toBe('warning')
        expect(evaluateDisk(DISK_WARNING_BYTES)).toBe('ok')
        expect(evaluateDisk(0)).toBe('error')
        expect(formatBytes(0)).toBe('0 bytes')
        expect(formatBytes(1536)).toBe('1.5 KB')
        expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB')
        expect(formatBytes(250 * 1024 ** 2)).toBe('250 MB')
        expect(formatBytes(-1)).toBe('unknown')
        expect(formatBytes(Number.NaN)).toBe('unknown')
        expect(driveOf('c:\\Users\\me\\engine')).toBe('C:')
        expect(driveOf('D:/data')).toBe('D:')
        expect(driveOf('/home/me')).toBeNull()
        const base = { engine: { link: 'ready' }, accounts: { status: 'ok', count: 2 } }
        expect(recheckKey(base)).toBe(recheckKey({ ...base }))
        expect(recheckKey({ ...base, engine: { link: 'down' } })).not.toBe(recheckKey(base))
        expect(recheckKey({ ...base, accounts: { status: 'ok', count: 3 } })).not.toBe(recheckKey(base))
        expect(recheckKey({ ...base, accounts: { status: 'error', count: 2 } })).not.toBe(recheckKey(base))
        expect(
            recheckKey({ engine: { link: 'ready' }, accounts: { status: 'not-set', count: null } })
        ).toContain('-')
    })
})
