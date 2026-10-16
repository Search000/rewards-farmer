import { useCallback, useEffect, useRef, useState } from 'react'
import type { FarmerShellApi } from '../../shared/ipc-types'
import type { LogsState } from '../../shared/logs-types'
import type { FarmerStateHook } from './useFarmerState'

export interface LogsHook {
    // null until the first answer from the main process.
    readonly state: LogsState | null
    readonly bridgeMissing: boolean
    readonly error: string | null
    readonly api: FarmerShellApi | null
    readonly reload: () => void
}

// The main process owns the log buffer. This screen asks for it again every second while it is open (no push channel,
// so nothing runs when another page is shown).
export function useLogs(farmer: FarmerStateHook, intervalMs = 1000): LogsHook {
    const { api } = farmer
    const [state, setState] = useState<LogsState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const latest = useRef(0)

    const reload = useCallback(() => {
        if (api === null) return
        const ticket = ++latest.current
        api.getLogsState().then(
            (s) => {
                if (ticket !== latest.current) return
                setState(s)
                setError(null)
            },
            (e: unknown) => {
                if (ticket !== latest.current) return
                setError(e instanceof Error ? e.message : 'Could not read the logs.')
            }
        )
    }, [api])

    useEffect(() => {
        reload()
        const timer = setInterval(reload, intervalMs)
        return () => clearInterval(timer)
    }, [reload, intervalMs])

    return { state, bridgeMissing: api === null, error, api, reload }
}
