import type { ActionResult, ThemeModeSetting } from './farmer-types'
import type { HealthStatus } from './health-types'

// Phase 22 (first half): types of the first-run setup wizard. Four steps: prerequisites, accounts location, basic settings,
// review. RULE: nothing in this file can hold a secret. The wizard never asks for a password, a cookie or an API key (those
// are typed on the Accounts and Secrets pages, locally). Results hold names, counts and plain sentences; the folder path of
// the accounts file stays in the main process.

export const WIZARD_STEPS = ['prerequisites', 'accounts', 'settings', 'review'] as const
export type WizardStepId = (typeof WIZARD_STEPS)[number]

export interface PrerequisiteRow {
    readonly id: string
    readonly title: string
    readonly status: HealthStatus
    readonly detail: string
    // What to do (only clicks and double-clicks). null when the row is fine.
    readonly fix: string | null
}

export interface PrerequisitesResult {
    // One row per prerequisite, always in the same order. Every row is the result of a real check run just now.
    readonly rows: readonly PrerequisiteRow[]
    // true = no row is red or unknown, so the wizard may go on.
    readonly canContinue: boolean
    // Plain sentences for the rows that stop the wizard.
    readonly blockers: readonly string[]
    readonly checkedAt: string
}

export interface AccountsChoice {
    readonly source: 'default' | 'pick'
    // File name only, never the folder.
    readonly fileName: string
    readonly accountCount: number
    // true = the app's own default file does not exist yet and is created (empty) when the wizard finishes.
    readonly willCreate: boolean
}

export type WizardRefusalStage =
    'bad-request' | 'locked' | 'blocked' | 'invalid' | 'not-confirmed' | 'not-ready' | 'apply-failed'

export interface WizardRefusal {
    readonly ok: false
    readonly stage: WizardRefusalStage
    readonly message: string
    // Plain-language next step. Never empty.
    readonly fix: string
    // true = the user closed the file dialog. Not an error.
    readonly cancelled: boolean
}

export type AccountsStepResult =
    | { readonly ok: true; readonly choice: AccountsChoice; readonly warnings: readonly string[] }
    | WizardRefusal

export interface BasicSettings {
    readonly theme: ThemeModeSetting
    // Engine setting "headless": run the browser without a window.
    readonly headless: boolean
    readonly timerEnabled: boolean
    // HH:MM, 24 hours.
    readonly timerTime: string
}

export type BasicSettingsField = keyof BasicSettings
export type BasicSettingsErrors = Partial<Record<BasicSettingsField, string>>

export type SettingsStepResult =
    | { readonly ok: true; readonly settings: BasicSettings }
    | (WizardRefusal & { readonly errors: BasicSettingsErrors })

export interface ReviewLine {
    readonly label: string
    readonly value: string
}

export interface WizardReview {
    readonly lines: readonly ReviewLine[]
    readonly warnings: readonly string[]
    readonly canFinish: boolean
}

export type WizardReviewResult = { readonly ok: true; readonly review: WizardReview } | WizardRefusal

// What the wizard did, step by step, when it was finished.
export type WizardApplyStep = 'accounts-file' | 'timer' | 'theme' | 'headless'

export type WizardFinishResult =
    | {
          readonly ok: true
          readonly message: string
          readonly finishedAt: string
          readonly doneSteps: readonly WizardApplyStep[]
          readonly notes: readonly string[]
      }
    | (WizardRefusal & {
          // Steps that were already done when it stopped. They stay done; the wizard can be run again.
          readonly doneSteps: readonly WizardApplyStep[]
      })

export interface WizardState {
    readonly prerequisitesOk: boolean
    readonly accounts: AccountsChoice | null
    readonly settings: BasicSettings | null
    readonly completed: boolean
    // The furthest step the user may open now.
    readonly furthestStep: WizardStepId
}

// What the main process needs from the app to apply the choices. The real wiring (FarmerService, EngineSettingsService) is
// the second half of Phase 22; tests give each port a stand-in (rule 18).
export interface WizardHost {
    useAccountsFile(path: string): Promise<ActionResult>
    setTimer(enabled: boolean, time: string): Promise<ActionResult>
    setTheme(mode: ThemeModeSetting): Promise<ActionResult>
    setHeadless(headless: boolean): Promise<ActionResult>
}

// Phase 22 (second half): the IPC channels and the renderer-facing API of the wizard. Nothing here takes a path: the file
// dialog is opened by the main process, and the choice is a word ('default' or 'pick'), never text from the screen.
export const WIZARD_IPC = {
    isFirstRun: 'wizard:is-first-run',
    getState: 'wizard:get-state',
    reset: 'wizard:reset',
    checkPrerequisites: 'wizard:check-prerequisites',
    chooseAccounts: 'wizard:choose-accounts',
    setSettings: 'wizard:set-settings',
    review: 'wizard:review',
    finish: 'wizard:finish'
} as const

export interface WizardApi {
    // true = this is the first start (no wizard finished, no accounts file set before the app started).
    wizardIsFirstRun(): Promise<boolean>
    wizardGetState(): Promise<WizardState>
    wizardReset(): Promise<WizardState>
    wizardCheckPrerequisites(): Promise<PrerequisitesResult>
    wizardChooseAccounts(source: 'default' | 'pick'): Promise<AccountsStepResult>
    wizardSetSettings(settings: BasicSettings): Promise<SettingsStepResult>
    wizardReview(): Promise<WizardReviewResult>
    wizardFinish(confirmed: boolean): Promise<WizardFinishResult>
}
