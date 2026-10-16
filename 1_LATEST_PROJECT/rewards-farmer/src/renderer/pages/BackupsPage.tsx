import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import {
    PAGE_FOOTER,
    PAGE_INTRO,
    PAGE_SECURITY_NOTE,
    bridgeFailureView,
    createView,
    listSummary,
    sizeText,
    statusView,
    unfinishedNote,
    whenText
} from '../../shared/backup-ui-rules'
import type { CreateView } from '../../shared/backup-ui-rules'
import type { RestoreUndoResult } from '../../shared/restore-types'
import {
    UNDO_CONFIRM_MESSAGE,
    UNDO_CONFIRM_TITLE,
    filesStateText,
    historyView,
    needsAttention,
    restoreButtonView,
    undoButtonView,
    undoFailureTitle
} from '../../shared/restore-ui-rules'
import { ActionButton } from '../components/ActionButton'
import { BackupDetailsDialog } from '../components/BackupDetailsDialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DisabledReason } from '../components/DisabledReason'
import { RestoreDialog } from '../components/RestoreDialog'
import { useNotify } from '../components/Notifications'
import { PageCard } from '../components/PageCard'
import { StateBlock } from '../components/StateBlock'
import type { FarmerStateHook } from '../hooks/useFarmerState'
import { useBackups } from '../hooks/useBackups'
import { useRestoreHistory } from '../hooks/useRestoreHistory'

// Phase 19: the Backups page. Create (service from Phase 18, now checked after writing), list with a fresh check of every
// backup, inspect, open the folder. Phase 20 adds the Restore window (check, preview, safety copy). Phase 21 adds applying a
// restore in that window and, here, the "Last restore" part: what the record says, and Undo (after an explicit confirmation).
// A restore or an undo that did not finish (found again from the record on the disk) is shown at the top of the page.
// Delete and encryption are NOT here (later phases, or not decided yet).
// The result of a failed backup stays on screen with a "what to do" text (a pop-up that disappears is easy to miss).

export function BackupsPage({ farmer }: { readonly farmer: FarmerStateHook }) {
    const { list, loading, bridgeMissing, error, api, reload } = useBackups(farmer)
    const restoreHistory = useRestoreHistory(api)
    const notify = useNotify()
    const [creating, setCreating] = useState(false)
    const [outcome, setOutcome] = useState<CreateView | null>(null)
    const [inspecting, setInspecting] = useState<string | null>(null)
    const [restoring, setRestoring] = useState<string | null>(null)
    const [askUndo, setAskUndo] = useState(false)
    const [undoing, setUndoing] = useState(false)
    const [undoOutcome, setUndoOutcome] = useState<RestoreUndoResult | null>(null)
    const [undoBridgeError, setUndoBridgeError] = useState<string | null>(null)

    if (bridgeMissing) {
        return (
            <PageCard title="Backups">
                <Alert severity="info">
                    Backups work only inside the desktop app. This page is open outside it, so there are no
                    files to back up.
                </Alert>
            </PageCard>
        )
    }

    const create = async (): Promise<void> => {
        if (api === null || creating) return
        setCreating(true)
        try {
            setOutcome(createView(await api.createBackup()))
        } catch (e: unknown) {
            setOutcome(bridgeFailureView(e instanceof Error ? e.message : null))
        } finally {
            setCreating(false)
            reload()
        }
    }

    // Phase 21. The confirm dialog is the explicit confirmation; `true` is sent only from there.
    const undo = async (): Promise<void> => {
        if (api === null || undoing) return
        setAskUndo(false)
        setUndoing(true)
        setUndoOutcome(null)
        setUndoBridgeError(null)
        try {
            setUndoOutcome(await api.undoRestore(true))
        } catch (e: unknown) {
            setUndoBridgeError(
                `The undo could not be started or its answer was lost${e instanceof Error ? ` (${e.message})` : ''}. Read the record again with Check again: it shows where your files stand.`
            )
        } finally {
            setUndoing(false)
            restoreHistory.reload()
            reload()
        }
    }

    const openFolder = async (): Promise<void> => {
        if (api === null) return
        try {
            const r = await api.openBackupFolder()
            notify.notify(r.message, r.ok ? 'success' : 'error')
        } catch {
            notify.notify('The backup folder could not be opened.', 'error')
        }
    }

    const noBackupFolder = list !== null && list.ok && list.backups.length === 0 && list.unfinishedCount === 0

    return (
        <PageCard title="Backups">
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, pb: 1 }}>
                {PAGE_INTRO}
            </Typography>
            {restoreHistory.history !== null && needsAttention(restoreHistory.history) && (
                <Alert severity="error" role="alert" sx={{ mb: 1.5 }} data-testid="restore-attention">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {historyView(restoreHistory.history.status).title}
                    </Typography>
                    <Typography variant="body2">
                        Your files may be partly restored. Use Undo in "Last restore" below to put everything
                        back.
                    </Typography>
                </Alert>
            )}
            <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="backup-security-note">
                {PAGE_SECURITY_NOTE}
            </Alert>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', pb: 1.5 }}>
                <ActionButton
                    label={creating ? 'Creating and checking...' : 'Create backup'}
                    variant="pill"
                    busy={creating}
                    onClick={() => void create()}
                />
                <Button
                    variant="outlined"
                    size="small"
                    onClick={() => void openFolder()}
                    disabled={noBackupFolder}
                    title={
                        noBackupFolder ? 'There is no backup folder yet. Create a backup first.' : undefined
                    }
                >
                    Open backup folder
                </Button>
                <Button variant="outlined" size="small" onClick={reload} disabled={loading || creating}>
                    {loading ? 'Checking...' : 'Check again'}
                </Button>
            </Box>
            {outcome !== null && (
                <Alert
                    severity={outcome.ok ? 'success' : 'error'}
                    role={outcome.ok ? 'status' : 'alert'}
                    sx={{ mb: 1.5, overflowWrap: 'anywhere' }}
                    data-testid="backup-result"
                >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {outcome.ok ? 'Backup created' : 'No backup was created'}
                    </Typography>
                    <Typography variant="body2">{outcome.message}</Typography>
                    {outcome.fix !== null && (
                        <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="backup-fix">
                            {`What to do: ${outcome.fix}`}
                        </Typography>
                    )}
                    {outcome.notes.map((n, i) => (
                        <Typography key={`n-${String(i)}`} variant="body2">
                            {n}
                        </Typography>
                    ))}
                </Alert>
            )}

            {list === null ? (
                error !== null ? (
                    <StateBlock
                        state="error"
                        message="The backups could not be read."
                        detail={error}
                        retryLabel="Try again"
                        onRetry={reload}
                    />
                ) : (
                    <StateBlock state="loading" message="Reading and checking the backups..." />
                )
            ) : (
                <>
                    {error !== null && (
                        <Alert severity="error" sx={{ mb: 1.5 }}>
                            {`The last check failed (${error}). What you see below is the previous result.`}
                        </Alert>
                    )}
                    {!list.ok ? (
                        <Alert severity="error" data-testid="backup-list-error">
                            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                {list.message ?? 'The backup folder could not be read.'}
                            </Typography>
                            <Typography variant="body2">
                                Check that the drive is connected and not locked, then press Check again.
                            </Typography>
                        </Alert>
                    ) : (
                        <>
                            <Typography
                                role="status"
                                variant="body1"
                                sx={{ fontWeight: 600, px: 1, pb: 1 }}
                                data-testid="backup-summary"
                            >
                                {listSummary(list)}
                            </Typography>
                            {list.backups.length === 0 && (
                                <StateBlock
                                    state="empty"
                                    message="No backups yet."
                                    detail="Press Create backup to make the first one."
                                />
                            )}
                            {list.backups.map((b) => {
                                const st = statusView(b.verification)
                                return (
                                    <Box
                                        key={b.id}
                                        data-testid={`backup-row-${b.id}`}
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 2,
                                            flexWrap: 'wrap',
                                            py: 1.25,
                                            px: 1,
                                            borderTop: 1,
                                            borderColor: 'divider'
                                        }}
                                    >
                                        <Box sx={{ flex: 1, minWidth: 240 }}>
                                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                {whenText(b.createdAt)}
                                            </Typography>
                                            <Typography
                                                variant="body2"
                                                color="text.secondary"
                                                sx={{ overflowWrap: 'anywhere' }}
                                            >
                                                {`App version ${b.appVersion}, ${String(b.fileCount)} file(s), ${sizeText(b.totalBytes)}`}
                                            </Typography>
                                            {b.skipped.map((s) => (
                                                <Typography
                                                    key={s.role}
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{ display: 'block' }}
                                                >
                                                    {`Not included: ${s.reason}`}
                                                </Typography>
                                            ))}
                                        </Box>
                                        <Chip
                                            size="small"
                                            color={st.tone}
                                            variant="outlined"
                                            label={st.label}
                                            data-testid={`backup-status-${b.id}`}
                                        />
                                        <Button
                                            size="small"
                                            variant="text"
                                            aria-label={`Inspect backup from ${whenText(b.createdAt)}`}
                                            onClick={() => setInspecting(b.id)}
                                        >
                                            Inspect
                                        </Button>
                                        <DisabledReason
                                            reason={restoreButtonView(b.verification).reason ?? undefined}
                                        >
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                aria-label={`Restore backup from ${whenText(b.createdAt)}`}
                                                disabled={!restoreButtonView(b.verification).enabled}
                                                onClick={() => setRestoring(b.id)}
                                            >
                                                Restore...
                                            </Button>
                                        </DisabledReason>
                                    </Box>
                                )
                            })}
                            {unfinishedNote(list.unfinishedCount) !== null && (
                                <Alert severity="info" sx={{ mt: 1.5 }} data-testid="backup-unfinished">
                                    {unfinishedNote(list.unfinishedCount)}
                                </Alert>
                            )}
                        </>
                    )}
                </>
            )}
            {restoreHistory.error !== null && (
                <Alert severity="error" sx={{ mt: 1.5 }} data-testid="restore-history-error">
                    {restoreHistory.error}
                </Alert>
            )}
            {restoreHistory.history !== null && historyView(restoreHistory.history.status).visible && (
                <Box
                    data-testid="restore-history"
                    sx={{ mt: 2, pt: 1.5, px: 1, borderTop: 1, borderColor: 'divider' }}
                >
                    <Typography variant="subtitle2" component="h3">
                        Last restore
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', py: 0.5 }}>
                        <Chip
                            size="small"
                            variant="outlined"
                            color={historyView(restoreHistory.history.status).tone}
                            label={historyView(restoreHistory.history.status).title}
                            data-testid="restore-history-status"
                        />
                        {restoreHistory.history.finishedAt !== null && (
                            <Typography variant="caption" color="text.secondary">
                                {`Finished ${whenText(restoreHistory.history.finishedAt)}`}
                            </Typography>
                        )}
                    </Box>
                    <Typography
                        variant="body2"
                        sx={{ overflowWrap: 'anywhere' }}
                        data-testid="restore-history-message"
                    >
                        {restoreHistory.history.message}
                    </Typography>
                    {restoreHistory.history.files.length > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {`Files this restore changed: ${restoreHistory.history.files
                                .map((f) => `${f.label} (${f.action === 'create' ? 'created' : 'replaced'})`)
                                .join(', ')}.`}
                        </Typography>
                    )}
                    {undoButtonView(restoreHistory.history).show && (
                        <Box sx={{ pt: 1 }}>
                            <DisabledReason
                                reason={undoButtonView(restoreHistory.history).reason ?? undefined}
                            >
                                <Button
                                    variant="outlined"
                                    color="warning"
                                    size="small"
                                    disabled={!undoButtonView(restoreHistory.history).enabled || undoing}
                                    onClick={() => setAskUndo(true)}
                                    data-testid="restore-undo"
                                >
                                    {undoing ? 'Undoing...' : 'Undo the last restore'}
                                </Button>
                            </DisabledReason>
                            {undoButtonView(restoreHistory.history).reason !== null && (
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: 'block', pt: 0.5, overflowWrap: 'anywhere' }}
                                    data-testid="restore-undo-reason"
                                >
                                    {undoButtonView(restoreHistory.history).reason}
                                </Typography>
                            )}
                        </Box>
                    )}
                </Box>
            )}
            {undoBridgeError !== null && (
                <Alert severity="error" role="alert" sx={{ mt: 1.5 }} data-testid="undo-bridge-error">
                    {undoBridgeError}
                </Alert>
            )}
            {undoOutcome !== null && undoOutcome.ok && (
                <Alert
                    severity="success"
                    role="status"
                    sx={{ mt: 1.5, overflowWrap: 'anywhere' }}
                    data-testid="undo-result"
                >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Undo finished and checked
                    </Typography>
                    <Typography variant="body2">{undoOutcome.message}</Typography>
                    {undoOutcome.files.map((f) => (
                        <Typography key={f.role} variant="body2" data-testid={`undo-file-${f.role}`}>
                            {`• ${f.label}: ${f.action === 'removed' ? 'removed (the restore had created it)' : 'put back as it was'}`}
                        </Typography>
                    ))}
                    {undoOutcome.notes.map((n, i) => (
                        <Typography key={`un-${String(i)}`} variant="body2">
                            {n}
                        </Typography>
                    ))}
                </Alert>
            )}
            {undoOutcome !== null && !undoOutcome.ok && (
                <Alert
                    severity={undoOutcome.filesState === 'needs-undo' ? 'error' : 'warning'}
                    role="alert"
                    sx={{ mt: 1.5, overflowWrap: 'anywhere' }}
                    data-testid="undo-failed"
                >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {undoFailureTitle(undoOutcome)}
                    </Typography>
                    <Typography variant="body2">{undoOutcome.message}</Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="undo-failed-fix">
                        {`What to do: ${undoOutcome.fix}`}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="undo-files-state">
                        {filesStateText(undoOutcome.filesState)}
                    </Typography>
                </Alert>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, pt: 2 }}>
                {PAGE_FOOTER}
            </Typography>
            <ConfirmDialog
                open={askUndo}
                title={UNDO_CONFIRM_TITLE}
                message={UNDO_CONFIRM_MESSAGE}
                confirmLabel="Undo"
                onConfirm={() => void undo()}
                onCancel={() => setAskUndo(false)}
            />
            {api !== null && (
                <BackupDetailsDialog api={api} backupId={inspecting} onClose={() => setInspecting(null)} />
            )}
            {api !== null && (
                <RestoreDialog
                    api={api}
                    backupId={restoring}
                    onClose={() => {
                        setRestoring(null)
                        reload()
                        restoreHistory.reload()
                    }}
                    onFinished={restoreHistory.reload}
                />
            )}
        </PageCard>
    )
}
