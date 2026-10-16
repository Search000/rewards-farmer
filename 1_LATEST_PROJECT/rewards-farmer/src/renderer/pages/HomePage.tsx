import FileOpenIcon from '@mui/icons-material/FileOpen'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import GroupsIcon from '@mui/icons-material/Groups'
import PersonIcon from '@mui/icons-material/Person'
import LoginIcon from '@mui/icons-material/Login'
import ScheduleIcon from '@mui/icons-material/Schedule'
import StopIcon from '@mui/icons-material/Stop'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import type { ActionResult, FarmerNotice, FarmerState } from '../../shared/farmer-types'
import { ActionButton } from '../components/ActionButton'
import { LabeledField } from '../components/LabeledField'
import { useNotify } from '../components/Notifications'
import { InfoCard, PageCard, StatRow } from '../components/PageCard'
import { StateBlock } from '../components/StateBlock'
import { ToggleSwitch } from '../components/ToggleSwitch'
import type { FarmerStateHook } from '../hooks/useFarmerState'

const NONE = '-'
const num = (v: number | null): string => (v === null ? 'unknown' : String(v))

function runLabel(s: FarmerState): string {
    switch (s.run.phase) {
        case 'idle':
            return 'Idle'
        case 'starting':
            return 'Starting'
        case 'running':
            return 'Running'
        case 'stopping':
            return 'Stopping'
        default:
            return 'Engine not reachable'
    }
}

export function HomePage({ farmer }: { readonly farmer: FarmerStateHook }) {
    const { state, bridgeMissing, error, api, reload } = farmer
    const notify = useNotify()
    const [busy, setBusy] = useState(false)
    const [timeDraft, setTimeDraft] = useState<string | null>(null)

    if (bridgeMissing) {
        return (
            <PageCard title="Farmer">
                <StateBlock
                    state="unavailable"
                    message="This page is not running inside the desktop app."
                    detail="There is no engine connection here. Open this app by double-clicking START.bat in the project folder."
                />
            </PageCard>
        )
    }
    if (error !== null && state === null) {
        return (
            <PageCard title="Farmer">
                <StateBlock
                    state="error"
                    message="Could not read the app state."
                    detail={error}
                    onRetry={reload}
                />
            </PageCard>
        )
    }
    if (state === null || api === null) {
        return (
            <PageCard title="Farmer">
                <StateBlock state="loading" message="Reading the engine state..." />
            </PageCard>
        )
    }

    const report = (r: ActionResult, okMessage: string): void => {
        notify.notify(r.ok ? okMessage : r.message, r.ok ? 'success' : 'error')
    }
    // One click at a time; the main process also refuses duplicates (RUN_ACTIVE).
    const act = async (fn: () => Promise<ActionResult>, okMessage: string): Promise<void> => {
        if (busy) return
        setBusy(true)
        try {
            report(await fn(), okMessage)
        } catch (e: unknown) {
            notify.notify(e instanceof Error ? e.message : 'The action failed.', 'error')
        } finally {
            setBusy(false)
        }
    }

    const pick = async (): Promise<void> => {
        if (busy) return
        setBusy(true)
        try {
            const r = await api.pickAccountsFile()
            if (!r.cancelled) report(r.result, 'Accounts file selected.')
        } catch (e: unknown) {
            notify.notify(e instanceof Error ? e.message : 'The file dialog failed.', 'error')
        } finally {
            setBusy(false)
        }
    }

    const noticeAction = (n: FarmerNotice) => {
        if (n.action === 'create-config')
            return (
                <Button
                    color="inherit"
                    size="small"
                    onClick={() => void act(() => api.createEngineConfig(), 'Engine config created.')}
                >
                    Create config
                </Button>
            )
        if (n.action === 'restart-engine')
            return (
                <Button
                    color="inherit"
                    size="small"
                    onClick={() => void act(() => api.restartEngine(), 'Engine restarted.')}
                >
                    Restart engine
                </Button>
            )
        return undefined
    }

    const time = timeDraft ?? state.timer.time
    const saveTimer = (enabled: boolean, t: string): void => {
        void act(() => api.setTimer(enabled, t), enabled ? `Timer set for ${t}.` : 'Timer turned off.').then(
            () => setTimeDraft(null)
        )
    }

    const startReason = busy ? 'Working...' : (state.startDisabledReason ?? undefined)
    const stopReason = busy ? 'Working...' : (state.stopDisabledReason ?? undefined)
    const hasRun =
        state.run.phase === 'running' || state.run.phase === 'starting' || state.run.phase === 'stopping'

    return (
        <>
            {state.notices.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {state.notices.map((n) => (
                        <Alert key={n.id} severity={n.severity} action={noticeAction(n)}>
                            {n.message}
                        </Alert>
                    ))}
                </Box>
            )}

            <PageCard title="Farmer">
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <LabeledField
                        label="Accounts Path"
                        icon={<FolderOpenIcon />}
                        value={state.accounts.path ?? ''}
                        readOnly
                        error={
                            state.accounts.status === 'error'
                                ? (state.accounts.error ?? 'The accounts file is not usable.')
                                : undefined
                        }
                        helperText={
                            state.accounts.path === null
                                ? 'Choose the .env file that holds your accounts.'
                                : undefined
                        }
                        action={
                            <ActionButton
                                label="Open"
                                icon={<FileOpenIcon />}
                                onClick={() => void pick()}
                                disabledReason={
                                    hasRun
                                        ? 'Stop the current run before changing accounts.'
                                        : busy
                                          ? 'Working...'
                                          : undefined
                                }
                            />
                        }
                    />
                    <LabeledField
                        label="Alternate proxies"
                        icon={<VpnKeyIcon />}
                        value=""
                        readOnly
                        disabledReason="Not supported by the engine: proxies are set per account in the accounts file."
                        action={
                            <ActionButton
                                label="Open"
                                icon={<FileOpenIcon />}
                                disabledReason="Not supported by the engine."
                            />
                        }
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box aria-hidden sx={{ display: 'flex', width: 28, color: 'text.secondary' }}>
                            <ScheduleIcon />
                        </Box>
                        <TextField
                            label="Start at"
                            type="time"
                            value={time}
                            onChange={(e) => setTimeDraft(e.target.value)}
                            onBlur={() => {
                                if (timeDraft !== null && timeDraft !== state.timer.time)
                                    saveTimer(state.timer.enabled, timeDraft)
                                else setTimeDraft(null)
                            }}
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ width: 200 }}
                        />
                        <ToggleSwitch
                            label="Timer"
                            checked={state.timer.enabled}
                            onChange={(on) => saveTimer(on, time)}
                            disabledReason={busy ? 'Working...' : undefined}
                        />
                        {state.timer.enabled && state.timer.nextFireAt !== null && (
                            <Box component="span" sx={{ color: 'text.secondary', fontSize: 13 }}>
                                Next start: {new Date(state.timer.nextFireAt).toLocaleString()}
                            </Box>
                        )}
                    </Box>
                </Box>
            </PageCard>

            <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
                <InfoCard
                    icon={<PersonIcon />}
                    title={`Current account: ${state.current.account ?? 'None'}`}
                    subtitle="Information about current account"
                >
                    <StatRow label="Current point" value={hasRun ? num(state.current.points) : NONE} />
                    <StatRow label="Section" value={state.current.section ?? NONE} />
                    <StatRow label="Detail" value={state.current.detail ?? NONE} />
                    <StatRow label="Proxy" value={state.current.proxy ?? NONE} />
                </InfoCard>
                <InfoCard
                    icon={<GroupsIcon />}
                    title="Accounts informations"
                    subtitle="Overall information about all accounts"
                >
                    <StatRow label="All" value={num(state.summary.all)} />
                    <StatRow
                        label="Finished || Failed"
                        value={`${num(state.summary.finished)} || ${num(state.summary.failed)}`}
                    />
                    <StatRow label="Locked" value="unknown" />
                    <StatRow label="Suspended" value="unknown" />
                </InfoCard>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2.5, pt: 1 }}>
                <ActionButton
                    variant="pill"
                    label="Stop"
                    icon={<StopIcon />}
                    onClick={() => void act(() => api.stopRun(), 'Stop requested.')}
                    disabledReason={stopReason}
                />
                <ActionButton
                    variant="pill"
                    label="Start"
                    icon={<LoginIcon />}
                    onClick={() => void act(() => api.startRun(), 'Start requested.')}
                    disabledReason={startReason}
                />
            </Box>
            <Typography variant="caption" color="text.secondary" align="center" role="status">
                Engine:{' '}
                {state.engine.version === null
                    ? state.engine.link
                    : `${state.engine.link} (v${state.engine.version})`}{' '}
                | Run: {runLabel(state)}
            </Typography>
        </>
    )
}
