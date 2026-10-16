import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import type { NotifyChannelId } from '../../shared/notifications-types'
import {
    OFFLINE_NOTE,
    PAGE_FOOTER,
    PAGE_INTRO,
    UNSUPPORTED_SHORT,
    bridgeFailureView,
    logFilterView,
    pageProblemView,
    summaryText,
    testDisabledReason,
    testView,
    toggleDisabledReason
} from '../../shared/notifications-ui-rules'
import type { TestView } from '../../shared/notifications-ui-rules'
import { NotificationChannelCard } from '../components/NotificationChannelCard'
import { useNotify } from '../components/Notifications'
import { PageCard } from '../components/PageCard'
import { StateBlock } from '../components/StateBlock'
import { ToggleSwitch } from '../components/ToggleSwitch'
import type { FarmerStateHook } from '../hooks/useFarmerState'
import { useNotifications, useOnline } from '../hooks/useNotifications'
import { routeHash } from '../routes'

// Phase 17: notification settings. One card per channel the engine really delivers (Phase 16 service), one switch and one
// test button each. Addresses and tokens are NOT here: they stay write-only on the Secrets & API keys page. Channels the
// engine cannot deliver are listed with a disabled switch and the reason (rule 17).

interface Shown {
    readonly view: TestView
    readonly at: string
}

export function NotificationsPage({ farmer }: { readonly farmer: FarmerStateHook }) {
    const { state, loading, bridgeMissing, error, api, reload } = useNotifications(farmer)
    const online = useOnline()
    const notify = useNotify()
    // One thing at a time per channel: 'toggle' while a switch is being saved, 'test' while a test is going out.
    const [busy, setBusy] = useState<Partial<Record<NotifyChannelId, 'toggle' | 'test'>>>({})
    const [results, setResults] = useState<Partial<Record<NotifyChannelId, Shown>>>({})

    if (bridgeMissing) {
        return (
            <PageCard title="Notifications">
                <Alert severity="info">
                    Notification settings work only inside the desktop app. This page is open outside it, so
                    there is no engine config to read or write.
                </Alert>
            </PageCard>
        )
    }

    if (state === null) {
        return (
            <PageCard title="Notifications">
                {error !== null ? (
                    <StateBlock
                        state="error"
                        message="The notification settings could not be read."
                        detail={error}
                        retryLabel="Try again"
                        onRetry={reload}
                    />
                ) : (
                    <StateBlock state="loading" message="Reading the notification settings..." />
                )}
            </PageCard>
        )
    }

    const setBusyFor = (id: NotifyChannelId, what: 'toggle' | 'test' | undefined): void =>
        setBusy((b) => {
            const next = { ...b }
            if (what === undefined) delete next[id]
            else next[id] = what
            return next
        })

    const toggle = async (id: NotifyChannelId, enabled: boolean): Promise<void> => {
        if (api === null || busy[id] !== undefined) return
        setBusyFor(id, 'toggle')
        try {
            const r = await api.setNotificationEnabled(id, enabled)
            notify.notify(r.message, r.ok ? 'success' : 'error')
        } catch (e: unknown) {
            notify.notify(
                e instanceof Error ? `The switch was not saved (${e.message}).` : 'The switch was not saved.',
                'error'
            )
        } finally {
            setBusyFor(id, undefined)
            reload()
        }
    }

    const test = async (id: NotifyChannelId): Promise<void> => {
        if (api === null || busy[id] !== undefined) return
        setBusyFor(id, 'test')
        let view: TestView
        try {
            view = testView(await api.sendTestNotification(id))
        } catch (e: unknown) {
            view = bridgeFailureView(e instanceof Error ? e.message : null)
        }
        setResults((r) => ({ ...r, [id]: { view, at: new Date().toISOString() } }))
        setBusyFor(id, undefined)
        reload()
    }

    const problem = pageProblemView(state)
    const filter = logFilterView(state.logFilter)
    return (
        <PageCard title="Notifications">
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, pb: 1.5 }}>
                {PAGE_INTRO}
            </Typography>
            <Box sx={{ px: 1, pb: 1 }}>
                <Button size="small" variant="text" href={routeHash('secrets')} sx={{ ml: -1 }}>
                    Open Secrets &amp; API keys
                </Button>
            </Box>
            {!online && (
                <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="notify-offline">
                    {OFFLINE_NOTE}
                </Alert>
            )}
            {error !== null && (
                <Alert severity="error" sx={{ mb: 1.5 }}>
                    {`The last check failed (${error}). What you see below is the previous result.`}
                </Alert>
            )}
            {problem !== null ? (
                <Alert
                    severity={problem.tone}
                    data-testid="notify-page-problem"
                    action={
                        <Button color="inherit" size="small" onClick={reload} disabled={loading}>
                            Check again
                        </Button>
                    }
                >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {problem.title}
                    </Typography>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                        {problem.detail}
                    </Typography>
                </Alert>
            ) : (
                <>
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
                            sx={{ fontWeight: 600, px: 1 }}
                            data-testid="notify-summary"
                        >
                            {summaryText(state.channels)}
                        </Typography>
                        <Button variant="outlined" size="small" onClick={reload} disabled={loading}>
                            {loading ? 'Checking...' : 'Check again'}
                        </Button>
                    </Box>
                    {filter !== null && (
                        <Alert severity={filter.tone} sx={{ mb: 1 }} data-testid="notify-log-filter">
                            {filter.text}
                        </Alert>
                    )}
                    {state.channels.map((c) => (
                        <NotificationChannelCard
                            key={c.id}
                            channel={c}
                            toggleReason={toggleDisabledReason(farmer.state, c, busy[c.id] !== undefined)}
                            testReason={testDisabledReason(c, busy[c.id] === 'test')}
                            testing={busy[c.id] === 'test'}
                            result={results[c.id] ?? null}
                            onToggle={(enabled) => void toggle(c.id, enabled)}
                            onTest={() => void test(c.id)}
                        />
                    ))}
                </>
            )}
            <Box
                component="section"
                aria-label="Not available"
                sx={{ mt: 1, px: 1, borderTop: 1, borderColor: 'divider' }}
            >
                <Typography variant="subtitle1" component="h2" sx={{ pt: 2 }}>
                    Not available
                </Typography>
                {state.unsupported.map((u) => (
                    <Box key={u.id} data-testid={`notify-unsupported-${u.id}`} sx={{ py: 1.25 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {u.label}
                            </Typography>
                            <Chip size="small" label="Not available" variant="outlined" />
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                            {u.reason}
                        </Typography>
                        <ToggleSwitch
                            label={`Send ${u.label} notifications`}
                            checked={false}
                            disabledReason={UNSUPPORTED_SHORT[u.id]}
                            onChange={() => undefined}
                        />
                    </Box>
                ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, pt: 2 }}>
                {PAGE_FOOTER}
            </Typography>
        </PageCard>
    )
}
