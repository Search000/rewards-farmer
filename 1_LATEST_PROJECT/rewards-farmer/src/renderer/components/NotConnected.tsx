import Alert from '@mui/material/Alert'

interface Props {
    readonly phase: number | null
}

// Truthful development-only state for Phase 5. Must disappear when the page is really implemented.
export function NotConnected({ phase }: Props) {
    return (
        <Alert severity="info" variant="outlined" role="status">
            {phase === null
                ? 'Development state: no data connected. This page has no reference screenshot yet, so its content is not designed.'
                : `Development state: no data connected. This page is built in Phase ${String(phase)}; Phase 5 only provides the shell.`}
        </Alert>
    )
}
