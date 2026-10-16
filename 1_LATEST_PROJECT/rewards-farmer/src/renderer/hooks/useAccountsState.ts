import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountsState } from '../../shared/accounts-types'
import type { FarmerShellApi } from '../../shared/ipc-types'
import type { FarmerStateHook } from './useFarmerState'

export interface AccountsStateHook {
    // null until the first answer from the main process.
    readonly state: AccountsState | null
    // true when the page runs outside Electron: there is no accounts file to read. Not an error to hide.
    readonly bridgeMissing: boolean
    readonly error: string | null
    readonly api: FarmerShellApi | null
    readonly reload: () => void
}

// Reads the account list from the main process (which reads the real accounts `.env` file). Nothing is cached or invented
// here. The list is read again whenever something that can change it changes on the Home state: the chosen file, the
// number of accounts, the run phase (edits are blocked during a run) and the engine link.
export function useAccountsState(farmer: FarmerStateHook): AccountsStateHook {
    const { api, state: farmerState } = farmer
    const [state, setState] = useState<AccountsState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const latest = useRef(0)

    const key =
        farmerState === null
            ? 'none'
            : [
                  farmerState.accounts.path,
                  farmerState.accounts.status,
                  farmerState.accounts.count,
                  farmerState.run.phase,
                  farmerState.engine.link
              ].join('|')

    const reload = useCallback(() => {
        if (api === null) return
        const ticket = ++latest.current
        api.getAccountsState().then(
            (s) => {
                // A newer request is already on its way: ignore this older answer.
                if (ticket !== latest.current) return
                setState(s)
                setError(null)
            },
            (e: unknown) => {
                if (ticket !== latest.current) return
                setError(e instanceof Error ? e.message : 'Could not read the accounts.')
            }
        )
    }, [api])

    useEffect(() => {
        reload()
    }, [reload, key])

    return { state, bridgeMissing: api === null, error, api, reload }
}
