import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'

export type BlockState = 'loading' | 'error' | 'empty' | 'unavailable' | 'not-connected'

interface Props {
    readonly state: BlockState
    readonly message: string
    readonly detail?: string | undefined
    readonly retryLabel?: string | undefined
    readonly onRetry?: (() => void) | undefined
}

// One component for the truthful non-data states required by rules 3, 6, 7 and 17.
export function StateBlock({ state, message, detail, retryLabel = 'Retry', onRetry }: Props) {
    const live = state === 'error' ? 'alert' : 'status'
    return (
        <Box
            role={live}
            aria-busy={state === 'loading' ? true : undefined}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                py: 3,
                textAlign: 'center'
            }}
        >
            {state === 'loading' && <CircularProgress size={28} aria-label="Loading" />}
            {state === 'error' && <ErrorOutlineIcon color="error" />}
            {(state === 'empty' || state === 'unavailable' || state === 'not-connected') && (
                <InfoOutlinedIcon color="disabled" />
            )}
            <Typography variant="body1">{message}</Typography>
            {detail !== undefined && (
                <Typography variant="body2" color="text.secondary">
                    {detail}
                </Typography>
            )}
            {state === 'error' && onRetry !== undefined && (
                <Button onClick={onRetry} size="small">
                    {retryLabel}
                </Button>
            )}
        </Box>
    )
}
