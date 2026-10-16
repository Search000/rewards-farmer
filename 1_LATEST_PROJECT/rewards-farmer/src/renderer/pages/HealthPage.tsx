import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HelpIcon from '@mui/icons-material/Help'
import WarningIcon from '@mui/icons-material/Warning'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { CHECK_DEFS, GROUP_TITLES, overallStatus, summaryText } from '../../shared/health-rules'
import type { HealthCheck, HealthGroup, HealthStatus } from '../../shared/health-types'
import { findSection, guideIdFor } from '../../shared/troubleshooting-rules'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DiagnosticsCard } from '../components/DiagnosticsCard'
import { GuideDialog } from '../components/GuideDialog'
import { useNotify } from '../components/Notifications'
import { PageCard } from '../components/PageCard'
import { StateBlock } from '../components/StateBlock'
import type { FarmerStateHook } from '../hooks/useFarmerState'
import { useHealth } from '../hooks/useHealth'
import { GUIDE_SECTIONS } from '../guide'

// Phase 12: health panel (runtime, configuration, engine). One row per real check. The icon is never the only signal:
// every row also says the status in words (accessibility).

const STATUS_TEXT: Record<HealthStatus, string> = {
    ok: 'OK',
    warning: 'Warning',
    error: 'Problem',
    unknown: 'Unknown'
}

const STATUS_COLOR: Record<HealthStatus, string> = {
    ok: 'success.main',
    warning: 'warning.main',
    error: 'error.main',
    unknown: 'text.secondary'
}

const STATUS_ICON: Record<HealthStatus, ReactElement> = {
    ok: <CheckCircleIcon fontSize="small" />,
    warning: <WarningIcon fontSize="small" />,
    error: <ErrorIcon fontSize="small" />,
    unknown: <HelpIcon fontSize="small" />
}

const GROUPS: readonly HealthGroup[] = ['runtime', 'config', 'engine', 'system']

function timeText(iso: string): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleTimeString()
}

function Row({
    check,
    first,
    onGuide,
    onRepair
}: {
    readonly check: HealthCheck
    readonly first: boolean
    readonly onGuide: (id: string) => void
    readonly onRepair: () => void
}) {
    const guideId = guideIdFor(check)
    // The repair works for a config.json that is broken. Not for a missing file (Home has "Create config") and not for a
    // file that cannot be read because another program holds it.
    const canRepair =
        check.status === 'error' &&
        (check.id === 'config-valid' || check.id === 'engine-config') &&
        !check.detail.includes('could not be read')
    return (
        <Box
            component="li"
            data-testid={`health-row-${check.id}`}
            data-status={check.status}
            sx={{
                display: 'flex',
                gap: 1.5,
                py: 1.25,
                px: 1,
                listStyle: 'none',
                alignItems: 'flex-start',
                borderTop: first ? 'none' : 1,
                borderColor: 'divider'
            }}
        >
            <Box aria-hidden sx={{ color: STATUS_COLOR[check.status], display: 'flex', pt: 0.25 }}>
                {STATUS_ICON[check.status]}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {check.title}{' '}
                        <Box component="span" sx={{ color: STATUS_COLOR[check.status], fontWeight: 600 }}>
                            {`- ${STATUS_TEXT[check.status]}`}
                        </Box>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {`Checked ${timeText(check.checkedAt)}`}
                    </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {check.detail}
                </Typography>
                {check.fix !== null && (
                    <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                        <Box component="span" sx={{ fontWeight: 600 }}>
                            What to do:{' '}
                        </Box>
                        {check.fix}
                    </Typography>
                )}
                {canRepair && (
                    <Button
                        size="small"
                        variant="outlined"
                        sx={{ mt: 0.5, mr: 1 }}
                        onClick={onRepair}
                        aria-label={`Repair config.json (${check.title})`}
                    >
                        Repair config.json
                    </Button>
                )}
                {guideId !== null && findSection(GUIDE_SECTIONS, guideId) !== null && (
                    <Button
                        size="small"
                        sx={{ mt: 0.5, ml: -1 }}
                        onClick={() => onGuide(guideId)}
                        aria-label={`Open guide for ${check.title}`}
                    >
                        Open guide
                    </Button>
                )}
            </Box>
        </Box>
    )
}

export function HealthPage({ farmer }: { readonly farmer: FarmerStateHook }) {
    const { state, loading, bridgeMissing, error, rerun, api } = useHealth(farmer)
    const [guideId, setGuideId] = useState<string | null>(null)
    const [confirmRepair, setConfirmRepair] = useState(false)
    const [repairing, setRepairing] = useState(false)
    const notify = useNotify()

    const doRepair = async (): Promise<void> => {
        setConfirmRepair(false)
        if (api === null || repairing) return
        setRepairing(true)
        try {
            const r = await api.repairEngineConfig()
            notify.notify(r.message, r.ok ? 'success' : 'error')
        } catch (e: unknown) {
            notify.notify(e instanceof Error ? e.message : 'The repair failed. Nothing was changed.', 'error')
        } finally {
            setRepairing(false)
            rerun()
        }
    }

    if (bridgeMissing) {
        return (
            <PageCard title="Health">
                <Alert severity="info">
                    The health panel works only inside the desktop app. This page is open outside it, so there
                    is nothing to check.
                </Alert>
            </PageCard>
        )
    }

    if (state === null) {
        return (
            <PageCard title="Health">
                {error !== null ? (
                    <StateBlock state="error" message="The health checks could not run." detail={error} />
                ) : (
                    <StateBlock state="loading" message="Running the checks..." />
                )}
            </PageCard>
        )
    }

    const overall = overallStatus(state.checks)
    return (
        <PageCard title="Health">
            {error !== null && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {`The last run failed (${error}). The list below is the previous result.`}
                </Alert>
            )}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    flexWrap: 'wrap',
                    pb: 1
                }}
            >
                <Typography
                    role="status"
                    variant="body1"
                    sx={{ fontWeight: 600, color: STATUS_COLOR[overall], px: 1 }}
                    data-testid="health-summary"
                >
                    {loading ? 'Checking again... ' : ''}
                    {summaryText(state.checks)}
                </Typography>
                <Button variant="outlined" size="small" onClick={rerun} disabled={loading}>
                    {loading ? 'Checking...' : 'Re-run checks'}
                </Button>
            </Box>
            {GROUPS.map((group) => {
                const rows = state.checks.filter((c) => c.group === group)
                if (rows.length === 0) return null
                return (
                    <Box component="section" key={group} aria-label={GROUP_TITLES[group]} sx={{ mt: 1.5 }}>
                        <Typography variant="subtitle1" component="h2" sx={{ px: 1 }}>
                            {GROUP_TITLES[group]}
                        </Typography>
                        <Box component="ul" sx={{ m: 0, p: 0 }}>
                            {rows.map((c, i) => (
                                <Row
                                    key={c.id}
                                    check={c}
                                    first={i === 0}
                                    onGuide={setGuideId}
                                    onRepair={() => setConfirmRepair(true)}
                                />
                            ))}
                        </Box>
                    </Box>
                )
            })}
            {api !== null && <DiagnosticsCard api={api} />}
            <ConfirmDialog
                open={confirmRepair}
                title="Repair config.json?"
                message="The app keeps a copy of the current config.json in the engine folder (config.broken.json). Then it writes a new config.json from the engine example and puts back every setting of the old file that still has a good value. Settings that cannot be used are set to the example value; the copy still has them. If the engine is running it is restarted. Nothing else is changed."
                confirmLabel="Repair"
                onConfirm={() => void doRepair()}
                onCancel={() => setConfirmRepair(false)}
            />
            <GuideDialog
                section={guideId === null ? null : findSection(GUIDE_SECTIONS, guideId)}
                onClose={() => setGuideId(null)}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, pt: 2 }}>
                {`${String(CHECK_DEFS.length)} checks, last run${state.finishedAt === null ? '' : ` at ${timeText(state.finishedAt)}`}. Press "Re-run checks" to run them again. While this page is open they also run again by themselves when the engine or the accounts file changes, when the internet goes off or on, or when you come back to this window.`}
            </Typography>
        </PageCard>
    )
}
