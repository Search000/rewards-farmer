import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { EXPORT_CANCELLED_MESSAGE } from '../../shared/diagnostics-types'
import type { FarmerShellApi } from '../../shared/ipc-types'
import { ActionButton } from './ActionButton'

// Phase 14: "Export diagnostics". One real action: main shows the save window, builds the cleaned ZIP, checks it for secrets and
// writes it. The result (saved, or the exact reason it was not) stays on screen until the next export, because a long message
// in a pop-up that disappears after 5 seconds is easy to miss.

interface Outcome {
    readonly ok: boolean
    readonly message: string
}

export function DiagnosticsCard({ api }: { readonly api: FarmerShellApi }) {
    const [busy, setBusy] = useState(false)
    const [outcome, setOutcome] = useState<Outcome | null>(null)

    const run = async (): Promise<void> => {
        setBusy(true)
        try {
            const r = await api.exportDiagnostics()
            // A closed save window is not an error and not worth a message.
            setOutcome(
                !r.ok && r.message === EXPORT_CANCELLED_MESSAGE ? null : { ok: r.ok, message: r.message }
            )
        } catch (e: unknown) {
            setOutcome({
                ok: false,
                message: e instanceof Error ? `The export failed (${e.message}).` : 'The export failed.'
            })
        } finally {
            setBusy(false)
        }
    }

    return (
        <Box component="section" aria-label="Diagnostics bundle" sx={{ mt: 3, px: 1 }}>
            <Typography variant="subtitle1" component="h2">
                Diagnostics bundle
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
                Saves one ZIP file that you can send to a person who helps you with a problem. It holds the
                versions, your engine settings with every secret hidden, the results of the checks above and
                the newest lines of the app, engine and error logs. Passwords, tokens, cookies, sessions,
                e-mail addresses and IP addresses are not in it, and the app refuses to save the file if its
                safety check finds anything secret. You choose where it is saved.
            </Typography>
            <ActionButton
                label={busy ? 'Exporting...' : 'Export diagnostics'}
                variant="text"
                busy={busy}
                onClick={() => void run()}
            />
            {outcome !== null && (
                <Alert
                    severity={outcome.ok ? 'success' : 'error'}
                    role={outcome.ok ? 'status' : 'alert'}
                    sx={{ mt: 1.5, overflowWrap: 'anywhere' }}
                    data-testid="diagnostics-result"
                >
                    {outcome.message}
                </Alert>
            )}
        </Box>
    )
}
