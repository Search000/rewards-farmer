import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useState } from 'react'
import type { HealthStatus } from '../../shared/health-types'
import { FINISH_CONFIRM_TEXT, NO_SECRETS_NOTE, WIZARD_INTRO } from '../../shared/wizard-rules'
import type {
    AccountsStepResult,
    BasicSettings,
    BasicSettingsErrors,
    PrerequisitesResult,
    SettingsStepResult,
    WizardFinishResult,
    WizardReview,
    WizardStepId
} from '../../shared/wizard-types'
import { WIZARD_STEPS } from '../../shared/wizard-types'
import { ActionButton } from '../components/ActionButton'
import { PageCard } from '../components/PageCard'
import { StateBlock } from '../components/StateBlock'
import { ToggleSwitch } from '../components/ToggleSwitch'
import type { FarmerStateHook } from '../hooks/useFarmerState'
import type { ThemeMode } from '../tokens'

// Phase 22: the first-run setup wizard (screens). Four steps: computer check, accounts file, basic settings, review.
// Every number, status and sentence on these screens comes from the main process (real health checks, a real look at the
// accounts file). Nothing is written before the last step, after the box is ticked and Finish is pressed. No password, cookie or
// API key is asked for here (those are typed on the Accounts and Secrets pages).

const STEP_TITLES: Record<WizardStepId, string> = {
    prerequisites: 'Check this computer',
    accounts: 'Accounts file',
    settings: 'Basic settings',
    review: 'Review and finish'
}

const STATUS_TEXT: Record<HealthStatus, string> = {
    ok: 'OK',
    warning: 'Warning',
    error: 'Problem',
    unknown: 'Unknown'
}
const STATUS_COLOR: Record<HealthStatus, 'success' | 'warning' | 'error' | 'default'> = {
    ok: 'success',
    warning: 'warning',
    error: 'error',
    unknown: 'default'
}

interface Props {
    readonly farmer: FarmerStateHook
    readonly mode: ThemeMode
    // Called after Finish worked, so the window changes to the chosen theme at once.
    readonly onThemeApplied: (mode: ThemeMode) => void
    // "Not now" and "Go to Home".
    readonly onLeave: () => void
}

const lostAnswer = (what: string, e: unknown): string =>
    `${what} could not be done or its answer was lost${e instanceof Error ? ` (${e.message})` : ''}. Nothing was changed by this step. Try again.`

export function WizardPage({ farmer, mode, onThemeApplied, onLeave }: Props) {
    const { api } = farmer
    const [step, setStep] = useState<WizardStepId>('prerequisites')

    const [prereq, setPrereq] = useState<PrerequisitesResult | null>(null)
    const [checking, setChecking] = useState(false)
    const [prereqError, setPrereqError] = useState<string | null>(null)

    const [accounts, setAccounts] = useState<AccountsStepResult | null>(null)
    const [choosing, setChoosing] = useState(false)
    const [accountsError, setAccountsError] = useState<string | null>(null)

    const [draft, setDraft] = useState<BasicSettings>({
        theme: mode,
        headless: false,
        timerEnabled: false,
        timerTime: '08:00'
    })
    const [fieldErrors, setFieldErrors] = useState<BasicSettingsErrors>({})
    const [settingsError, setSettingsError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const [review, setReview] = useState<WizardReview | null>(null)
    const [reviewError, setReviewError] = useState<string | null>(null)
    const [confirmed, setConfirmed] = useState(false)
    const [finishing, setFinishing] = useState(false)
    const [outcome, setOutcome] = useState<WizardFinishResult | null>(null)
    const [finishError, setFinishError] = useState<string | null>(null)

    const runCheck = useCallback(async (): Promise<void> => {
        if (api === null) return
        setChecking(true)
        setPrereqError(null)
        try {
            setPrereq(await api.wizardCheckPrerequisites())
        } catch (e: unknown) {
            setPrereq(null)
            setPrereqError(lostAnswer('The computer check', e))
        } finally {
            setChecking(false)
        }
    }, [api])

    // Real checks run when the wizard opens (the same ones as the Health page).
    useEffect(() => {
        void runCheck()
    }, [runCheck])

    if (api === null) {
        return (
            <PageCard title="Setup wizard">
                <Alert severity="info">
                    The setup wizard works only inside the desktop app. This page is open outside it, so there
                    is nothing to set up.
                </Alert>
            </PageCard>
        )
    }

    const chooseAccounts = async (source: 'default' | 'pick'): Promise<void> => {
        if (choosing) return
        setChoosing(true)
        setAccountsError(null)
        try {
            setAccounts(await api.wizardChooseAccounts(source))
        } catch (e: unknown) {
            setAccounts(null)
            setAccountsError(lostAnswer('Choosing the accounts file', e))
        } finally {
            setChoosing(false)
        }
    }

    const saveSettings = async (): Promise<void> => {
        if (saving) return
        setSaving(true)
        setSettingsError(null)
        setFieldErrors({})
        try {
            const res: SettingsStepResult = await api.wizardSetSettings(draft)
            if (res.ok) {
                await loadReview()
            } else {
                setFieldErrors(res.errors)
                setSettingsError(`${res.message} ${res.fix}`)
            }
        } catch (e: unknown) {
            setSettingsError(lostAnswer('Saving the basic settings', e))
        } finally {
            setSaving(false)
        }
    }

    const loadReview = async (): Promise<void> => {
        setReviewError(null)
        setReview(null)
        setConfirmed(false)
        setOutcome(null)
        setFinishError(null)
        try {
            const res = await api.wizardReview()
            if (res.ok) {
                setReview(res.review)
                setStep('review')
            } else {
                setReviewError(`${res.message} ${res.fix}`)
                setStep('review')
            }
        } catch (e: unknown) {
            setReviewError(lostAnswer('The review', e))
            setStep('review')
        }
    }

    const finish = async (): Promise<void> => {
        if (finishing || !confirmed) return
        setFinishing(true)
        setFinishError(null)
        try {
            // `true` is sent only from this button, and only after the box is ticked.
            const res = await api.wizardFinish(true)
            setOutcome(res)
            if (res.ok) onThemeApplied(draft.theme)
        } catch (e: unknown) {
            setFinishError(
                `The setup could not be finished or its answer was lost${e instanceof Error ? ` (${e.message})` : ''}. Some steps may have been applied: check Home, Settings and Accounts, then run the wizard again.`
            )
        } finally {
            setFinishing(false)
        }
    }

    const activeIndex = WIZARD_STEPS.indexOf(step)
    const finished = outcome !== null && outcome.ok

    return (
        <PageCard title="Setup wizard">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {WIZARD_INTRO}
            </Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
                {NO_SECRETS_NOTE}
            </Alert>

            <Stepper
                activeStep={finished ? WIZARD_STEPS.length : activeIndex}
                alternativeLabel
                sx={{ mb: 3 }}
            >
                {WIZARD_STEPS.map((id) => (
                    <Step key={id}>
                        <StepLabel>{STEP_TITLES[id]}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            <Box aria-live="polite">
                {step === 'prerequisites' && (
                    <Box>
                        <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
                            {STEP_TITLES.prerequisites}
                        </Typography>
                        {checking && prereq === null && (
                            <StateBlock state="loading" message="Checking this computer…" />
                        )}
                        {prereqError !== null && (
                            <StateBlock
                                state="error"
                                message={prereqError}
                                retryLabel="Check again"
                                onRetry={() => void runCheck()}
                            />
                        )}
                        {prereq !== null && (
                            <Box>
                                {prereq.rows.map((row) => (
                                    <Box
                                        key={row.id}
                                        sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 0.75 }}
                                    >
                                        <Chip
                                            size="small"
                                            label={STATUS_TEXT[row.status]}
                                            color={STATUS_COLOR[row.status]}
                                            sx={{ minWidth: 76 }}
                                        />
                                        <Box>
                                            <Typography variant="body1">{row.title}</Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                {row.detail}
                                            </Typography>
                                            {row.fix !== null && (
                                                <Typography variant="body2">What to do: {row.fix}</Typography>
                                            )}
                                        </Box>
                                    </Box>
                                ))}
                                {!prereq.canContinue && (
                                    <Alert severity="error" sx={{ mt: 1.5 }}>
                                        The wizard cannot go on yet. {prereq.blockers.join(' ')}
                                    </Alert>
                                )}
                                {prereq.canContinue && (
                                    <Alert severity="success" sx={{ mt: 1.5 }}>
                                        This computer is ready. You can go to the next step.
                                    </Alert>
                                )}
                            </Box>
                        )}
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 2, justifyContent: 'space-between' }}>
                            <Button onClick={onLeave}>Not now</Button>
                            <Box sx={{ display: 'flex', gap: 1.5 }}>
                                <Button
                                    variant="outlined"
                                    disabled={checking}
                                    onClick={() => void runCheck()}
                                >
                                    Check again
                                </Button>
                                <ActionButton
                                    variant="pill"
                                    label="Next"
                                    onClick={() => setStep('accounts')}
                                    {...(prereq?.canContinue === true
                                        ? {}
                                        : { disabledReason: 'The computer check has to pass first.' })}
                                />
                            </Box>
                        </Box>
                    </Box>
                )}

                {step === 'accounts' && (
                    <Box>
                        <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
                            {STEP_TITLES.accounts}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                            Your accounts live in one .env file. Use the file the app keeps for you, or choose
                            a file you already have. The wizard only counts the accounts; it never shows or
                            changes them.
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
                            <Button
                                variant="outlined"
                                disabled={choosing}
                                onClick={() => void chooseAccounts('default')}
                            >
                                Use the app&apos;s own file
                            </Button>
                            <Button
                                variant="outlined"
                                disabled={choosing}
                                onClick={() => void chooseAccounts('pick')}
                            >
                                Choose a file…
                            </Button>
                        </Box>
                        {accountsError !== null && <Alert severity="error">{accountsError}</Alert>}
                        {accounts !== null && accounts.ok && (
                            <Box>
                                <Alert severity="success" sx={{ mb: 1 }}>
                                    {accounts.choice.fileName}:{' '}
                                    {accounts.choice.willCreate
                                        ? 'will be created when you finish (no account yet).'
                                        : `${String(accounts.choice.accountCount)} account${accounts.choice.accountCount === 1 ? '' : 's'} found.`}
                                </Alert>
                                {accounts.warnings.map((w) => (
                                    <Alert key={w} severity="warning" sx={{ mb: 1 }}>
                                        {w}
                                    </Alert>
                                ))}
                            </Box>
                        )}
                        {accounts !== null && !accounts.ok && (
                            <Alert severity={accounts.cancelled ? 'info' : 'error'}>
                                {accounts.message} {accounts.fix}
                            </Alert>
                        )}
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 2, justifyContent: 'space-between' }}>
                            <Button onClick={() => setStep('prerequisites')}>Back</Button>
                            <ActionButton
                                variant="pill"
                                label="Next"
                                onClick={() => setStep('settings')}
                                {...(accounts !== null && accounts.ok
                                    ? {}
                                    : { disabledReason: 'Choose the accounts file first.' })}
                            />
                        </Box>
                    </Box>
                )}

                {step === 'settings' && (
                    <Box>
                        <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
                            {STEP_TITLES.settings}
                        </Typography>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                            Theme
                        </Typography>
                        <RadioGroup
                            row
                            aria-label="Theme"
                            value={draft.theme}
                            onChange={(e) =>
                                setDraft({ ...draft, theme: e.target.value === 'light' ? 'light' : 'dark' })
                            }
                        >
                            <FormControlLabel value="dark" control={<Radio />} label="Dark" />
                            <FormControlLabel value="light" control={<Radio />} label="Light" />
                        </RadioGroup>
                        {fieldErrors.theme !== undefined && (
                            <Alert severity="error">{fieldErrors.theme}</Alert>
                        )}
                        <Box sx={{ my: 1 }}>
                            <ToggleSwitch
                                label="Hide the browser window while farming (headless)"
                                checked={draft.headless}
                                onChange={(headless) => setDraft({ ...draft, headless })}
                            />
                            {fieldErrors.headless !== undefined && (
                                <Alert severity="error">{fieldErrors.headless}</Alert>
                            )}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                            <ToggleSwitch
                                label="Start automatically every day"
                                checked={draft.timerEnabled}
                                onChange={(timerEnabled) => setDraft({ ...draft, timerEnabled })}
                            />
                            <TextField
                                label="Time (24 hours)"
                                type="time"
                                value={draft.timerTime}
                                onChange={(e) => setDraft({ ...draft, timerTime: e.target.value })}
                                error={fieldErrors.timerTime !== undefined}
                                helperText={
                                    fieldErrors.timerTime ?? 'The timer works only while this app is open.'
                                }
                                slotProps={{ inputLabel: { shrink: true } }}
                            />
                        </Box>
                        {fieldErrors.timerEnabled !== undefined && (
                            <Alert severity="error">{fieldErrors.timerEnabled}</Alert>
                        )}
                        {settingsError !== null && (
                            <Alert severity="error" sx={{ mt: 1.5 }}>
                                {settingsError}
                            </Alert>
                        )}
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 2, justifyContent: 'space-between' }}>
                            <Button onClick={() => setStep('accounts')}>Back</Button>
                            <ActionButton
                                variant="pill"
                                label="Next"
                                busy={saving}
                                onClick={() => void saveSettings()}
                            />
                        </Box>
                    </Box>
                )}

                {step === 'review' && (
                    <Box>
                        <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
                            {STEP_TITLES.review}
                        </Typography>
                        {reviewError !== null && <Alert severity="error">{reviewError}</Alert>}
                        {review !== null && !finished && (
                            <Box>
                                {review.lines.map((line) => (
                                    <Box
                                        key={line.label}
                                        sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}
                                    >
                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                            {line.label}
                                        </Typography>
                                        <Typography variant="body2">{line.value}</Typography>
                                    </Box>
                                ))}
                                {review.warnings.map((w) => (
                                    <Alert key={w} severity="warning" sx={{ mt: 1 }}>
                                        {w}
                                    </Alert>
                                ))}
                                <FormControlLabel
                                    sx={{ mt: 1.5 }}
                                    control={
                                        <Checkbox
                                            checked={confirmed}
                                            disabled={finishing}
                                            onChange={(e) => setConfirmed(e.target.checked)}
                                        />
                                    }
                                    label={FINISH_CONFIRM_TEXT}
                                />
                            </Box>
                        )}
                        {finishError !== null && (
                            <Alert severity="error" sx={{ mt: 1.5 }}>
                                {finishError}
                            </Alert>
                        )}
                        {outcome !== null && outcome.ok && (
                            <Box sx={{ mt: 1.5 }}>
                                <Alert severity="success">
                                    {outcome.message} Steps done: {outcome.doneSteps.join(', ')}.
                                </Alert>
                                {outcome.notes.map((n) => (
                                    <Alert key={n} severity="warning" sx={{ mt: 1 }}>
                                        {n}
                                    </Alert>
                                ))}
                            </Box>
                        )}
                        {outcome !== null && !outcome.ok && (
                            <Alert severity="error" sx={{ mt: 1.5 }}>
                                {outcome.message} {outcome.fix}
                                {outcome.doneSteps.length > 0 &&
                                    ` Already done and kept: ${outcome.doneSteps.join(', ')}.`}
                            </Alert>
                        )}
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 2, justifyContent: 'space-between' }}>
                            {finished ? (
                                <span />
                            ) : (
                                <Button disabled={finishing} onClick={() => setStep('settings')}>
                                    Back
                                </Button>
                            )}
                            {finished ? (
                                <ActionButton variant="pill" label="Go to Home" onClick={onLeave} />
                            ) : (
                                <ActionButton
                                    variant="pill"
                                    label="Finish"
                                    busy={finishing}
                                    onClick={() => void finish()}
                                    {...(review !== null && confirmed
                                        ? {}
                                        : {
                                              disabledReason:
                                                  review === null
                                                      ? 'The review is not ready.'
                                                      : 'Tick the box above to confirm.'
                                          })}
                                />
                            )}
                        </Box>
                    </Box>
                )}
            </Box>
        </PageCard>
    )
}
