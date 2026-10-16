// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SseParser } from '../../src/main/engine/sse'

describe('SseParser', () => {
    it('parses named events with id and data', () => {
        const p = new SseParser()
        const out = p.push('id: 419\nevent: log\ndata: {"id":419}\n\n')
        expect(out).toEqual([{ event: 'log', data: '{"id":419}', id: '419' }])
        expect(p.lastEventId).toBe('419')
    })

    it('handles frames split across chunks, including a split CRLF', () => {
        const p = new SseParser()
        expect(p.push('event: log\r')).toEqual([])
        expect(p.push('\ndata: hel')).toEqual([])
        expect(p.push('lo\r\n\r')).toEqual([])
        expect(p.push('\n')).toEqual([{ event: 'log', data: 'hello', id: null }])
    })

    it('ignores comment keep-alives and joins multi-line data', () => {
        const p = new SseParser()
        expect(p.push(': keep-alive\n\n')).toEqual([])
        expect(p.push('data: a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb', id: null }])
    })

    it('drops an event that has no data and does not leak fields into the next event', () => {
        const p = new SseParser()
        const out = p.push('event: status\n\nevent: log\ndata: x\n\n')
        expect(out).toEqual([{ event: 'log', data: 'x', id: null }])
    })

    it('keeps the last event id after later events without one', () => {
        const p = new SseParser()
        p.push('id: 5\ndata: a\n\n')
        p.push('data: b\n\n')
        expect(p.lastEventId).toBe('5')
    })
})
