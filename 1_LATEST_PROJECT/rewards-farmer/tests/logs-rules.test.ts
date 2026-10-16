import { describe, expect, it } from 'vitest'
import { filterLines, formatLine, normalizeLevel, parseFilter } from '../src/shared/logs-rules'
import type { LogLine } from '../src/shared/logs-types'

const line = (over: Partial<LogLine> = {}): LogLine => ({
    seq: 1,
    session: 1,
    id: 1,
    at: '2026-10-12T10:00:00.000Z',
    level: 'info',
    title: 'FLOW',
    message: 'hello',
    user: 'alpha',
    ...over
})

describe('log rules', () => {
    it('normalizes engine level names and never guesses', () => {
        expect(normalizeLevel('INFO')).toBe('info')
        expect(normalizeLevel('Warning')).toBe('warn')
        expect(normalizeLevel('error')).toBe('error')
        expect(normalizeLevel('debug')).toBe('debug')
        for (const v of ['trace', '', undefined, null, 5, {}]) expect(normalizeLevel(v)).toBe('unknown')
    })

    it('filters by minimum level and by text in title, message or user (case-insensitive)', () => {
        const all = [
            line({ level: 'debug', message: 'd' }),
            line({ level: 'info', message: 'i' }),
            line({ level: 'warn', message: 'w' }),
            line({ level: 'error', message: 'e' }),
            line({ level: 'unknown', message: 'u' })
        ]
        expect(filterLines(all, { level: 'all', text: '' })).toHaveLength(5)
        expect(filterLines(all, { level: 'info', text: '' }).map((l) => l.message)).toEqual(['i', 'w', 'e'])
        expect(filterLines(all, { level: 'error', text: '' }).map((l) => l.message)).toEqual(['e'])
        expect(
            filterLines([line({ title: 'SEARCH-BING' })], { level: 'all', text: 'search-b' })
        ).toHaveLength(1)
        expect(filterLines([line({ user: 'Alpha' })], { level: 'all', text: 'ALPHA' })).toHaveLength(1)
        expect(filterLines([line()], { level: 'all', text: 'nope' })).toHaveLength(0)
    })

    it('formats one plain line, a missing time as "-", and never lets a message break onto two lines', () => {
        expect(formatLine(line())).toBe('2026-10-12T10:00:00.000Z [INFO] [alpha] FLOW: hello')
        expect(formatLine(line({ at: null, user: null, title: null, message: 'a\nb\r\nc' }))).toBe(
            '- [INFO] a b c'
        )
    })

    it('accepts only the exact filter shape', () => {
        expect(parseFilter({ level: 'warn', text: 'x' })).toEqual({ level: 'warn', text: 'x' })
        for (const bad of [
            null,
            undefined,
            'x',
            1,
            {},
            { level: 'trace', text: '' },
            { level: 'all' },
            { level: 'all', text: 3 },
            { level: 'all', text: 'y'.repeat(201) }
        ])
            expect(parseFilter(bad)).toBeNull()
    })
})
