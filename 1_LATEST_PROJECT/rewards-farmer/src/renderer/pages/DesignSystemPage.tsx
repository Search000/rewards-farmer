import FolderOpenIcon from '@mui/icons-material/FileOpen'
import MailIcon from '@mui/icons-material/Mail'
import InfoIcon from '@mui/icons-material/Info'
import PlayIcon from '@mui/icons-material/Login'
import StopIcon from '@mui/icons-material/Stop'
import TimerIcon from '@mui/icons-material/Timer'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Hint } from '../components/Hint'
import { LabeledField } from '../components/LabeledField'
import { useNotify } from '../components/Notifications'
import { InfoCard, PageCard, StatRow } from '../components/PageCard'
import { SelectField } from '../components/SelectField'
import { StateBlock } from '../components/StateBlock'
import { ToggleSwitch } from '../components/ToggleSwitch'

const NOT_CONNECTED = 'Not connected yet (Phase 5 shell only).'

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
    return (
        <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, py: 1.5 }}>
            <Typography variant="subtitle1" component="h2">
                {title}
            </Typography>
            {children}
        </Box>
    )
}

// Development-only gallery. Every value is a placeholder or a dash. No engine data, no fake numbers.
export function DesignSystemPage() {
    const notify = useNotify()
    const [toggleA, setToggleA] = useState(false)
    const [toggleB, setToggleB] = useState(true)
    const [level, setLevel] = useState('info')
    const [text, setText] = useState('')
    const [dialogOpen, setDialogOpen] = useState(false)

    return (
        <>
            <PageCard title="Design system (development)">
                <Section title="Buttons">
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                        <ActionButton
                            label="Open"
                            icon={<FolderOpenIcon />}
                            onClick={() => notify.notify('Open clicked', 'info')}
                        />
                        <ActionButton
                            variant="pill"
                            label="Start"
                            icon={<PlayIcon />}
                            onClick={() => notify.notify('Start clicked', 'info')}
                        />
                        <ActionButton
                            variant="text"
                            label="Save"
                            onClick={() => notify.notify('Save clicked', 'success')}
                        />
                        <ActionButton label="Open" icon={<FolderOpenIcon />} disabledReason={NOT_CONNECTED} />
                        <ActionButton
                            variant="pill"
                            label="Stop"
                            icon={<StopIcon />}
                            disabledReason="Nothing is running."
                        />
                        <ActionButton variant="pill" label="Working" busy />
                    </Box>
                </Section>

                <Section title="Inputs">
                    <LabeledField
                        label="Accounts Path"
                        value={text}
                        onChange={setText}
                        icon={<FolderOpenIcon />}
                    />
                    <LabeledField
                        label="Read-only value"
                        value="engine/config.json"
                        readOnly
                        icon={<InfoIcon />}
                    />
                    <LabeledField label="Error state" value="abc" error="Value is not valid." />
                    <LabeledField
                        label="Disabled state"
                        value=""
                        disabledReason="Not supported by the engine."
                    />
                </Section>

                <Section title="Dropdown and toggles">
                    <SelectField
                        label="Log level"
                        value={level}
                        onChange={setLevel}
                        options={[
                            { value: 'debug', label: 'Debug' },
                            { value: 'info', label: 'Info' },
                            { value: 'warn', label: 'Warn' }
                        ]}
                    />
                    <SelectField
                        label="Disabled dropdown"
                        value="a"
                        options={[{ value: 'a', label: 'A' }]}
                        onChange={() => undefined}
                        disabledReason="Not supported by the engine."
                    />
                    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        <ToggleSwitch label="Timer" checked={toggleA} onChange={setToggleA} />
                        <ToggleSwitch label="Headless" checked={toggleB} onChange={setToggleB} />
                        <ToggleSwitch
                            label="Randomization"
                            checked={false}
                            onChange={() => undefined}
                            disabledReason="Not built"
                        />
                    </Box>
                </Section>

                <Section title="Tooltip, modal, notifications">
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Hint text="Tooltip text">
                            <Button variant="outlined">Hover or focus me</Button>
                        </Hint>
                        <Button variant="outlined" onClick={() => setDialogOpen(true)}>
                            Open modal
                        </Button>
                        <Button onClick={() => notify.notify('Information message', 'info')}>Info</Button>
                        <Button color="success" onClick={() => notify.notify('Saved', 'success')}>
                            Success
                        </Button>
                        <Button
                            color="warning"
                            onClick={() => notify.notify('Check this setting', 'warning')}
                        >
                            Warning
                        </Button>
                        <Button color="error" onClick={() => notify.notify('Something failed', 'error')}>
                            Error
                        </Button>
                    </Box>
                </Section>

                <Section title="Loading, error, empty, unavailable">
                    <StateBlock state="loading" message="Loading" />
                    <StateBlock
                        state="error"
                        message="Engine failed to start"
                        detail="Example text only."
                        onRetry={() => notify.notify('Retry clicked', 'info')}
                    />
                    <StateBlock state="empty" message="No accounts file added yet" />
                    <StateBlock
                        state="unavailable"
                        message="Unavailable"
                        detail="The engine does not provide this value."
                    />
                </Section>
            </PageCard>

            <PageCard title="Layout reference (screenshot 1 structure, not connected)">
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <LabeledField
                        label="Accounts Path"
                        value=""
                        icon={<FolderOpenIcon />}
                        disabledReason={NOT_CONNECTED}
                        action={
                            <ActionButton
                                label="Open"
                                icon={<FolderOpenIcon />}
                                disabledReason={NOT_CONNECTED}
                            />
                        }
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <TimerIcon aria-hidden sx={{ color: 'text.secondary' }} />
                        <Box sx={{ flex: 1 }}>
                            <LabeledField label="Start at" value="" disabledReason={NOT_CONNECTED} />
                        </Box>
                        <ToggleSwitch
                            label="Timer"
                            checked={false}
                            onChange={() => undefined}
                            disabledReason="Not connected"
                        />
                    </Box>
                </Box>
            </PageCard>

            <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
                <InfoCard
                    icon={<MailIcon />}
                    title="Current account: None"
                    subtitle="Information about current account"
                >
                    <StatRow label="Current point:" value="-" />
                    <StatRow label="Section:" value="-" />
                    <StatRow label="Detail:" value="-" />
                    <StatRow label="Proxy:" value="-" />
                </InfoCard>
                <InfoCard
                    icon={<InfoIcon />}
                    title="Accounts informations"
                    subtitle="Overall information about all accounts"
                >
                    <StatRow label="All:" value="-" />
                    <StatRow label="Finished || Failed:" value="-" />
                    <StatRow label="Locked:" value="-" />
                    <StatRow label="Suspended:" value="-" />
                </InfoCard>
            </Box>

            <ConfirmDialog
                open={dialogOpen}
                title="Confirm example"
                message="This modal is used for destructive actions in later phases."
                confirmLabel="Confirm"
                onCancel={() => setDialogOpen(false)}
                onConfirm={() => {
                    setDialogOpen(false)
                    notify.notify('Confirmed', 'success')
                }}
            />
        </>
    )
}
