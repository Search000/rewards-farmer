import { useCallback, useEffect, useRef, useState } from 'react'
import type { FarmerShellApi } from '../../shared/ipc-types'
import { RECHECK_DEBOUNCE_MS, RECHECK_MIN_GAP_MS, recheckKey } from '../../shared/health-rules'
import type { HealthState } from '../../shared/health-types'
import type { FarmerStateHook } from './useFarmerState'

export interface HealthHook {
    // null until the first run has finished.
    readonly state: HealthState | null
    readonly loading: boolean
    readonly bridgeMissing: boolean
    readonly error: string | null
    readonly api: FarmerShellApi | null
    // Manual "Re-run checks". Does nothing while a run is already going.
    readonly rerun: () => void
}

// The checks run in the main process (commands, files, disk, network, engine API).
// They run: (1) when the Health page opens, (2) when the user presses "Re-run checks", and (3) by themselves, but only while
// this page is open, when something they look at changed: the engine process or the accounts file, the network going
// up or down, or the window coming back to the front. Automatic runs wait for a quiet moment (debounce) and are never closer
// together than RECHECK_MIN_GAP_MS, so a burst of events cannot cause a loop or hammer the machine.
export function useHealth(farmer: FarmerStateHook): HealthHook {
    const { api } = farmer
    const [state, setState] = useState<HealthState | null>(null)
    const [loading, setLoading] = useState(api !== null)
    const [error, setError] = useState<string | null>(null)
    const latest = useRef(0)
    const running = useRef(false)
    const lastFinished = useRef(0)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const run = useCallback(() => {
        if (api === null || running.current) return
        running.current = true
        const ticket = ++latest.current
        setLoading(true)
        api.runHealthChecks().then(
            (s) => {
                running.current = false
                lastFinished.current = Date.now()
                if (ticket !== latest.current) return
                setState(s)
                setError(null)
                setLoading(false)
            },
            (e: unknown) => {
                running.current = false
                lastFinished.current = Date.now()
                if (ticket !== latest.current) return
                setError(e instanceof Error ? e.message : 'The health checks could not run.')
                setLoading(false)
            }
        )
    }, [api])

    // An automatic trigger: wait for quiet, then run if the last run is not too recent.
    const scheduleAuto = useCallback(
        (delay: number) => {
            if (timer.current !== null) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
                timer.current = null
                const since = Date.now() - lastFinished.current
                if (since < RECHECK_MIN_GAP_MS) {
                    scheduleAuto(RECHECK_MIN_GAP_MS - since)
                    return
                }
                run()
            }, delay)
        },
        [run]
    )

    // (1) first run on open
    useEffect(() => {
        run()
        return () => {
            // Ignore an answer that arrives after the page was closed.
            latest.current += 1
            running.current = false
            if (timer.current !== null) clearTimeout(timer.current)
            timer.current = null
        }
    }, [run])

    // (3a) engine process or accounts file changed
    const key = farmer.state === null ? null : recheckKey(farmer.state)
    const previousKey = useRef<string | null>(key)
    useEffect(() => {
        if (key === null || key === previousKey.current) {
            previousKey.current = key
            return
        }
        // The first value arriving after an empty start is not a change.
        const wasEmpty = previousKey.current === null
        previousKey.current = key
        if (!wasEmpty) scheduleAuto(RECHECK_DEBOUNCE_MS)
    }, [key, scheduleAuto])

    // (3b) network goes up or down, (3c) window comes back to the front
    useEffect(() => {
        if (api === null) return undefined
        const onNet = (): void => scheduleAuto(RECHECK_DEBOUNCE_MS)
        const onFocus = (): void => {
            if (Date.now() - lastFinished.current >= RECHECK_MIN_GAP_MS * 3) scheduleAuto(RECHECK_DEBOUNCE_MS)
        }
        window.addEventListener('online', onNet)
        window.addEventListener('offline', onNet)
        window.addEventListener('focus', onFocus)
        return () => {
            window.removeEventListener('online', onNet)
            window.removeEventListener('offline', onNet)
            window.removeEventListener('focus', onFocus)
        }
    }, [api, scheduleAuto])

    return { state, loading, bridgeMissing: api === null, error, api, rerun: run }
}
