import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type NoticeSeverity = 'info' | 'success' | 'warning' | 'error'

interface Notice {
    readonly id: number
    readonly message: string
    readonly severity: NoticeSeverity
}

interface NotifyApi {
    notify(message: string, severity?: NoticeSeverity): void
}

const NotifyContext = createContext<NotifyApi | null>(null)

export function NotificationProvider({ children }: { readonly children: ReactNode }) {
    const [notice, setNotice] = useState<Notice | null>(null)

    const notify = useCallback((message: string, severity: NoticeSeverity = 'info') => {
        setNotice({ id: Date.now(), message, severity })
    }, [])
    const api = useMemo<NotifyApi>(() => ({ notify }), [notify])

    return (
        <NotifyContext.Provider value={api}>
            {children}
            <Snackbar
                key={notice?.id}
                open={notice !== null}
                autoHideDuration={5000}
                onClose={(_e, reason) => {
                    if (reason !== 'clickaway') setNotice(null)
                }}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                {notice === null ? undefined : (
                    <Alert severity={notice.severity} variant="filled" onClose={() => setNotice(null)}>
                        {notice.message}
                    </Alert>
                )}
            </Snackbar>
        </NotifyContext.Provider>
    )
}

export function useNotify(): NotifyApi {
    const ctx = useContext(NotifyContext)
    if (ctx === null) throw new Error('useNotify must be used inside <NotificationProvider>')
    return ctx
}
