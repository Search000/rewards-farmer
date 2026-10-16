import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import { useId } from 'react'

interface Props {
    readonly open: boolean
    readonly title: string
    readonly message: string
    readonly confirmLabel?: string | undefined
    readonly cancelLabel?: string | undefined
    readonly onConfirm: () => void
    readonly onCancel: () => void
}

// Modal used for destructive or irreversible actions (rules 10 and 12). Focus is trapped by MUI Dialog.
export function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel
}: Props) {
    const titleId = useId()
    const textId = useId()
    return (
        <Dialog open={open} onClose={onCancel} aria-labelledby={titleId} aria-describedby={textId}>
            <DialogTitle id={titleId}>{title}</DialogTitle>
            <DialogContent>
                <DialogContentText id={textId}>{message}</DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel}>{cancelLabel}</Button>
                <Button onClick={onConfirm} variant="contained">
                    {confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    )
}
