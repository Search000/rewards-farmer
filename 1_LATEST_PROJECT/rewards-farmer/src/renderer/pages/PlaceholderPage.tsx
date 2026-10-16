import { ROUTES } from '../routes'
import type { RouteId } from '../routes'
import { NotConnected } from '../components/NotConnected'
import { PageCard } from '../components/PageCard'

// Phase 5 stand-in. It shows no data at all, only the truthful development state.
export function PlaceholderPage({ route }: { readonly route: RouteId }) {
    const def = ROUTES.find((r) => r.id === route)
    return (
        <PageCard title={def?.label ?? 'Page'}>
            <NotConnected phase={def?.implementedInPhase ?? null} />
        </PageCard>
    )
}
