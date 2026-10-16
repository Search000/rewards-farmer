import { isValidTime } from '../shared/farmer-types'

// App-side timer (decision D5, docs/architecture.md section 7). Works only while the app is open.
// A time that passed while the PC slept is NOT started late and silently: it is reported as missed.

export const MISSED_GRACE_MS = 5 * 60 * 1000

export interface FireInfo {
    readonly scheduledFor: string
}
export interface MissedInfo extends FireInfo {
    readonly lateByMs: number
}

export interface SchedulerOptions {
    readonly onFire: (info: FireInfo) => void
    readonly onMissed: (info: MissedInfo) => void
    readonly now?: () => number
    readonly tickMs?: number
}

// Next local occurrence of HH:MM strictly after `afterMs`.
export function nextOccurrence(afterMs: number, time: string): number {
    const [hh, mm] = time.split(':').map(Number) as [number, number]
    const d = new Date(afterMs)
    d.setHours(hh, mm, 0, 0)
    if (d.getTime() <= afterMs) d.setDate(d.getDate() + 1) // setDate keeps local time across DST changes
    return d.getTime()
}

export class Scheduler {
    private enabled = false
    private time = '00:00'
    private nextFire: number | null = null
    private timer: NodeJS.Timeout | null = null
    private readonly now: () => number
    private readonly tickMs: number

    constructor(private readonly options: SchedulerOptions) {
        this.now = options.now ?? Date.now
        this.tickMs = options.tickMs ?? 1000
    }

    configure(enabled: boolean, time: string): void {
        if (!isValidTime(time)) throw new RangeError(`Invalid time: ${time}`)
        this.clearTimer()
        this.enabled = enabled
        this.time = time
        this.nextFire = enabled ? nextOccurrence(this.now(), time) : null
        if (enabled) {
            this.timer = setInterval(() => this.tick(), this.tickMs)
            this.timer.unref()
        }
    }

    state(): { enabled: boolean; time: string; nextFireAt: string | null } {
        return {
            enabled: this.enabled,
            time: this.time,
            nextFireAt: this.nextFire === null ? null : new Date(this.nextFire).toISOString()
        }
    }

    private tick(): void {
        if (this.nextFire === null) return
        const now = this.now()
        if (now < this.nextFire) return
        const scheduled = this.nextFire
        const info = { scheduledFor: new Date(scheduled).toISOString() }
        this.nextFire = nextOccurrence(now, this.time) // repeats daily while the toggle stays on
        const lateByMs = now - scheduled
        if (lateByMs > MISSED_GRACE_MS) this.options.onMissed({ ...info, lateByMs })
        else this.options.onFire(info)
    }

    private clearTimer(): void {
        if (this.timer !== null) clearInterval(this.timer)
        this.timer = null
    }

    dispose(): void {
        this.clearTimer()
        this.nextFire = null
    }
}
