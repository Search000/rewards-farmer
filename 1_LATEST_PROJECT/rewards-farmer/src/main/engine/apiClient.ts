import { isAllowedRoute } from '../../shared/engine-contract'
import type { HttpMethod } from '../../shared/engine-contract'
import type { ErrorCode } from '../../shared/farmer-types'

// Typed wrapper around the engine control API (docs/integration-contract.md). Only documented routes.
// `args` and `env` are NOT part of any body type here: the contract forbids them (docs/integration-contract.md).

export class AppError extends Error {
    readonly code: ErrorCode
    readonly httpStatus: number | undefined
    readonly retryable: boolean

    constructor(code: ErrorCode, message: string, httpStatus?: number, retryable = false) {
        super(message)
        this.name = 'AppError'
        this.code = code
        this.httpStatus = httpStatus
        this.retryable = retryable
    }
}

export type StartBody = Record<string, never> | { readonly accountIndex: number } | { readonly excludedAccountIndexes: readonly number[] }

// Loose shapes: we read only what we need and treat everything as possibly missing (engine README is the contract).
export interface HealthResponse {
    readonly ok?: boolean
    readonly name?: string
    readonly version?: string
    readonly state?: string
}
export interface StatusResponse {
    readonly state?: string
    readonly pid?: number | null
    readonly startedAt?: string | null
    readonly lastExit?: { code?: number | null; signal?: string | null; at?: string; error?: string } | null
    readonly latestLogId?: number
    readonly version?: string
}
export interface PointsAccount {
    readonly email?: string
    readonly done?: boolean
    readonly success?: boolean | null
}
export interface PointsResponse {
    readonly state?: string
    readonly currentAccount?: string | null
    readonly balance?: number | null
    readonly accountsTotal?: number | null
    readonly accountsSeen?: number | null
    readonly finished?: boolean
    readonly accounts?: readonly PointsAccount[]
}
export interface ConfiguredAccount {
    readonly email?: string
    readonly proxy?: { url?: string; port?: string | number; hasCredentials?: boolean } | null
}
export interface AccountsResponse {
    readonly accounts?: readonly ConfiguredAccount[]
    readonly count?: number
}
export interface HistoryRun {
    readonly accounts?: readonly { success?: boolean | null; error?: unknown }[]
}
export interface HistoryResponse {
    readonly runs?: readonly HistoryRun[]
}
export interface LogEntry {
    readonly id?: number
    readonly receivedAt?: string
    readonly user?: string | null
    readonly level?: string
    readonly title?: string | null
    readonly message?: string
    readonly source?: string
    readonly parsed?: boolean
}
export interface LogsResponse {
    readonly logs?: readonly LogEntry[]
    readonly latestLogId?: number
}
export interface ErrorsResponse {
    readonly errors?: readonly LogEntry[]
}

export interface ConfigResponse {
    // Absolute path of the config.json the engine really uses.
    readonly path?: string
    // true = secret values are replaced by the engine (default; the app never asks for the revealed form).
    readonly redacted?: boolean
    readonly config?: unknown
}

export interface EngineApiOptions {
    readonly baseUrl: string
    readonly token: string
    readonly timeoutMs?: number
    readonly fetchImpl?: typeof fetch
}

export class EngineApi {
    private readonly baseUrl: string
    private readonly token: string
    private readonly timeoutMs: number
    private readonly fetchImpl: typeof fetch

    constructor(options: EngineApiOptions) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '')
        this.token = options.token
        this.timeoutMs = options.timeoutMs ?? 5000
        this.fetchImpl = options.fetchImpl ?? fetch
    }

    health = (): Promise<HealthResponse> => this.call('GET', '/health')
    status = (): Promise<StatusResponse> => this.call('GET', '/status')
    points = (): Promise<PointsResponse> => this.call('GET', '/points')
    accounts = (): Promise<AccountsResponse> => this.call('GET', '/accounts')
    history = (): Promise<HistoryResponse> => this.call('GET', '/history', undefined, '?limit=1')
    logs = (limit: number): Promise<LogsResponse> => this.call('GET', '/logs', undefined, `?limit=${String(limit)}`)
    // Entries newer than `afterId` that are still in the engine's ring buffer (README: GET /logs?afterId=).
    logsAfter = (afterId: number, limit: number): Promise<LogsResponse> =>
        this.call('GET', '/logs', undefined, `?afterId=${String(afterId)}&limit=${String(limit)}`)
    errors = (limit: number): Promise<ErrorsResponse> => this.call('GET', '/errors', undefined, `?limit=${String(limit)}`)
    config = (): Promise<ConfigResponse> => this.call('GET', '/config')
    // Deep merge into config.json. The engine validates with its own validator and answers 422 when it is invalid.
    patchConfig = (body: Record<string, unknown>): Promise<unknown> => this.call('PATCH', '/config', body)
    start = (body: StartBody): Promise<unknown> => this.call('POST', '/start', body)
    stop = (): Promise<unknown> => this.call('POST', '/stop', {})
    shutdown = (): Promise<unknown> => this.call('POST', '/shutdown', {})

    // Opens the live SSE stream (GET /events) and returns the raw response; the caller reads the body. The token goes in the
    // Authorization header, never in the URL. The only timeout is the caller's AbortSignal (a stream has no natural end).
    async openEvents(options: {
        readonly replay?: number
        readonly lastEventId?: number | null
        readonly signal: AbortSignal
    }): Promise<Response> {
        if (!isAllowedRoute('GET', '/events')) throw new AppError('BAD_REQUEST', 'Route not allowed: GET /events')
        const query = options.replay === undefined ? '' : `?replay=${String(options.replay)}`
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.token}`,
            Accept: 'text/event-stream'
        }
        if (options.lastEventId !== undefined && options.lastEventId !== null)
            headers['Last-Event-ID'] = String(options.lastEventId)
        let res: Response
        try {
            res = await this.fetchImpl(`${this.baseUrl}/events${query}`, { method: 'GET', headers, signal: options.signal })
        } catch {
            throw new AppError('ENGINE_DOWN', 'The engine log stream is not reachable.', undefined, true)
        }
        if (!res.ok) {
            const payload: unknown = await res
                .text()
                .then((s) => JSON.parse(s) as unknown)
                .catch(() => null)
            throw mapHttpError(res.status, payload)
        }
        return res
    }

    private async call<T>(method: HttpMethod, path: string, body?: unknown, query = ''): Promise<T> {
        // Defense in depth: the allowed-route table is the single source of truth.
        if (!isAllowedRoute(method, path)) throw new AppError('BAD_REQUEST', `Route not allowed by the integration contract: ${method} ${path}`)

        const init: RequestInit = {
            method,
            headers: {
                Authorization: `Bearer ${this.token}`,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
            },
            signal: AbortSignal.timeout(this.timeoutMs)
        }
        if (body !== undefined) init.body = JSON.stringify(body)

        let res: Response
        try {
            res = await this.fetchImpl(`${this.baseUrl}${path}${query}`, init)
        } catch (error) {
            const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            throw new AppError('ENGINE_DOWN', timedOut ? 'The engine API did not answer in time.' : 'The engine API is not reachable.', undefined, true)
        }

        let payload: unknown = null
        const text = await res.text()
        if (text !== '') {
            try {
                payload = JSON.parse(text) as unknown
            } catch {
                if (res.ok) throw new AppError('ENGINE_ERROR', 'The engine API returned a non-JSON answer.', res.status)
            }
        }
        if (res.ok) return payload as T
        throw mapHttpError(res.status, payload)
    }
}

function engineMessage(payload: unknown): string | undefined {
    if (typeof payload === 'object' && payload !== null && 'error' in payload) {
        const e = (payload as { error?: unknown }).error
        if (typeof e === 'string') return e
    }
    return undefined
}

// docs/architecture.md section 9.
export function mapHttpError(status: number, payload: unknown): AppError {
    const text = engineMessage(payload)
    switch (status) {
        case 400:
            return new AppError('BAD_REQUEST', text ?? 'The engine rejected the request.', status)
        case 401:
            return new AppError('AUTH', 'The engine API refused the token. Restart the engine.', status)
        case 403:
            return new AppError('WRITE_DISABLED', text ?? 'This action is disabled in the engine.', status)
        case 404:
            return new AppError('NOT_FOUND', text ?? 'Route not found in the engine.', status)
        case 409: {
            const code = typeof payload === 'object' && payload !== null ? (payload as { code?: unknown }).code : undefined
            return code === 'NOT_RUNNING'
                ? new AppError('NOT_RUNNING', text ?? 'No run is in progress.', status)
                : new AppError('RUN_ACTIVE', text ?? 'A run is already in progress.', status)
        }
        case 422:
            return new AppError('CONFIG_INVALID', text ?? 'The engine rejected the configuration.', status)
        default:
            return new AppError('ENGINE_ERROR', text ?? `The engine API failed (HTTP ${String(status)}).`, status, status >= 500)
    }
}
