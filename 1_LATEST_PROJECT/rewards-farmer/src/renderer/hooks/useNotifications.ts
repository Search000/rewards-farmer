import { useCallback, useEffect, useRef, useState } from 'react'
import type { FarmerShellApi } from '../../shared/ipc-types'
import type { NotificationsState } from '../../shared/notifications-types'
import type { FarmerStateHook } from './useFarmerState'

export interface NotificationsHook {
    // null until the first answer from the main process. Holds on / off and problem texts only, never an address or token.
    readonly state: NotificationsState | null
    readonly loading: boolean
    readonly bridgeMissing: boolean
    readonly error: string | null
    readonly api: FarmerShellApi | null
    readonly reload: () => void
}

// Same pattern as useSecrets: read again when the engine link or the run phase changes. Reading sends nothing anywhere.
export function useNotifications(farmer: FarmerStateHook): NotificationsHook {
    const { api, state: farmerState } = farmer
    const [state, setState] = useState<NotificationsState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const latest = useRef(0)

    const key = farmerState === null ? 'none' : [farmerState.run.phase, farmerState.engine.link].join('|')

    const reload = useCallback(() => {
        if (api === null) return
        const ticket = ++latest.current
        setLoading(true)
        api.getNotificationsState().then(
            (s) => {
                if (ticket !== latest.current) return
                setState(s)
                setError(null)
                setLoading(false)
            },
            (e: unknown) => {
                if (ticket !== latest.current) return
                setError(e instanceof Error ? e.message : 'Could not read the notification settings.')
                setLoading(false)
            }
        )
    }, [api])

    useEffect(() => {
        reload()
    }, [reload, key])

    return { state, loading, bridgeMissing: api === null, error, api, reload }
}

// Real "is this computer online" signal of the window. It only decides whether a hint is shown: a test still runs and
// reports the real result, because this flag can be wrong (for example behind some VPNs).
export function useOnline(): boolean {
    const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
    useEffect(() => {
        const up = () => setOnline(true)
        const down = () => setOnline(false)
        window.addEventListener('online', up)
        window.addEventListener('offline', down)
        return () => {
            window.removeEventListener('online', up)
            window.removeEventListener('offline', down)
        }
    }, [])
    return online
}
