import { isValidTime } from './farmer-types'
import type { HealthCheck } from './health-types'
import type {
    AccountsChoice,
    BasicSettings,
    BasicSettingsErrors,
    PrerequisiteRow,
    PrerequisitesResult,
    ReviewLine,
    WizardReview,
    WizardState,
    WizardStepId
} from './wizard-types'
import { WIZARD_STEPS } from './wizard-types'

// Phase 22 (first half): the pure rules of the setup wizard. No file access, no React. Everything here can be tested alone.

export const WIZARD_INTRO =
    'This wizard checks your computer, lets you choose where your accounts file lives, and sets a few basic things. It changes nothing until you press Finish on the last step.'

export const NO_SECRETS_NOTE =
    'The wizard never asks for a password, a cookie or an API key. Add your accounts on the Accounts page and keys on the Secrets page after the wizard.'

export const FINISH_CONFIRM_TEXT =
    'I checked the summary and I want to apply these choices. My existing accounts file is not changed.'

// The health rows that matter before the first run, in screen order. The first four must be fine (not red, not unknown).
export const PREREQUISITE_IDS = ['node', 'git', 'engine-files', 'engine-packages', 'engine-built'] as const
const REQUIRED_IDS: ReadonlySet<string> = new Set(['node', 'engine-files', 'engine-packages', 'engine-built'])

export function evaluatePrerequisites(
    checks: readonly HealthCheck[],
    checkedAt: string
): PrerequisitesResult {
    const rows: PrerequisiteRow[] = []
    const blockers: string[] = []
    for (const id of PREREQUISITE_IDS) {
        const c = checks.find((x) => x.id === id)
        if (c === undefined) {
            rows.push({
                id,
                title: id,
                status: 'unknown',
                detail: 'This check did not run.',
                fix: 'Press Check again.'
            })
            if (REQUIRED_IDS.has(id)) blockers.push(`${id}: this check did not run.`)
            continue
        }
        rows.push({ id, title: c.title, status: c.status, detail: c.detail, fix: c.fix })
        const stops = REQUIRED_IDS.has(id) && (c.status === 'error' || c.status === 'unknown')
        if (stops) {
            blockers.push(
                c.status === 'unknown'
                    ? `${c.title}: could not be checked. ${c.detail}`
                    : `${c.title}: ${c.detail}`
            )
        }
    }
    return { rows, canContinue: blockers.length === 0, blockers, checkedAt }
}

// A path that came from the file dialog (or the default). Returns a problem sentence, or null when it looks like a usable path.
export function accountsPathProblem(path: unknown): string | null {
    if (typeof path !== 'string' || path === '') return 'No accounts file was chosen.'
    if (path.length > 1024) return 'The file path is too long.'
    if (path.includes('\u0000')) return 'The file path is not valid.'
    const absolute = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/')
    if (!absolute) return 'The file path must be a full path (starting with a drive letter such as C:\\).'
    return null
}

// File name only (never the folder), for the screen and the logs.
export function fileNameOf(path: string): string {
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] ?? ''
}

export type SettingsParse =
    | { readonly ok: true; readonly value: BasicSettings }
    | { readonly ok: false; readonly errors: BasicSettingsErrors }

// Renderer data is untrusted: every field is checked again. Extra keys are dropped, a wrong type is an error (never coerced).
export function validateBasicSettings(raw: unknown): SettingsParse {
    const errors: BasicSettingsErrors = {}
    const o =
        typeof raw === 'object' && raw !== null && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : null
    if (o === null) {
        return {
            ok: false,
            errors: {
                theme: 'The settings had an unexpected shape.',
                headless: 'The settings had an unexpected shape.',
                timerEnabled: 'The settings had an unexpected shape.',
                timerTime: 'The settings had an unexpected shape.'
            }
        }
    }
    const theme = o['theme']
    if (theme !== 'dark' && theme !== 'light') errors.theme = 'Choose dark or light.'
    if (typeof o['headless'] !== 'boolean') errors.headless = 'Choose on or off.'
    if (typeof o['timerEnabled'] !== 'boolean') errors.timerEnabled = 'Choose on or off.'
    const time = o['timerTime']
    if (typeof time !== 'string' || !isValidTime(time))
        errors.timerTime = 'Time must be HH:MM (24 hours), for example 08:30.'
    if (Object.keys(errors).length > 0) return { ok: false, errors }
    return {
        ok: true,
        value: {
            theme: theme as 'dark' | 'light',
            headless: o['headless'] as boolean,
            timerEnabled: o['timerEnabled'] as boolean,
            timerTime: time as string
        }
    }
}

export function stepIndex(step: WizardStepId): number {
    return WIZARD_STEPS.indexOf(step)
}

// The furthest step that may be opened: each step needs the one before it to be done.
export function furthestStep(s: {
    readonly prerequisitesOk: boolean
    readonly accounts: AccountsChoice | null
    readonly settings: BasicSettings | null
}): WizardStepId {
    if (!s.prerequisitesOk) return 'prerequisites'
    if (s.accounts === null) return 'accounts'
    if (s.settings === null) return 'settings'
    return 'review'
}

export function stepAllowed(step: WizardStepId, s: Pick<WizardState, 'furthestStep'>): boolean {
    return stepIndex(step) <= stepIndex(s.furthestStep)
}

export function buildReview(accounts: AccountsChoice, settings: BasicSettings): WizardReview {
    const lines: ReviewLine[] = [
        {
            label: 'Accounts file',
            value: `${accounts.fileName} (${
                accounts.willCreate
                    ? 'will be created, no account yet'
                    : `${String(accounts.accountCount)} account${accounts.accountCount === 1 ? '' : 's'}`
            })`
        },
        { label: 'Theme', value: settings.theme === 'dark' ? 'Dark' : 'Light' },
        { label: 'Browser window', value: settings.headless ? 'Hidden (headless)' : 'Visible' },
        {
            label: 'Daily timer',
            value: settings.timerEnabled ? `On, every day at ${settings.timerTime}` : 'Off'
        }
    ]
    const warnings: string[] = []
    if (accounts.accountCount === 0) {
        warnings.push(
            'The accounts file has no account yet. The engine cannot start a run until you add one on the Accounts page.'
        )
    }
    if (accounts.accountCount === 0) {
        warnings.push(
            'The browser window setting is saved through the engine, which starts only after you add an account. With no account yet it is not saved now: set it on the Settings page later.'
        )
    }
    if (settings.timerEnabled) {
        warnings.push(
            `The timer starts a run every day at ${settings.timerTime} only while this app is open.`
        )
    }
    return { lines, warnings, canFinish: true }
}
