export type RouteId =
    | 'home'
    | 'accounts'
    | 'parallel'
    | 'secrets'
    | 'notifications'
    | 'logs'
    | 'health'
    | 'backups'
    | 'setup'
    | 'settings'
    | 'about'
    | 'design-system'

export interface RouteDef {
    readonly id: RouteId
    readonly label: string
    readonly inSidebar: boolean
    // Phase that implements the real page; null = no reference screenshot, scope not decided.
    readonly implementedInPhase: number | null
}

// Sidebar order and labels come from screenshot 1 (7 items). 'design-system' is a development-only page.
export const ROUTES: readonly RouteDef[] = [
    { id: 'home', label: 'Home', inSidebar: true, implementedInPhase: 6 },
    { id: 'accounts', label: 'Accounts', inSidebar: true, implementedInPhase: 7 },
    { id: 'parallel', label: 'Parallel farming', inSidebar: true, implementedInPhase: null },
    // Replaces the Telegram and Discord items of screenshot 1 (user decision, Phase 11 follow-up): the notification
    // tokens (Discord, Telegram, ntfy, PushPlus, ServerChan) and the search API key now live on this one page.
    { id: 'secrets', label: 'Secrets & API keys', inSidebar: true, implementedInPhase: 10 },
    // Not in the reference screenshots. Added in Phase 17 (master prompt: notification settings UI). Placement right
    // after Secrets & API keys, where the tokens are saved, is a user decision.
    { id: 'notifications', label: 'Notifications', inSidebar: true, implementedInPhase: 17 },
    // Not in the reference screenshots. Added in Phase 11 because the master prompt requires a log view.
    { id: 'logs', label: 'Logs', inSidebar: true, implementedInPhase: 11 },
    // Not in the reference screenshots. Added in Phase 12 (master prompt: health panel). Placement is a user decision.
    { id: 'health', label: 'Health', inSidebar: true, implementedInPhase: 12 },
    // Not in the reference screenshots. Added in Phase 19 (master prompt: backup UI). Placement after Health is a user decision.
    { id: 'backups', label: 'Backups', inSidebar: true, implementedInPhase: 19 },
    { id: 'settings', label: 'Settings', inSidebar: true, implementedInPhase: 8 },
    { id: 'about', label: 'About', inSidebar: true, implementedInPhase: null },
    // Not in the reference screenshots. Added in Phase 22 (master prompt: first-run setup wizard). Opened by itself at the first
    // start; not in the sidebar (re-running it by hand is Phase 23).
    { id: 'setup', label: 'Setup wizard', inSidebar: false, implementedInPhase: 22 },
    { id: 'design-system', label: 'Design system', inSidebar: false, implementedInPhase: null }
]

export const DEFAULT_ROUTE: RouteId = 'home'

// Old bookmarks and hashes: the Telegram and Discord pages were merged into the Secrets & API keys page.
const LEGACY_ROUTES: Readonly<Record<string, RouteId>> = { telegram: 'secrets', discord: 'secrets' }

export function parseRoute(hash: string): RouteId {
    const id = hash.replace(/^#\/?/, '')
    const legacy = LEGACY_ROUTES[id]
    if (legacy !== undefined) return legacy
    const found = ROUTES.find((r) => r.id === id)
    return found ? found.id : DEFAULT_ROUTE
}

export function routeHash(id: RouteId): string {
    return `#/${id}`
}
