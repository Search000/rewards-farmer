import { useCallback, useEffect, useState } from 'react'
import { parseRoute, routeHash } from '../routes'
import type { RouteId } from '../routes'

// Tiny hash router: works under file:// in Electron, supports back/forward, no extra dependency.
export function useHashRoute(): [RouteId, (id: RouteId) => void] {
    const [route, setRoute] = useState<RouteId>(() => parseRoute(window.location.hash))

    useEffect(() => {
        const onChange = () => setRoute(parseRoute(window.location.hash))
        window.addEventListener('hashchange', onChange)
        return () => window.removeEventListener('hashchange', onChange)
    }, [])

    const navigate = useCallback((id: RouteId) => {
        window.location.hash = routeHash(id)
    }, [])

    return [route, navigate]
}
