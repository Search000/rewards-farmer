import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineSettingsState } from '../../shared/engine-settings-types'
import type { FarmerShellApi } from '../../shared/ipc-types'
import type { FarmerStateHook } from './useFarmerState'

export interface EngineSettingsHook {
    // null until the first answer from the main process.
    readonly state: EngineSettingsState | null
    // true when the page runs outside Electron: there is no config to read. Not an error to hide.
    readonly bridgeMissing: boolean
    readonly error: string | null
    readonly api: FarmerShellApi | null
    readonly reload: () => void
}

// Reads the real engine settings from the main process (which asks the engine API). Nothing is cached or invented.
// It is read again when the engine link or the run phase changes (edits are blocked during a run).
export function useEngineSettings(farmer: FarmerStateHook): EngineSettingsHook {
    const { api, state: farmerState } = farmer
    const [state, setState] = useState<EngineSettingsState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const latest = useRef(0)

    const key = farmerState === null ? 'none' : [farmerState.run.phase, farmerState.engine.link].join('|')

    const reload = useCallback(() => {
        if (api === null) return
        const ticket = ++latest.current
        api.getEngineSettingsState().then(
            (s) => {
                if (ticket !== latest.current) return
                setState(s)
                setError(null)
            },
            (e: unknown) => {
                if (ticket !== latest.current) return
                setError(e instanceof Error ? e.message : 'Could not read the settings.')
            }
        )
    }, [api])

    useEffect(() => {
        reload()
    }, [reload, key])

    return { state, bridgeMissing: api === null, error, api, reload }
}
