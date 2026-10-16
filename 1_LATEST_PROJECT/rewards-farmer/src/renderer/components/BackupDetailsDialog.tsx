import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { roleDef } from '../../shared/backup-rules'
import type { BackupDetail } from '../../shared/backup-types'
import { shortChecksum, sizeText, statusView, whenText } from '../../shared/backup-ui-rules'
import type { FarmerShellApi } from '../../shared/ipc-types'
import { StateBlock } from './StateBlock'

// Phase 19: "Inspect". Shows the facts of ONE backup (from its manifest) and a fresh check of the files on the disk.
// No file content and no folder path is ever shown. The backup id goes to main, which checks it itself.

interface Props {
    readonly api: FarmerShellApi
    // null = closed.
    readonly backupId: string | null
    readonly onClose: () => void
}

export function BackupDetailsDialog({ api, backupId, onClose }: Props) {
    const titleId = useId()
    const [detail, setDetail] = useState<BackupDetail | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const latest = useRef(0)

    const load = useCallback(
        (id: string) => {
            const ticket = ++latest.current
            setLoading(true)
            setError(null)
            api.inspectBackup(id).then(
                (r) => {
                    if (ticket !== latest.current) return
                    if (r.ok) setDetail(r.detail)
                    else {
                        setDetail(null)
                        setError(r.message)
                    }
                    setLoading(false)
                },
                (e: unknown) => {
                    if (ticket !== latest.current) return
                    setDetail(null)
                    setError(
                        e instanceof Error
                            ? `The backup could not be checked (${e.message}).`
                            : 'The backup could not be checked.'
                    )
                    setLoading(false)
                }
            )
        },
        [api]
    )

    useEffect(() => {
        if (backupId === null) {
            latest.current++
            setDetail(null)
            setError(null)
            return
        }
        load(backupId)
    }, [backupId, load])

    const status = detail === null ? null : statusView(detail.verification)

    return (
        <Dialog open={backupId !== null} onClose={onClose} aria-labelledby={titleId} maxWidth="md" fullWidth>
            <DialogTitle id={titleId}>Backup details</DialogTitle>
            <DialogContent dividers>
                {loading && detail === null && (
                    <StateBlock state="loading" message="Checking this backup..." />
                )}
                {error !== null && (
                    <Alert
                        severity="error"
                        sx={{ overflowWrap: 'anywhere' }}
                        data-testid="backup-detail-error"
                    >
                        {error}
                    </Alert>
                )}
                {detail !== null && status !== null && (
                    <Box data-testid="backup-detail">
                        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                            {detail.id}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {`Made ${whenText(detail.createdAt)} by app version ${detail.appVersion} (${detail.platform}). ${sizeText(detail.totalBytes)} in ${String(detail.files.length)} file(s).${detail.accountCount === null ? '' : ` ${String(detail.accountCount)} account(s) in the saved accounts file.`}`}
                        </Typography>
                        <Alert
                            severity={status.tone}
                            role="status"
                            sx={{ my: 1.5 }}
                            data-testid="backup-detail-check"
                        >
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {status.label}
                            </Typography>
                            <Typography variant="body2">
                                {detail.verification.status === 'ok'
                                    ? `All ${String(detail.verification.filesChecked)} file(s) are present and every size and SHA-256 checksum matches the manifest. Checked ${whenText(detail.verification.checkedAt)}.`
                                    : 'This backup is not what it was when it was made. Do not use it to restore.'}
                            </Typography>
                            {detail.verification.problems.map((p, i) => (
                                <Typography
                                    key={`${p.kind}-${String(i)}`}
                                    variant="body2"
                                    sx={{ overflowWrap: 'anywhere' }}
                                >
                                    {`• ${p.text}`}
                                </Typography>
                            ))}
                            {detail.verification.notes.map((n, i) => (
                                <Typography key={`note-${String(i)}`} variant="body2" color="text.secondary">
                                    {n}
                                </Typography>
                            ))}
                        </Alert>
                        <Typography variant="subtitle2" component="h3" sx={{ mt: 1 }}>
                            Files in this backup
                        </Typography>
                        {detail.files.map((f) => (
                            <Box
                                key={f.role}
                                data-testid={`backup-file-${f.role}`}
                                sx={{
                                    display: 'flex',
                                    gap: 1.5,
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    py: 0.75
                                }}
                            >
                                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 220 }}>
                                    {roleDef(f.role).label}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {`${f.name}, ${sizeText(f.sizeBytes)}, SHA-256 ${shortChecksum(f.sha256)}`}
                                </Typography>
                                {f.containsSecrets && (
                                    <Chip size="small" variant="outlined" label="Holds secrets" />
                                )}
                            </Box>
                        ))}
                        {detail.skipped.length > 0 && (
                            <>
                                <Typography variant="subtitle2" component="h3" sx={{ mt: 1.5 }}>
                                    Not in this backup
                                </Typography>
                                {detail.skipped.map((s) => (
                                    <Typography key={s.role} variant="body2" color="text.secondary">
                                        {s.reason}
                                    </Typography>
                                ))}
                            </>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={() => backupId !== null && load(backupId)}
                    disabled={loading || backupId === null}
                >
                    {loading ? 'Checking...' : 'Check again'}
                </Button>
                <Button onClick={onClose} variant="contained">
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    )
}
