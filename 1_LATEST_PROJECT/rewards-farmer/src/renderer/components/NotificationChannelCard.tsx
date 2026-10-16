import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { useId } from 'react'
import type { NotifyChannelState } from '../../shared/notifications-types'
import { READINESS_VIEW } from '../../shared/notifications-ui-rules'
import type { TestView } from '../../shared/notifications-ui-rules'
import { DisabledReason } from './DisabledReason'
import { ToggleSwitch } from './ToggleSwitch'

// Phase 17: one notification channel. Shows the real state, one switch (saved at once by the service, which also writes a
// backup copy first) and one "Send test message" button. A result stays on screen until the next test, because a long
// message in a pop-up that disappears after 5 seconds is easy to miss.

interface Props {
    readonly channel: NotifyChannelState
    // undefined = allowed. A string = disabled, and this is why (rule 17).
    readonly toggleReason: string | undefined
    readonly testReason: string | undefined
    readonly testing: boolean
    readonly result: { readonly view: TestView; readonly at: string } | null
    readonly onToggle: (enabled: boolean) => void
    readonly onTest: () => void
}

function timeText(iso: string): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : ` Checked at ${d.toLocaleTimeString()}.`
}

export function NotificationChannelCard({
    channel,
    toggleReason,
    testReason,
    testing,
    result,
    onToggle,
    onTest
}: Props) {
    const headingId = useId()
    const readiness = READINESS_VIEW[channel.readiness]
    return (
        <Box
            component="section"
            aria-labelledby={headingId}
            data-testid={`notify-card-${channel.id}`}
            data-readiness={channel.readiness}
            sx={{ py: 2, px: 1, borderTop: 1, borderColor: 'divider' }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography id={headingId} variant="subtitle1" component="h2">
                    {channel.label}
                </Typography>
                <Chip size="small" label={readiness.text} color={readiness.color} variant="outlined" />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {channel.deliveryText}
            </Typography>
            {channel.problems.length > 0 && (
                <Box component="ul" aria-label={`${channel.label} problems`} sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                    {channel.problems.map((p) => (
                        <Typography key={p} component="li" variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                            {p}
                        </Typography>
                    ))}
                </Box>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mt: 1 }}>
                <ToggleSwitch
                    label={`Send ${channel.label} notifications during runs`}
                    checked={channel.enabled}
                    disabledReason={toggleReason}
                    onChange={onToggle}
                />
                <DisabledReason reason={testReason}>
                    <Button
                        variant="outlined"
                        size="small"
                        disabled={testReason !== undefined}
                        aria-busy={testing ? true : undefined}
                        aria-label={`Send test message to ${channel.label}`}
                        onClick={onTest}
                    >
                        {testing ? 'Sending...' : 'Send test message'}
                    </Button>
                </DisabledReason>
            </Box>
            {result !== null && (
                <Alert
                    severity={result.view.tone}
                    // A success is a status. A problem uses the default alert role so it is read out at once.
                    {...(result.view.tone === 'success' ? { role: 'status' } : {})}
                    data-testid={`notify-result-${channel.id}`}
                    sx={{ mt: 1.5 }}
                >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {result.view.title}
                    </Typography>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                        {result.view.detail}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {`${result.view.requestLine}${timeText(result.at)}`}
                    </Typography>
                </Alert>
            )}
        </Box>
    )
}
