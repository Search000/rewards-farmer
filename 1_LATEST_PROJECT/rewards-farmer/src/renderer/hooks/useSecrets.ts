import { useCallback, useEffect, useRef, useState } from 'react'
import type { FarmerShellApi } from '../../shared/ipc-types'
import type { SecretsState } from '../../shared/secrets-types'
import type { FarmerStateHook } from './useFarmerState'

export interface SecretsHook {
    // null until the first answer from the main process. Holds set / not set only, never a value.
    readonly state: SecretsState | null
    readonly bridgeMissing: boolean
    readonly error: string | null
    readonly api: FarmerShellApi | null
    readonly reload: () => void
}

// Same pattern as useEngineSettings: read again when the engine link or the run phase changes.
export function useSecrets(farmer: FarmerStateHook): SecretsHook {
    const { api, state: farmerState } = farmer
    const [state, setState] = useState<SecretsState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const latest = useRef(0)

    const key = farmerState === null ? 'none' : [farmerState.run.phase, farmerState.engine.link].join('|')

    const reload = useCallback(() => {
        if (api === null) return
        const ticket = ++latest.current
        api.getSecretsState().then(
            (s) => {
                if (ticket !== latest.current) return
                setState(s)
                setError(null)
            },
            (e: unknown) => {
                if (ticket !== latest.current) return
                setError(e instanceof Error ? e.message : 'Could not check the saved secrets.')
            }
        )
    }, [api])

    useEffect(() => {
        reload()
    }, [reload, key])

    return { state, bridgeMissing: api === null, error, api, reload }
}
