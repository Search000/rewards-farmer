import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { actionLabel } from '../../shared/restore-rules'
import {
    CONFIRM_LABEL,
    CONFIRM_TEXT,
    NEVER_DELETES_NOTE,
    RESTORE_INTRO,
    SAFETY_NOTE,
    UNDO_NOTE,
    actionTone,
    applyFailureTitle,
    applyFailureTone,
    bridgeFailureText,
    failureTitle,
    fileFacts,
    filesStateText,
    previewSummary,
    restoreNowView
} from '../../shared/restore-ui-rules'
import { whenText } from '../../shared/backup-ui-rules'
import type {
    RestoreApplyFailure,
    RestoreApplyResult,
    RestoreFailure,
    RestorePrepareResult,
    RestorePreview,
    RestorePreviewResult
} from '../../shared/restore-types'
import type { FarmerShellApi } from '../../shared/ipc-types'
import { StateBlock } from './StateBlock'

// Phases 20 and 21: the Restore window. It checks the backup (read-only), shows what a restore would change, and on request
// saves a safety copy of the current files (Phase 20). Phase 21 adds the last step: the user ticks an explicit confirmation,
// and only then "Restore now" is enabled (disabled with its reason before that, rule 17). The main process checks everything
// again, makes its own fresh safety copy, writes, reads each file back and reports the truth, including where the files stand
// after a failure. The backup id and the confirmation go to main; no path and no file content ever do.
// No file content, no secret and no folder path is ever shown here.

interface Props {
    readonly api: FarmerShellApi
    // null = closed.
    readonly backupId: string | null
    readonly onClose: () => void
    // Phase 21: called once a restore attempt has an answer (done or refused), so the page can read its record again.
    readonly onFinished?: (() => void) | undefined
}

type Prepared = Extract<RestorePrepareResult, { ok: true }>

export function RestoreDialog({ api, backupId, onClose, onFinished }: Props) {
    const titleId = useId()
    const [result, setResult] = useState<RestorePreviewResult | null>(null)
    const [bridgeError, setBridgeError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [preparing, setPreparing] = useState(false)
    const [prepared, setPrepared] = useState<Prepared | null>(null)
    const [prepareFailure, setPrepareFailure] = useState<RestoreFailure | null>(null)
    const [confirmed, setConfirmed] = useState(false)
    const [applying, setApplying] = useState(false)
    const [applied, setApplied] = useState<RestoreApplyResult | null>(null)
    const latest = useRef(0)

    const load = useCallback(
        (id: string) => {
            const ticket = ++latest.current
            setLoading(true)
            setBridgeError(null)
            setPrepared(null)
            setPrepareFailure(null)
            setConfirmed(false)
            setApplied(null)
            api.previewRestore(id).then(
                (r) => {
                    if (ticket !== latest.current) return
                    setResult(r)
                    setLoading(false)
                },
                (e: unknown) => {
                    if (ticket !== latest.current) return
                    setResult(null)
                    setBridgeError(bridgeFailureText(e instanceof Error ? e.message : null))
                    setLoading(false)
                }
            )
        },
        [api]
    )

    useEffect(() => {
        if (backupId === null) {
            latest.current++
            setResult(null)
            setBridgeError(null)
            setPrepared(null)
            setPrepareFailure(null)
            setPreparing(false)
            setConfirmed(false)
            setApplying(false)
            setApplied(null)
            return
        }
        load(backupId)
    }, [backupId, load])

    const prepare = async (): Promise<void> => {
        if (backupId === null || preparing) return
        const ticket = latest.current
        setPreparing(true)
        setPrepareFailure(null)
        try {
            const r = await api.prepareRestore(backupId)
            if (ticket !== latest.current) return
            if (r.ok) {
                setPrepared(r)
                setResult({ ok: true, preview: r.preview })
            } else {
                setPrepareFailure(r)
            }
        } catch (e: unknown) {
            if (ticket !== latest.current) return
            setBridgeError(bridgeFailureText(e instanceof Error ? e.message : null))
        } finally {
            if (ticket === latest.current) setPreparing(false)
        }
    }

    // Phase 21. Sends the id and the confirmation. The ticked box is the only thing that makes `confirmed` true.
    const apply = async (): Promise<void> => {
        if (backupId === null || applying || !confirmed) return
        const ticket = latest.current
        setApplying(true)
        try {
            const r = await api.applyRestore(backupId, true)
            if (ticket !== latest.current) return
            setApplied(r)
        } catch (e: unknown) {
            if (ticket !== latest.current) return
            setBridgeError(
                `The restore could not be started or its answer was lost${e instanceof Error ? ` (${e.message})` : ''}. Open the Backups page: it shows the state of your files and offers Undo if needed.`
            )
        } finally {
            if (ticket === latest.current) setApplying(false)
            onFinished?.()
        }
    }

    const preview: RestorePreview | null = result !== null && result.ok ? result.preview : null
    const refused: RestoreFailure | null = result !== null && !result.ok ? result : null
    const snapshot = prepared?.snapshot ?? null
    const safetyReady = prepared !== null
    const nowView = restoreNowView({ confirmed, applying })
    const refusedApply: RestoreApplyFailure | null = applied !== null && !applied.ok ? applied : null
    const showCheckAgain =
        applied === null || (refusedApply !== null && refusedApply.filesState !== 'needs-undo')

    return (
        <Dialog
            open={backupId !== null}
            onClose={() => {
                if (!applying) onClose()
            }}
            aria-labelledby={titleId}
            maxWidth="md"
            fullWidth
            data-testid="restore-dialog"
        >
            <DialogTitle id={titleId}>Restore a backup</DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" sx={{ pb: 1.5 }}>
                    {RESTORE_INTRO}
                </Typography>
                {loading && result === null && bridgeError === null && (
                    <StateBlock state="loading" message="Checking this backup..." />
                )}
                {bridgeError !== null && (
                    <Alert
                        severity="error"
                        sx={{ overflowWrap: 'anywhere' }}
                        data-testid="restore-bridge-error"
                    >
                        {bridgeError}
                    </Alert>
                )}

                {refused !== null && <FailureAlert failure={refused} testId="restore-refused" />}

                {applying && (
                    <Alert severity="info" role="status" sx={{ mb: 1.5 }} data-testid="restore-applying">
                        Restoring your files now. Do not close the app. This takes a few seconds.
                    </Alert>
                )}

                {applied !== null && applied.ok && (
                    <Box data-testid="restore-done" role="status">
                        <Alert severity="success" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {applied.files.length === 0
                                    ? 'Nothing needed to be restored'
                                    : 'Restore finished and checked'}
                            </Typography>
                            <Typography variant="body2">{applied.message}</Typography>
                        </Alert>
                        {applied.files.map((f) => (
                            <Typography
                                key={f.role}
                                variant="body2"
                                data-testid={`restore-applied-${f.role}`}
                            >
                                {`• ${f.label}: ${f.action === 'created' ? 'created' : 'replaced'} (${String(f.bytes)} bytes, read back and equal to the backup)`}
                            </Typography>
                        ))}
                        {applied.notes.map((n, i) => (
                            <Typography
                                key={`note-${String(i)}`}
                                variant="body2"
                                sx={{ overflowWrap: 'anywhere', pt: 0.5 }}
                                data-testid="restore-note"
                            >
                                {n}
                            </Typography>
                        ))}
                        {applied.undoAvailable && (
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ pt: 1 }}
                                data-testid="restore-undo-note"
                            >
                                {UNDO_NOTE}
                            </Typography>
                        )}
                    </Box>
                )}

                {refusedApply !== null && <ApplyFailureAlert failure={refusedApply} />}

                {preview !== null && applied === null && (
                    <Box data-testid="restore-preview">
                        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                            {preview.backup.id}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {`Made ${whenText(preview.backup.createdAt)} by app version ${preview.backup.appVersion} (${preview.backup.platform}). This backup passed its check just now.`}
                        </Typography>
                        <Typography
                            role="status"
                            variant="body1"
                            sx={{ fontWeight: 600, py: 1.5 }}
                            data-testid="restore-summary"
                        >
                            {previewSummary(preview)}
                        </Typography>

                        {preview.blockers.length > 0 && (
                            <Alert severity="error" sx={{ mb: 1.5 }} data-testid="restore-blockers">
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    Not possible right now
                                </Typography>
                                {preview.blockers.map((b, i) => (
                                    <Typography
                                        key={`b-${String(i)}`}
                                        variant="body2"
                                        sx={{ overflowWrap: 'anywhere' }}
                                    >
                                        {`• ${b}`}
                                    </Typography>
                                ))}
                            </Alert>
                        )}
                        {preview.warnings.length > 0 && (
                            <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="restore-warnings">
                                {preview.warnings.map((w, i) => (
                                    <Typography
                                        key={`w-${String(i)}`}
                                        variant="body2"
                                        sx={{ overflowWrap: 'anywhere' }}
                                    >
                                        {w}
                                    </Typography>
                                ))}
                            </Alert>
                        )}

                        <Typography variant="subtitle2" component="h3">
                            What would happen to each file
                        </Typography>
                        {preview.files.map((f) => (
                            <Box
                                key={f.role}
                                data-testid={`restore-file-${f.role}`}
                                sx={{ py: 1, borderTop: 1, borderColor: 'divider' }}
                            >
                                <Box
                                    sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}
                                >
                                    <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 220 }}>
                                        {f.label}
                                    </Typography>
                                    <Chip
                                        size="small"
                                        variant="outlined"
                                        color={actionTone(f.action)}
                                        label={actionLabel(f.action)}
                                        data-testid={`restore-action-${f.role}`}
                                    />
                                    {f.containsSecrets && (
                                        <Chip size="small" variant="outlined" label="Holds secrets" />
                                    )}
                                </Box>
                                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                    {f.text}
                                </Typography>
                                {fileFacts(f) !== '' && (
                                    <Typography variant="caption" color="text.secondary">
                                        {fileFacts(f)}
                                    </Typography>
                                )}
                            </Box>
                        ))}
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1 }}>
                            {NEVER_DELETES_NOTE}
                        </Typography>

                        <Alert severity="info" sx={{ my: 1.5 }}>
                            {SAFETY_NOTE}
                        </Alert>

                        {prepareFailure !== null && (
                            <FailureAlert failure={prepareFailure} testId="restore-prepare-failed" />
                        )}

                        {prepared !== null && snapshot !== null && (
                            <Alert
                                severity="success"
                                role="status"
                                sx={{ mb: 1.5 }}
                                data-testid="restore-snapshot"
                            >
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {snapshot.status === 'created'
                                        ? 'Safety copy made and checked'
                                        : snapshot.status === 'nothing-to-save'
                                          ? 'No safety copy needed'
                                          : 'Nothing to restore'}
                                </Typography>
                                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                    {prepared.message}
                                </Typography>
                                {snapshot.status === 'created' && snapshot.notSaved.length > 0 && (
                                    <Typography variant="body2" color="text.secondary">
                                        {`Not in the safety copy: ${snapshot.notSaved.map((s) => s.replace(/\.$/, '')).join('; ')}.`}
                                    </Typography>
                                )}
                            </Alert>
                        )}

                        {safetyReady &&
                            snapshot !== null &&
                            snapshot.status !== 'not-needed' &&
                            !applying && (
                                <Box data-testid="restore-confirm-step" sx={{ pt: 0.5 }}>
                                    <Typography variant="subtitle2" component="h3">
                                        Confirmation
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{ py: 0.5 }}
                                        data-testid="restore-confirm-text"
                                    >
                                        {CONFIRM_TEXT}
                                    </Typography>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={confirmed}
                                                onChange={(e) => setConfirmed(e.target.checked)}
                                                disabled={applying}
                                                data-testid="restore-confirm-checkbox"
                                            />
                                        }
                                        label={CONFIRM_LABEL}
                                    />
                                    {nowView.reason !== null && (
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ display: 'block' }}
                                            data-testid="restore-now-reason"
                                        >
                                            {nowView.reason}
                                        </Typography>
                                    )}
                                </Box>
                            )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                {showCheckAgain && (
                    <Button
                        onClick={() => backupId !== null && load(backupId)}
                        disabled={loading || preparing || applying || backupId === null}
                    >
                        {loading ? 'Checking...' : 'Check again'}
                    </Button>
                )}
                {preview !== null && !safetyReady && applied === null && (
                    <Button
                        variant="outlined"
                        onClick={() => void prepare()}
                        disabled={!preview.canContinue || preparing || loading}
                        title={
                            preview.canContinue
                                ? undefined
                                : preview.changeCount === 0
                                  ? 'A restore would change nothing, so no safety copy is needed.'
                                  : 'The restore cannot go on right now (see "Not possible right now").'
                        }
                    >
                        {preparing ? 'Making the safety copy...' : 'Make safety copy'}
                    </Button>
                )}
                {safetyReady && snapshot !== null && snapshot.status !== 'not-needed' && applied === null && (
                    <span title={nowView.reason ?? undefined}>
                        <Button
                            variant="contained"
                            color="warning"
                            disabled={!nowView.enabled}
                            onClick={() => void apply()}
                            data-testid="restore-now"
                        >
                            {applying ? 'Restoring...' : 'Restore now'}
                        </Button>
                    </span>
                )}
                <Button onClick={onClose} variant="contained" disabled={applying}>
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    )
}

function FailureAlert({ failure, testId }: { readonly failure: RestoreFailure; readonly testId: string }) {
    return (
        <Alert severity="error" role="alert" sx={{ mb: 1.5, overflowWrap: 'anywhere' }} data-testid={testId}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {failureTitle(failure)}
            </Typography>
            <Typography variant="body2">{failure.message}</Typography>
            {failure.problems.length > 1 &&
                failure.problems.map((p, i) => (
                    <Typography key={`${p.kind}-${String(i)}`} variant="body2">
                        {`• ${p.text}`}
                    </Typography>
                ))}
            <Typography variant="body2" sx={{ mt: 0.5 }} data-testid={`${testId}-fix`}>
                {`What to do: ${failure.fix}`}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                None of your files was changed.
            </Typography>
        </Alert>
    )
}

// Phase 21: a restore that did not happen or did not finish. It says exactly where the user's files stand.
function ApplyFailureAlert({ failure }: { readonly failure: RestoreApplyFailure }) {
    return (
        <Alert
            severity={applyFailureTone(failure)}
            role="alert"
            sx={{ mb: 1.5, overflowWrap: 'anywhere' }}
            data-testid="restore-apply-failed"
        >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {applyFailureTitle(failure)}
            </Typography>
            <Typography variant="body2">{failure.message}</Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="restore-apply-failed-fix">
                {`What to do: ${failure.fix}`}
            </Typography>
            <Typography
                variant="body2"
                sx={{ mt: 0.5, fontWeight: failure.filesState === 'untouched' ? 400 : 600 }}
                data-testid="restore-apply-files-state"
            >
                {filesStateText(failure.filesState)}
            </Typography>
        </Alert>
    )
}
