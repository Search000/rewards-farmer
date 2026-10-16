import RestoreIcon from '@mui/icons-material/RestartAlt'
import SaveIcon from '@mui/icons-material/SaveOutlined'
import SettingsIcon from '@mui/icons-material/SettingsOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DURATION_HELP } from '../../shared/duration'
import {
    BROWSER_OPTIONS,
    LOG_LEVEL_OPTIONS,
    QUERY_ENGINE_OPTIONS,
    isKnownEngine,
    sameValues,
    shorterThanDefault,
    validateValues
} from '../../shared/engine-settings-rules'
import type { EngineSettingsValues, SettingKey } from '../../shared/engine-settings-types'
import type { ActionResult } from '../../shared/farmer-types'
import { ActionButton } from '../components/ActionButton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { LabeledField } from '../components/LabeledField'
import { useNotify } from '../components/Notifications'
import { PageCard } from '../components/PageCard'
import { SelectField } from '../components/SelectField'
import { StateBlock } from '../components/StateBlock'
import { ToggleSwitch } from '../components/ToggleSwitch'
import { useEngineSettings } from '../hooks/useEngineSettings'
import type { FarmerStateHook } from '../hooks/useFarmerState'

// Controls of screenshots 3-4 that have NO safe, real engine field. They stay on the page where the screenshots show
// them, greyed out and EMPTY, with the reason. They never hold a value and never write anything (rules 3, 9, 17).
// Reasons: docs/requirements-matrix.md A3 / D1 and docs/feature-support-matrix.md.
const NA = 'Not available: the engine has no such setting.'
const NA_EVASION = 'Not included: it only helps to hide the bot from Microsoft, so this app does not have it.'
const NA_RANGE = 'Not available as one number: the engine uses a minimum and maximum. See "Timing" below.'
const NA_DECISION = 'Not included: it only makes the bot look human to hide it from Microsoft.'
const noop = (): void => undefined

function NaField({ label, reason = NA }: { readonly label: string; readonly reason?: string }) {
    return <LabeledField label={label} value="" disabledReason={reason} />
}
function NaSelect({ label, reason = NA }: { readonly label: string; readonly reason?: string }) {
    return <SelectField label={label} value="" options={[]} onChange={noop} disabledReason={reason} />
}
function NaToggle({
    label,
    placement,
    reason = 'not available'
}: {
    readonly label: string
    readonly placement?: 'start' | 'end' | undefined
    readonly reason?: string
}) {
    return (
        <ToggleSwitch
            label={label}
            checked={false}
            labelPlacement={placement}
            disabledReason={reason}
            onChange={noop}
        />
    )
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <Paper
            component="section"
            aria-label={title}
            sx={{ borderRadius: 3, p: 2, mb: 2, breakInside: 'avoid', display: 'block' }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1.5, pt: 1, pb: 2 }}>
                <SettingsIcon aria-hidden sx={{ color: 'text.secondary' }} />
                <Typography variant="subtitle1" component="h2">
                    {title}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, px: 1 }}>{children}</Box>
        </Paper>
    )
}

function SettingsMain({
    farmer,
    onDirtyChange
}: {
    readonly farmer: FarmerStateHook
    // Lets the app ask before leaving the page with unsaved changes.
    readonly onDirtyChange?: ((dirty: boolean) => void) | undefined
}) {
    const { state, bridgeMissing, error, api, reload } = useEngineSettings(farmer)
    const notify = useNotify()
    const [draft, setDraft] = useState<EngineSettingsValues | null>(null)
    const [busy, setBusy] = useState(false)
    const [confirmReset, setConfirmReset] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    // "Shutdown" is an APP setting (app-settings.json), not an engine field. It is saved the moment it is switched.
    const [shutdown, setShutdown] = useState<boolean | null>(null)
    useEffect(() => {
        if (api === null) return
        api.getSettings().then(
            (s) => setShutdown(s.shutdownAfterRun),
            () => setShutdown(null)
        )
    }, [api])

    const saved = state?.values ?? null
    // The draft starts from the saved values and is replaced whenever the saved values change (after Save, Reset, reload).
    const savedKey = saved === null ? '' : JSON.stringify(saved)
    useEffect(() => {
        setDraft(saved)
    }, [savedKey])

    const dirty = draft !== null && saved !== null && !sameValues(draft, saved)
    const errors = draft === null ? {} : validateValues(draft)
    const hasErrors = Object.keys(errors).length > 0
    const shortNotes = draft === null ? [] : shorterThanDefault(draft, state?.defaults ?? null)
    useEffect(() => {
        onDirtyChange?.(dirty)
        return () => onDirtyChange?.(false)
    }, [dirty, onDirtyChange])

    if (bridgeMissing) {
        return (
            <PageCard title="Settings">
                <StateBlock
                    state="unavailable"
                    message="This page is not running inside the desktop app."
                    detail="There is no engine config to read here. Open this app by double-clicking START.bat in the project folder."
                />
            </PageCard>
        )
    }
    if (error !== null && state === null) {
        return (
            <PageCard title="Settings">
                <StateBlock
                    state="error"
                    message="Could not read the settings."
                    detail={error}
                    onRetry={reload}
                />
            </PageCard>
        )
    }
    if (state === null || api === null) {
        return (
            <PageCard title="Settings">
                <StateBlock state="loading" message="Reading the engine settings..." />
            </PageCard>
        )
    }
    if (state.status !== 'ok' || draft === null) {
        return (
            <PageCard title="Settings">
                <StateBlock
                    state={state.status === 'error' ? 'error' : 'unavailable'}
                    message={
                        state.status === 'error'
                            ? 'The settings cannot be used.'
                            : 'The settings are not available yet.'
                    }
                    detail={state.reason ?? undefined}
                    onRetry={state.status === 'error' ? reload : undefined}
                />
            </PageCard>
        )
    }

    const lockReason = busy ? 'Working...' : (state.editDisabledReason ?? undefined)

    const run = async (fn: () => Promise<ActionResult>): Promise<void> => {
        setBusy(true)
        setSaveError(null)
        try {
            const result = await fn()
            if (result.ok) notify.notify(result.message, 'success')
            else setSaveError(result.message)
        } catch (e: unknown) {
            setSaveError(e instanceof Error ? e.message : 'The change failed.')
        } finally {
            setBusy(false)
            reload()
        }
    }

    const changeShutdown = async (value: boolean): Promise<void> => {
        try {
            const result = await api.setShutdownAfterRun(value)
            if (result.ok) {
                setShutdown(value)
                notify.notify(result.message, 'success')
            } else notify.notify(result.message, 'error')
        } catch (e: unknown) {
            notify.notify(e instanceof Error ? e.message : 'Could not save the Shutdown setting.', 'error')
        }
    }

    const toggle = (key: SettingKey, label: string, placement?: 'start' | 'end') => {
        const checked = draft[key]
        return (
            <ToggleSwitch
                label={label}
                labelPlacement={placement}
                checked={typeof checked === 'boolean' ? checked : false}
                disabledReason={lockReason}
                onChange={(v) => setDraft({ ...draft, [key]: v })}
            />
        )
    }

    const durationField = (key: SettingKey, label: string) => {
        const value = draft[key]
        const note = shortNotes.includes(key)
            ? 'Shorter than the engine default. Faster runs can raise the chance of account restrictions.'
            : DURATION_HELP
        return (
            <LabeledField
                label={label}
                value={typeof value === 'string' ? value : ''}
                disabledReason={lockReason}
                error={errors[key]}
                helperText={note}
                onChange={(v) => setDraft({ ...draft, [key]: v })}
            />
        )
    }

    const toggleEngine = (name: string, on: boolean): void => {
        const list = draft.queryEngines
        setDraft({ ...draft, queryEngines: on ? [...list, name] : list.filter((x) => x !== name) })
    }
    // Entries the engine accepts but this page does not offer (for example rss.<site>) are kept as they are.
    const extraEngines = draft.queryEngines.filter(
        (x) => !QUERY_ENGINE_OPTIONS.some((o) => o.value === x) && isKnownEngine(x)
    )

    const resetReason =
        lockReason ?? (state.defaults === null ? 'The engine example config could not be read.' : undefined)
    const saveReason =
        lockReason ??
        (hasErrors ? 'Fix the fields marked in red first.' : dirty ? undefined : 'No changes to save.')

    // Two columns of switches like screenshot 3: left column label after the switch, right column label before it.
    const grid = {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        columnGap: 3,
        rowGap: 0.5,
        px: 1
    } as const

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <PageCard title="Settings">
                {state.editDisabledReason !== null && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        Settings are read-only now: {state.editDisabledReason}
                    </Alert>
                )}
                {saveError !== null && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {saveError}
                    </Alert>
                )}
                {dirty && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        You have unsaved changes.
                    </Alert>
                )}
                {state.missingKeys.length > 0 && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        {String(state.missingKeys.length)} setting(s) are not written in your config.json yet.
                        The engine example value is shown until you save.
                    </Alert>
                )}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, px: 1 }}>
                    <NaField label="PC User Agent" reason={NA_EVASION} />
                    <NaField label="Mobile User Agent" reason={NA_EVASION} />
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ px: 1, pt: 2, pb: 1 }}>
                    Changes are saved to the engine config.json by the engine itself and apply from the next
                    run. A backup copy is made before every save. Shutdown is an app setting saved at once:
                    the app closes after a run that finished without errors. Greyed controls are shown as in
                    the reference screenshots but are not available: the engine has no such setting, or the
                    feature is not built.
                    {state.lastBackupAt !== null &&
                        ` Last backup: ${new Date(state.lastBackupAt).toLocaleString()}.`}
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, pt: 1 }}>
                    <ActionButton
                        variant="text"
                        label="Reset to defaults"
                        icon={<RestoreIcon />}
                        disabledReason={resetReason}
                        onClick={() => setConfirmReset(true)}
                    />
                    <ActionButton
                        variant="text"
                        label="Discard"
                        disabledReason={busy ? 'Working...' : dirty ? undefined : 'No changes to discard.'}
                        onClick={() => setDraft(saved)}
                    />
                    <ActionButton
                        variant="text"
                        label="Save"
                        icon={<SaveIcon />}
                        busy={busy}
                        disabledReason={saveReason}
                        onClick={() => void run(() => api.saveEngineSettings(draft))}
                    />
                </Box>
            </PageCard>

            <Box sx={{ columnCount: { xs: 1, lg: 2 }, columnGap: 2 }}>
                <Section title="App & browser settings">
                    <NaField label="Device name" />
                    <SelectField
                        label="Log level"
                        value={draft.logLevel}
                        options={LOG_LEVEL_OPTIONS}
                        disabledReason={lockReason}
                        helperText="Engine setting debugLogs: Debug adds the detailed lines."
                        onChange={(v) => setDraft({ ...draft, logLevel: v === 'debug' ? 'debug' : 'info' })}
                    />
                    <Divider />
                    <SelectField
                        label="Browser"
                        value={draft.browser}
                        options={BROWSER_OPTIONS}
                        disabledReason={lockReason}
                        helperText="Google Chrome is not supported by the engine. Chromium is the safer choice."
                        onChange={(v) =>
                            setDraft({ ...draft, browser: v === 'msedge' ? 'msedge' : 'chromium' })
                        }
                    />
                    <Box sx={grid}>
                        {toggle('headless', 'Headless')}
                        <NaToggle label="Session" placement="start" />
                        <NaToggle label="Refresh proxy" />
                        {toggle('useProxyForSearchQueries', 'Use proxy for search queries', 'start')}
                        <ToggleSwitch
                            label="Shutdown"
                            checked={shutdown === true}
                            disabledReason={shutdown === null ? 'loading' : undefined}
                            onChange={(v) => void changeShutdown(v)}
                        />
                        {toggle('disableImages', 'Disable images', 'start')}
                        <NaToggle label="Randomization" reason="not included" />
                        <NaToggle label="Check Bing" placement="start" />
                        <NaToggle label="Logs in excel" />
                        <NaToggle label="Share data" placement="start" reason="not included" />
                        <NaToggle label="Check restriction" />
                    </Box>
                    <NaField label="Gift card URL" />
                    {toggle('parallelSearching', 'Parallel mode (search)')}
                    <NaField label="Timezone" reason={NA_EVASION} />
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                        <NaField label="Latitude" reason={NA_EVASION} />
                        <NaField label="Longitude" reason={NA_EVASION} />
                    </Box>
                    <NaField label="Point target" />
                </Section>

                <Section title="Task settings">
                    <NaSelect label="Speed" />
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                        <NaSelect label="Search method" />
                        <NaSelect label="Tasks method" />
                    </Box>
                    <NaToggle label="Check status of accounts:" placement="start" />
                    <NaToggle label="Collect cookies:" placement="start" reason="not included" />
                    <Divider />
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                        <NaSelect label="Daily set completion mode" />
                        <NaSelect label="More activities completion mode" />
                    </Box>
                    <NaSelect label="Read to earn completion mode" />
                    <Box sx={grid}>
                        {toggle('dailyQuests', 'Daily quests')}
                        {toggle('punchCards', 'Punch cards', 'start')}
                        {toggle('moreActivities', 'More activities')}
                        {toggle('exploreOnBing', 'Explore on Bing', 'start')}
                        {toggle('pcSearch', 'PC search')}
                        {toggle('mobileSearch', 'Mobile search', 'start')}
                        {toggle('readToEarn', 'Read to earn')}
                        {toggle('visualSearch', 'Visual Search', 'start')}
                    </Box>
                    <NaField label="Visual search images path" />
                    <NaField label="OpenRouter API key" />
                    <NaSelect label="Cooldown mode" />
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                        <NaField label="Delay after search" reason={NA_RANGE} />
                        <NaField label="Delay after task" />
                    </Box>
                    <NaField label="Search words setting" />
                    <NaSelect label="Search count method" />
                    <NaToggle label="Open search results" placement="start" reason={NA_DECISION} />
                    <NaField label="Probability of typo in searches" reason={NA_EVASION} />
                </Section>

                <Section title="Login & check-in">
                    <Box sx={grid}>
                        {toggle('prewarmDesktopLogin', 'Prewarm desktop login')}
                        {toggle('dailyCheckIn', 'Daily check-in', 'start')}
                        {toggle('streakProtection', 'Streak protection')}
                        {toggle('claimBonusPoints', 'Claim bonus points', 'start')}
                        {toggle('activateSearchPerk', 'Activate search perk')}
                        {toggle('appPromotions', 'App promotions', 'start')}
                        {toggle('urlRewards', 'URL rewards')}
                        {toggle('autoClaimPunchCards', 'Auto-claim punch cards', 'start')}
                        {toggle('skipNonPointTasks', 'Skip tasks without points')}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                        Prewarm desktop login: the engine does the desktop sign-in for all accounts at the
                        start of a run, so sign-in approvals come together. The other switches decide which
                        parts of the daily work the engine does. They apply from the next run.
                    </Typography>
                </Section>

                <Section title="Timing">
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                        {durationField('accountDelayMin', 'Between accounts: min')}
                        {durationField('accountDelayMax', 'Between accounts: max')}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                        {durationField('searchDelayMin', 'Between searches: min')}
                        {durationField('searchDelayMax', 'Between searches: max')}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                        {durationField('readDelayMin', 'Read to earn delay: min')}
                        {durationField('readDelayMax', 'Read to earn delay: max')}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                        {durationField('globalTimeout', 'Page timeout')}
                        {durationField('searchResultVisitTime', 'Result page stay time')}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                        The engine waits a random time between the minimum and the maximum. A time needs a
                        unit: sec, min or h. Page timeout is how long the browser waits for a page (at least 1
                        sec).
                    </Typography>
                </Section>

                <Section title="Search options">
                    <Box sx={grid}>
                        {toggle('bonusSearches', 'Bonus searches')}
                        {toggle('runOnZeroPoints', 'Search when 0 points left', 'start')}
                        {toggle('clusterSearch', 'Related searches')}
                        {toggle('localBingQueries', 'Local words for Explore on Bing', 'start')}
                    </Box>
                    <LabeledField
                        label="Max bonus searches"
                        value={Number.isNaN(draft.maxBonusSearches) ? '' : String(draft.maxBonusSearches)}
                        disabledReason={lockReason}
                        error={errors.maxBonusSearches}
                        helperText="Whole number, 0 to 1000. 0 skips bonus searches."
                        onChange={(v) => {
                            if (/^\d{0,4}$/.test(v))
                                setDraft({ ...draft, maxBonusSearches: v === '' ? Number.NaN : Number(v) })
                        }}
                    />
                    <Divider />
                    <Typography variant="subtitle2" component="h3" sx={{ px: 1 }}>
                        Search word sources
                    </Typography>
                    <Box
                        role="group"
                        aria-label="Search word sources"
                        sx={{ display: 'flex', flexDirection: 'column', px: 1 }}
                    >
                        {QUERY_ENGINE_OPTIONS.map((o) => (
                            <FormControlLabel
                                key={o.value}
                                label={o.label}
                                control={
                                    <Checkbox
                                        checked={draft.queryEngines.includes(o.value)}
                                        disabled={lockReason !== undefined}
                                        onChange={(e) => toggleEngine(o.value, e.target.checked)}
                                    />
                                }
                            />
                        ))}
                    </Box>
                    <Typography
                        variant="caption"
                        color={errors.queryEngines === undefined ? 'text.secondary' : 'error'}
                        sx={{ px: 1 }}
                    >
                        {errors.queryEngines ??
                            `Used in this order: ${draft.queryEngines.join(' > ')}. A source you tick later goes to the end.`}
                        {extraEngines.length > 0 && ` Kept from config.json: ${extraEngines.join(', ')}.`}
                    </Typography>
                </Section>

                <Section title="Advanced">
                    <LabeledField
                        label="Accounts at the same time"
                        value={Number.isNaN(draft.clusters) ? '' : String(draft.clusters)}
                        disabledReason={lockReason}
                        error={errors.clusters}
                        helperText="1 to 8. 1 = one account after the other. More = several accounts run in parallel."
                        onChange={(v) => {
                            if (/^\d{0,2}$/.test(v))
                                setDraft({ ...draft, clusters: v === '' ? Number.NaN : Number(v) })
                        }}
                    />
                    <Box sx={grid}>
                        {toggle('apiSearch', 'Search over HTTP (experimental)')}
                        {toggle('apiSearchOnBing', 'Explore on Bing over HTTP (experimental)', 'start')}
                        {toggle('ignoreCertificateErrors', 'Ignore proxy certificate errors')}
                    </Box>
                    <Typography variant="caption" color="warning.main" sx={{ px: 1 }}>
                        Ignore proxy certificate errors turns off the safety check of the secure connection
                        when a proxy is used. Switch it on only if you trust that proxy. The HTTP switches are
                        experimental in the engine and can break after a Microsoft change.
                    </Typography>
                </Section>
            </Box>

            <ConfirmDialog
                open={confirmReset}
                title="Reset to defaults?"
                message="The settings on this page go back to the values of the engine's example config. A backup copy of config.json is made first. Other settings (webhooks, accounts, anything not shown on this page) are not touched."
                confirmLabel="Reset"
                onCancel={() => setConfirmReset(false)}
                onConfirm={() => {
                    setConfirmReset(false)
                    void run(() => api.resetEngineSettings())
                }}
            />
        </Box>
    )
}

// Secrets and API keys moved to their own page (SecretsPage, sidebar item "Secrets & API keys").
export function SettingsPage(props: {
    readonly farmer: FarmerStateHook
    readonly onDirtyChange?: ((dirty: boolean) => void) | undefined
}) {
    return <SettingsMain {...props} />
}
