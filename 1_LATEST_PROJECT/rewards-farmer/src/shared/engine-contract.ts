// Single source of truth for which engine control-API routes the app may call.
// Mirrors docs/integration-contract.md. Do not add a route here that the engine README does not document.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface EngineRoute {
    readonly method: HttpMethod
    readonly path: string
}

export const ALLOWED_ENGINE_ROUTES: readonly EngineRoute[] = [
    { method: 'GET', path: '/health' },
    { method: 'GET', path: '/status' },
    { method: 'GET', path: '/points' },
    { method: 'GET', path: '/logs' },
    { method: 'GET', path: '/events' },
    { method: 'GET', path: '/errors' },
    { method: 'GET', path: '/history' },
    { method: 'GET', path: '/accounts' },
    { method: 'GET', path: '/sessions' },
    { method: 'DELETE', path: '/sessions/:email' },
    { method: 'GET', path: '/diagnostics' },
    { method: 'GET', path: '/config' },
    { method: 'PATCH', path: '/config' },
    { method: 'PUT', path: '/config' },
    { method: 'POST', path: '/start' },
    { method: 'POST', path: '/stop' },
    { method: 'POST', path: '/restart' },
    { method: 'POST', path: '/shutdown' }
]

// Routes the app must never call (decided in Phase 3).
export const FORBIDDEN_ENGINE_PATHS: readonly string[] = ['/schedule']

export function isAllowedRoute(method: HttpMethod, path: string): boolean {
    return ALLOWED_ENGINE_ROUTES.some((r) => r.method === method && r.path === path)
}
