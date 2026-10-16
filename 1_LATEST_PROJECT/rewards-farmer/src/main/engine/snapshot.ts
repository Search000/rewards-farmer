import type {
    AccountsResponse,
    HistoryResponse,
    LogEntry,
    LogsResponse,
    PointsResponse,
    StatusResponse
} from './apiClient'
import type { RunPhase } from '../../shared/farmer-types'

// Pure mapping from engine API answers to the numbers on the Home screen (docs/requirements-matrix.md B2).
// Anything the engine does not say stays null; the UI prints "-" / "unknown". Nothing is invented.

export function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function parsePhase(state: unknown): RunPhase {
    return state === 'idle' || state === 'starting' || state === 'running' || state === 'stopping' ? state : 'unknown'
}

export interface HomeNumbers {
    readonly account: string | null
    readonly points: number | null
    readonly proxy: string | null
    readonly all: number | null
    readonly finished: number | null
    readonly failed: number | null
}

export interface HomeInput {
    readonly points: PointsResponse | null
    readonly accounts: AccountsResponse | null
    readonly history: HistoryResponse | null
}

export function proxyLabel(accounts: AccountsResponse | null, email: string | null): string | null {
    if (accounts === null || email === null) return null
    const found = accounts.accounts?.find((a) => a.email === email)
    const url = asString(found?.proxy?.url)
    if (url === null) return null
    const port = found?.proxy?.port
    const p = typeof port === 'number' || (typeof port === 'string' && port !== '' && port !== '0') ? String(port) : null
    // The API already strips credentials (README GET /accounts); we show only url[:port].
    return p === null || url.includes(`:${p}`) ? url : `${url}:${p}`
}

export function buildHomeNumbers(input: HomeInput): HomeNumbers {
    const { points, accounts, history } = input
    const account = asString(points?.currentAccount)
    const configured = accounts === null ? null : (asNumber(accounts.count) ?? accounts.accounts?.length ?? null)

    let finished: number | null = null
    let failed: number | null = null
    const live = points?.accounts ?? []
    if (live.length > 0) {
        finished = live.filter((a) => a.done === true && a.success === true).length
        failed = live.filter((a) => a.done === true && a.success === false).length
    } else {
        const last = history?.runs?.[0]
        if (last?.accounts !== undefined) {
            finished = last.accounts.filter((a) => a.success === true).length
            failed = last.accounts.filter((a) => a.success === false).length
        } else if (points !== null && history !== null) {
            // Engine reachable, no run in this engine session yet: zero is a true statement.
            finished = 0
            failed = 0
        }
    }

    return {
        account,
        points: asNumber(points?.balance),
        proxy: proxyLabel(accounts, account),
        all: configured,
        finished,
        failed
    }
}

const MAX_DETAIL = 120

// Section/Detail = the newest engine log line that came from the bot (not the API controller).
export function latestActivity(logs: LogsResponse | null, redact: (s: string) => string): { section: string | null; detail: string | null } {
    const entries: readonly LogEntry[] = logs?.logs ?? []
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        const e = entries[i]
        if (e === undefined || e.source === 'controller') continue
        const section = asString(e.title)
        const message = asString(e.message)
        if (section === null && message === null) continue
        const detail = message === null ? null : redact(message.length > MAX_DETAIL ? `${message.slice(0, MAX_DETAIL)}...` : message)
        return { section: section === null ? null : redact(section), detail }
    }
    return { section: null, detail: null }
}

export function statusLastExit(status: StatusResponse | null): { code: number | null; signal: string | null; at: string; error?: string } | null {
    const e = status?.lastExit
    if (e === null || e === undefined) return null
    const at = asString(e.at)
    if (at === null) return null
    const error = asString(e.error)
    return { code: asNumber(e.code), signal: asString(e.signal), at, ...(error === null ? {} : { error }) }
}
