import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackupListResult } from '../../shared/backup-types'
import type { FarmerShellApi } from '../../shared/ipc-types'
import type { FarmerStateHook } from './useFarmerState'

export interface BackupsHook {
    // null until the first answer from the main process.
    readonly list: BackupListResult | null
    readonly loading: boolean
    readonly bridgeMissing: boolean
    readonly error: string | null
    readonly api: FarmerShellApi | null
    readonly reload: () => void
}

// Reads the backup list (with a fresh check of every backup) when the page opens and when asked. Reading changes nothing.
export function useBackups(farmer: FarmerStateHook): BackupsHook {
    const { api } = farmer
    const [list, setList] = useState<BackupListResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(api !== null)
    const latest = useRef(0)

    const reload = useCallback(() => {
        if (api === null) return
        const ticket = ++latest.current
        setLoading(true)
        api.getBackupsState().then(
            (r) => {
                if (ticket !== latest.current) return
                setList(r)
                setError(null)
                setLoading(false)
            },
            (e: unknown) => {
                if (ticket !== latest.current) return
                setError(e instanceof Error ? e.message : 'Could not read the backups.')
                setLoading(false)
            }
        )
    }, [api])

    useEffect(() => {
        reload()
    }, [reload])

    return { list, loading, bridgeMissing: api === null, error, api, reload }
}
