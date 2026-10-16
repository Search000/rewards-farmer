import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

// JSON Lines log writer (docs/architecture.md section 13). One object per line, redacted before it is written.
// A failing disk never crashes the app: the failure is remembered and shown in the UI (`lastError`).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogRecord {
    readonly level: LogLevel
    readonly component: string
    readonly message: string
    readonly action?: string
    readonly result?: string
    readonly corrId?: string
    readonly account?: string
}

// ISO-8601 with the local UTC offset (docs/architecture.md section 13: "UTC offset in every timestamp").
export function localIso(date: Date): string {
    const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0')
    const off = -date.getTimezoneOffset()
    const sign = off >= 0 ? '+' : '-'
    return (
        `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
        `${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
    )
}

export interface RotationOptions {
    // A file that would grow past this size is first renamed to an archive (default 10 MB, docs/architecture.md section 13).
    readonly maxBytes?: number
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

export class JsonlLog {
    private size: number | null = null
    private chain: Promise<void> = Promise.resolve()
    private failure: string | null = null
    private ready = false

    constructor(
        private readonly dir: string,
        private readonly file: string,
        private readonly source: 'app' | 'audit' | 'engine',
        private readonly redact: (text: string) => string,
        private readonly now: () => Date = () => new Date(),
        private readonly rotation: RotationOptions = {}
    ) {}

    get lastError(): string | null {
        return this.failure
    }

    write(record: LogRecord): void {
        const line = {
            ts: localIso(this.now()),
            level: record.level,
            source: this.source,
            component: record.component,
            ...(record.action === undefined ? {} : { action: record.action }),
            ...(record.result === undefined ? {} : { result: record.result }),
            ...(record.account === undefined ? {} : { account: record.account }),
            ...(record.corrId === undefined ? {} : { corrId: record.corrId }),
            message: this.redact(record.message)
        }
        const text = `${this.redact(JSON.stringify(line))}\n`
        this.chain = this.chain.then(async () => {
            try {
                if (!this.ready) {
                    await mkdir(this.dir, { recursive: true })
                    this.ready = true
                }
                await this.rotateIfNeeded(Buffer.byteLength(text))
                await appendFile(join(this.dir, this.file), text, 'utf8')
                this.size = (this.size ?? 0) + Buffer.byteLength(text)
                this.failure = null
            } catch (error) {
                this.failure = error instanceof Error ? error.message : String(error)
            }
        })
    }

    // Rule 10 / architecture section 13: rotation = archive. The full file is renamed (never deleted, never overwritten).
    private async rotateIfNeeded(incoming: number): Promise<void> {
        const path = join(this.dir, this.file)
        if (this.size === null) {
            try {
                this.size = (await stat(path)).size
            } catch {
                this.size = 0
            }
        }
        if (this.size === 0 || this.size + incoming <= (this.rotation.maxBytes ?? DEFAULT_MAX_BYTES)) return
        const stamp = localIso(this.now()).replace(/[:.]/g, '-')
        const dot = this.file.lastIndexOf('.')
        const base = dot === -1 ? this.file : this.file.slice(0, dot)
        const ext = dot === -1 ? '' : this.file.slice(dot)
        let target = join(this.dir, `${base}.${stamp}${ext}`)
        for (let n = 1; n < 100; n++) {
            try {
                await stat(target)
                target = join(this.dir, `${base}.${stamp}-${String(n)}${ext}`)
            } catch {
                break
            }
        }
        await rename(path, target)
        this.size = 0
    }

    // Wait until everything queued so far is on disk (used on quit and in tests).
    flush(): Promise<void> {
        return this.chain
    }
}
