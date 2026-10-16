// Minimal Server-Sent-Events parser (WHATWG "Server-sent events" parsing rules). Feed it text chunks as they arrive;
// it returns the complete events found so far and keeps any partial one for the next chunk.

export interface SseEvent {
    readonly event: string
    readonly data: string
    readonly id: string | null
}

export class SseParser {
    private buffer = ''
    private event = ''
    private data: string[] = []
    private id: string | null = null
    private lastId: string | null = null

    // The id of the last event that carried one (for Last-Event-ID on reconnect).
    get lastEventId(): string | null {
        return this.lastId
    }

    push(chunk: string): SseEvent[] {
        this.buffer += chunk
        const out: SseEvent[] = []
        // Split on any of \r\n, \n, \r. A trailing \r may be the first half of \r\n, so keep it for the next chunk.
        let rest = this.buffer
        let carry = ''
        if (rest.endsWith('\r')) {
            carry = '\r'
            rest = rest.slice(0, -1)
        }
        const parts = rest.split(/\r\n|\n|\r/)
        this.buffer = (parts.pop() ?? '') + carry
        for (const line of parts) this.line(line, out)
        return out
    }

    private line(line: string, out: SseEvent[]): void {
        if (line === '') {
            if (this.data.length > 0) {
                out.push({ event: this.event === '' ? 'message' : this.event, data: this.data.join('\n'), id: this.id })
            }
            this.event = ''
            this.data = []
            this.id = null
            return
        }
        if (line.startsWith(':')) return // comment / keep-alive
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? '' : line.slice(colon + 1)
        if (value.startsWith(' ')) value = value.slice(1)
        if (field === 'event') this.event = value
        else if (field === 'data') this.data.push(value)
        else if (field === 'id' && !value.includes('\0')) {
            this.id = value
            this.lastId = value
        }
    }
}
