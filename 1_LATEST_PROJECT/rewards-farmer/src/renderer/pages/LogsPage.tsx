import ListAltIcon from '@mui/icons-material/ListAlt'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FarmerState } from '../../shared/farmer-types'
import { LEVEL_FILTERS, filterLines, formatLine, MAX_FILTER_TEXT } from '../../shared/logs-rules'
import { DEFAULT_LOGS_FILTER } from '../../shared/logs-types'
import type { LevelFilter, LogConnection, LogLine, LogsFilter } from '../../shared/logs-types'
import { ActionButton } from '../components/ActionButton'
import { useNotify } from '../components/Notifications'
import { InfoCard, PageCard, StatRow } from '../components/PageCard'
import type { FarmerStateHook } from '../hooks/useFarmerState'
import { useLogs } from '../hooks/useLogs'

// Phase 11: real engine logs and engine / run status. Shows only what the engine reported. Anything the engine did not
// tell us is shown as "Unknown", never guessed (master prompt, Phase 11).

const CONNECTION_TEXT: Record<LogConnection, string> = {
    idle: 'Engine not running',
    live: 'Live (event stream)',
    polling: 'Polling (event stream unavailable)',
    disconnected: 'Disconnected'
}

const LEVEL_COLOR: Record<LogLine['level'], string> = {
    error: 'error.main',
    warn: 'warning.main',
    info: 'text.primary',
    debug: 'text.secondary',
    unknown: 'text.secondary'
}

function linkText(state: FarmerState): string {
    switch (state.engine.link) {
        case 'ready':
            return 'Ready'
        case 'starting':
            return 'Starting'
        case 'down':
            return 'Stopped or crashed'
        case 'failed':
            return 'Failed to start'
        default:
            return 'Not started'
    }
}

function runText(state: FarmerState): string {
    return state.run.phase === 'unknown' ? 'Unknown (engine not reachable)' : state.run.phase
}

function localTime(iso: string | null): string {
    if (iso === null) return '-'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleTimeString()
}

function dateTime(iso: string | null): string {
    if (iso === null) return '-'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString()
}

function exitText(state: FarmerState): string {
    const e = state.run.lastExit
    if (e === null) return '-'
    const how =
        e.code !== null ? `code ${String(e.code)}` : e.signal !== null ? `signal ${e.signal}` : 'unknown'
    return `${how} at ${dateTime(e.at)}`
}

export function LogsPage({ farmer }: { readonly farmer: FarmerStateHook }) {
    const { state, api, bridgeMissing, error, reload } = useLogs(farmer)
    const notify = useNotify()
    const [filter, setFilter] = useState<LogsFilter>(DEFAULT_LOGS_FILTER)
    const [follow, setFollow] = useState(true)
    const [busy, setBusy] = useState<'refresh' | 'export' | null>(null)
    const listRef = useRef<HTMLDivElement | null>(null)

    const visible = useMemo(() => (state === null ? [] : filterLines(state.lines, filter)), [state, filter])

    useEffect(() => {
        const el = listRef.current
        if (follow && el !== null) el.scrollTop = el.scrollHeight
    }, [visible, follow])

    if (bridgeMissing) {
        return (
            <PageCard title="Logs">
                <Alert severity="info">
                    The log view works only inside the desktop app. This page is open outside it, so there is
                    no engine to read logs from.
                </Alert>
            </PageCard>
        )
    }

    const refresh = async (): Promise<void> => {
        if (api === null) return
        setBusy('refresh')
        try {
            const r = await api.refreshLogs()
            notify.notify(r.message, r.ok ? 'success' : 'error')
        } catch (e: unknown) {
            notify.notify(e instanceof Error ? e.message : 'Refresh failed.', 'error')
        } finally {
            setBusy(null)
            reload()
        }
    }

    const exportLines = async (): Promise<void> => {
        if (api === null) return
        setBusy('export')
        try {
            const r = await api.exportLogs(filter)
            // A cancelled save dialog is not an error and not worth a message.
            if (r.ok || r.message !== 'Export cancelled.')
                notify.notify(r.message, r.ok ? 'success' : 'error')
        } catch (e: unknown) {
            notify.notify(e instanceof Error ? e.message : 'Export failed.', 'error')
        } finally {
            setBusy(null)
        }
    }

    // The lines were redacted in the main process before they reached this screen, so copying them is safe.
    const copy = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(visible.map(formatLine).join('\n'))
            notify.notify(`Copied ${String(visible.length)} line(s).`, 'success')
        } catch {
            notify.notify('The clipboard is not available. Use Export instead.', 'error')
        }
    }

    const farmerState = farmer.state
    const none = visible.length === 0
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <PageCard title="Logs">
                {farmerState !== null && (
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                        <InfoCard
                            icon={<ListAltIcon />}
                            title="Engine status"
                            subtitle="Reported by the engine"
                        >
                            <StatRow label="Engine" value={linkText(farmerState)} />
                            <StatRow label="Engine version" value={farmerState.engine.version ?? 'Unknown'} />
                            <StatRow label="Run" value={runText(farmerState)} />
                            <StatRow label="Run started" value={dateTime(farmerState.run.startedAt)} />
                            <StatRow label="Last exit" value={exitText(farmerState)} />
                            <StatRow
                                label="Current account"
                                value={farmerState.current.account ?? 'Unknown'}
                            />
                            <StatRow
                                label="Current points"
                                value={
                                    farmerState.current.points === null
                                        ? 'Unknown'
                                        : String(farmerState.current.points)
                                }
                            />
                            <StatRow
                                label="Log stream"
                                value={state === null ? 'Unknown' : CONNECTION_TEXT[state.connection]}
                            />
                        </InfoCard>
                    </Box>
                )}
                {error !== null && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}
                {state?.fileError !== null && state?.fileError !== undefined && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        The log files on disk cannot be written right now ({state.fileError}). Lines are still
                        shown here, but may be missing from the files.
                    </Alert>
                )}
                {state !== null && state.missed > 0 && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        {String(state.missed)} engine log line(s) were not received (the engine&apos;s own
                        buffer moved on, or the stream was cut). They cannot be recovered.
                    </Alert>
                )}
                {state !== null && state.dropped > 0 && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        {String(state.dropped)} older line(s) were removed from this screen to save memory.
                        They are still in engine.log on disk.
                    </Alert>
                )}
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
                    <TextField
                        select
                        size="small"
                        label="Level"
                        value={filter.level}
                        onChange={(e) => setFilter({ ...filter, level: e.target.value as LevelFilter })}
                        sx={{ minWidth: 130 }}
                    >
                        {LEVEL_FILTERS.map((l) => (
                            <MenuItem key={l} value={l}>
                                {l === 'all' ? 'All levels' : `${l} and above`}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        size="small"
                        label="Search"
                        value={filter.text}
                        slotProps={{ htmlInput: { maxLength: MAX_FILTER_TEXT } }}
                        onChange={(e) => setFilter({ ...filter, text: e.target.value })}
                        sx={{ flex: 1, minWidth: 180 }}
                    />
                    <FormControlLabel
                        control={<Switch checked={follow} onChange={(e) => setFollow(e.target.checked)} />}
                        label="Follow newest"
                    />
                    <ActionButton
                        variant="text"
                        label="Refresh"
                        busy={busy === 'refresh'}
                        disabledReason={busy !== null ? 'Working...' : undefined}
                        onClick={() => void refresh()}
                    />
                    <ActionButton
                        variant="text"
                        label="Copy"
                        disabledReason={none ? 'No lines to copy.' : undefined}
                        onClick={() => void copy()}
                    />
                    <ActionButton
                        variant="text"
                        label="Export"
                        busy={busy === 'export'}
                        disabledReason={
                            busy !== null ? 'Working...' : none ? 'No lines to export.' : undefined
                        }
                        onClick={() => void exportLines()}
                    />
                </Box>
                {state === null && error === null && (
                    <Typography role="status" variant="body2">
                        Reading the logs...
                    </Typography>
                )}
                {state?.status === 'unavailable' && <Alert severity="info">{state.reason}</Alert>}
                {state?.status === 'ok' && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        Showing {String(visible.length)} of {String(state.bufferedTotal)} buffered line(s).
                        Secrets are hidden (***).
                    </Typography>
                )}
                {state?.status === 'ok' && (
                    <Box
                        ref={listRef}
                        role="log"
                        aria-label="Engine log lines"
                        tabIndex={0}
                        sx={{
                            height: 360,
                            overflow: 'auto',
                            fontFamily: 'Consolas, "Roboto Mono", monospace',
                            fontSize: '0.75rem',
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: 1,
                            p: 1
                        }}
                    >
                        {none ? (
                            <Typography variant="body2" color="text.secondary">
                                {state.bufferedTotal === 0
                                    ? 'No log lines yet. The engine has not written any.'
                                    : 'No lines match the filter.'}
                            </Typography>
                        ) : (
                            visible.map((l, i) => (
                                <Box key={l.seq}>
                                    {i > 0 && visible[i - 1]?.session !== l.session && (
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ display: 'block', fontStyle: 'italic', py: 0.5 }}
                                        >
                                            --- engine restarted (new session) ---
                                        </Typography>
                                    )}
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            gap: 1,
                                            color: LEVEL_COLOR[l.level],
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word'
                                        }}
                                    >
                                        <span>{localTime(l.at)}</span>
                                        <span>[{l.level.toUpperCase()}]</span>
                                        {l.user !== null && <span>[{l.user}]</span>}
                                        {l.title !== null && <strong>{l.title}</strong>}
                                        <span>{l.message}</span>
                                    </Box>
                                </Box>
                            ))
                        )}
                    </Box>
                )}
            </PageCard>
        </Box>
    )
}
