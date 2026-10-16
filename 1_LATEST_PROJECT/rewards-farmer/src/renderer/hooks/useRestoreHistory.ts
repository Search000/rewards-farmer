import { useCallback, useEffect, useRef, useState } from 'react'
import type { FarmerShellApi } from '../../shared/ipc-types'
import type { RestoreHistory } from '../../shared/restore-types'
import { historyBridgeFailureText } from '../../shared/restore-ui-rules'

export interface RestoreHistoryHook {
    // null until the first answer from the main process.
    readonly history: RestoreHistory | null
    readonly error: string | null
    readonly reload: () => void
}

// Phase 21: reads the record of the last restore (read-only) when the page opens and when asked. An interrupted restore from
// an earlier session is found here, because the record is on the disk.
export function useRestoreHistory(api: FarmerShellApi | null): RestoreHistoryHook {
    const [history, setHistory] = useState<RestoreHistory | null>(null)
    const [error, setError] = useState<string | null>(null)
    const latest = useRef(0)

    const reload = useCallback(() => {
        if (api === null) return
        const ticket = ++latest.current
        api.getRestoreHistory().then(
            (h) => {
                if (ticket !== latest.current) return
                setHistory(h)
                setError(null)
            },
            (e: unknown) => {
                if (ticket !== latest.current) return
                setError(historyBridgeFailureText(e instanceof Error ? e.message : null))
            }
        )
    }, [api])

    useEffect(() => {
        reload()
    }, [reload])

    return { history, error, reload }
}
