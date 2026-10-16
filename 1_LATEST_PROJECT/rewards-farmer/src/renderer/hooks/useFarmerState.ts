import { useCallback, useEffect, useState } from 'react'
import type { FarmerState } from '../../shared/farmer-types'
import type { FarmerShellApi } from '../../shared/ipc-types'

export interface FarmerStateHook {
    // null until the first answer from the main process.
    readonly state: FarmerState | null
    // true when the page runs outside Electron (no preload bridge): there is no engine to talk to. Not an error to hide.
    readonly bridgeMissing: boolean
    readonly error: string | null
    readonly api: FarmerShellApi | null
    readonly reload: () => void
}

// Loads the Home state from the main process and keeps it live through the push channel. No data is invented here.
export function useFarmerState(): FarmerStateHook {
    const api = typeof window === 'undefined' ? null : (window.farmerShell ?? null)
    const [state, setState] = useState<FarmerState | null>(null)
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(() => {
        if (api === null) return
        api.getFarmerState().then(
            (s) => {
                setState(s)
                setError(null)
            },
            (e: unknown) => setError(e instanceof Error ? e.message : 'Could not read the app state.')
        )
    }, [api])

    useEffect(() => {
        if (api === null) return undefined
        reload()
        return api.onFarmerState((s) => {
            setState(s)
            setError(null)
        })
    }, [api, reload])

    return { state, bridgeMissing: api === null, error, api, reload }
}
