import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ActionResult } from '../shared/farmer-types'
import type { HealthState } from '../shared/health-types'
import {
    FINISH_CONFIRM_TEXT,
    accountsPathProblem,
    buildReview,
    evaluatePrerequisites,
    fileNameOf,
    furthestStep,
    validateBasicSettings
} from '../shared/wizard-rules'
import type {
    AccountsChoice,
    AccountsStepResult,
    BasicSettings,
    PrerequisitesResult,
    SettingsStepResult,
    WizardApplyStep,
    WizardFinishResult,
    WizardHost,
    WizardRefusal,
    WizardRefusalStage,
    WizardReviewResult,
    WizardState
} from '../shared/wizard-types'
import { loadAccountsFile } from './engine/envFile'
import type { AccountsFileResult } from './engine/envFile'
import type { Redactor } from './engine/redact'
import type { JsonlLog } from './jsonlLog'

// First-run setup wizard, part 1 (Phase 22): the service behind the four steps (prerequisites, accounts location, basic
// settings, review). Part 2 adds the IPC, the preload bridge and the screens.
//
// RULES kept here
// - No secret is asked for, held or returned. The accounts file is only COUNTED (how many accounts), never read into a result.
//   The folder path of the accounts file stays in this class; results hold the file name only.
// - Nothing is changed before `finish(confirmed === true)`. The first three steps only read (real health checks, a real look
//   at the accounts file) and keep the choices in memory.
// - `finish` checks everything again, then applies the choices one step at a time through the app's own functions (the same ones
//   the Accounts, Home and Settings pages use). If a step fails it stops, and says which steps were already done. It never claims
//   more than it did.
// - Every renderer value is untrusted and is validated again here (see wizard-rules).

export interface WizardDeps {
    readonly health: { runChecks(): Promise<HealthState> }
    // The OS file dialog. null = the user closed it. The path never comes from renderer text.
    readonly pickAccountsFile: () => Promise<string | null>
    // The accounts file the app keeps in its own data folder.
    readonly defaultAccountsPath: string
    // The accounts file the app uses now (null = none yet). Used to tell a first run from an existing setup.
    readonly currentAccountsPath: () => string | null
    // Where the "wizard finished" marker is kept (names and a time only).
    readonly markerPath: string
    readonly host: WizardHost
    // null = nothing stops a change now. A string = why not (a run is active, the engine is busy).
    readonly runBlock: () => string | null
    readonly redactor: Redactor
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    readonly now?: () => Date
    // Tests replace these two (a failing disk, a file that is not there). The defaults are the real ones.
    readonly loadAccounts?: (path: string) => Promise<AccountsFileResult>
    readonly fileExists?: (path: string) => Promise<boolean>
}

const MARKER_FORMAT = 'rewards-farmer-setup-wizard'

async function realFileExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

const refusal = (
    stage: WizardRefusalStage,
    message: string,
    fix: string,
    cancelled = false
): WizardRefusal => ({ ok: false, stage, message, fix, cancelled })

export class SetupWizardService {
    private prerequisitesOk = false
    private accounts: (AccountsChoice & { readonly path: string }) | null = null
    private settings: BasicSettings | null = null
    private completed = false
    // Decided ONCE at app start, before the app creates its own accounts file (otherwise every start would look like a used app).
    private firstRun = false
    private queue: Promise<unknown> = Promise.resolve()

    constructor(private readonly deps: WizardDeps) {}

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date()
    }

    private loadAccounts(path: string): Promise<AccountsFileResult> {
        return (this.deps.loadAccounts ?? loadAccountsFile)(path)
    }

    private exists(path: string): Promise<boolean> {
        return (this.deps.fileExists ?? realFileExists)(path)
    }

    // ---- first run? ------------------------------------------------------------------------------------------------

    // First run = the wizard never finished AND no accounts file is set. Someone who already works with the app is not pushed
    // into the wizard (they can still open it by hand).
    async isFirstRun(): Promise<boolean> {
        if (this.deps.currentAccountsPath() !== null) return false
        return !(await this.exists(this.deps.markerPath))
    }

    // Called once at start, before the app makes its own accounts file. The answer is kept for this session.
    async detectFirstRun(): Promise<boolean> {
        this.firstRun = await this.isFirstRun()
        return this.firstRun
    }

    // true = offer the wizard now: it was a first start and the wizard has not been finished in this session.
    needsWizard(): boolean {
        return this.firstRun && !this.completed
    }

    // What the screen may show now. Holds no path and no secret.
    getState(): WizardState {
        const base = {
            prerequisitesOk: this.prerequisitesOk,
            accounts: this.accounts,
            settings: this.settings
        }
        return {
            prerequisitesOk: this.prerequisitesOk,
            accounts: this.accounts === null ? null : publicChoice(this.accounts),
            settings: this.settings,
            completed: this.completed,
            furthestStep: furthestStep(base)
        }
    }

    // Starts again from step 1. Changes no file.
    reset(): WizardState {
        this.prerequisitesOk = false
        this.accounts = null
        this.settings = null
        this.completed = false
        return this.getState()
    }

    // ---- step 1: prerequisites -------------------------------------------------------------------------------------

    // Real checks, run now (the same ones as the Health page). Going back and checking again is always allowed.
    async checkPrerequisites(): Promise<PrerequisitesResult> {
        const health = await this.deps.health.runChecks()
        const result = evaluatePrerequisites(health.checks, health.finishedAt ?? this.now().toISOString())
        this.prerequisitesOk = result.canContinue
        if (!result.canContinue) {
            // Later choices rested on a good computer check; they are asked again.
            this.accounts = null
            this.settings = null
        }
        this.audit(
            result.canContinue ? 'info' : 'warn',
            'prerequisites',
            result.canContinue ? 'ok' : 'blocked',
            `Prerequisites checked: ${String(result.blockers.length)} blocker(s).`
        )
        return result
    }

    // ---- step 2: accounts location ---------------------------------------------------------------------------------

    async chooseAccounts(source: unknown): Promise<AccountsStepResult> {
        if (source !== 'default' && source !== 'pick') {
            return refusal(
                'bad-request',
                'That is not a valid choice.',
                'Choose "Use the app\'s own file" or "Choose a file".'
            )
        }
        if (!this.prerequisitesOk) {
            return refusal(
                'locked',
                'The computer check is not finished yet.',
                'Go back to step 1 and press Check until it passes.'
            )
        }
        const block = this.deps.runBlock()
        if (block !== null) {
            return refusal(
                'blocked',
                block,
                'Stop the run or wait until the engine is ready, then try again.'
            )
        }

        let path: string | null
        if (source === 'default') {
            path = this.deps.defaultAccountsPath
        } else {
            try {
                path = await this.deps.pickAccountsFile()
            } catch {
                return refusal(
                    'invalid',
                    'The file dialog could not be opened.',
                    "Try again, or use the app's own file."
                )
            }
            if (path === null) {
                return refusal(
                    'invalid',
                    'No file was chosen.',
                    "Choose a file, or use the app's own file.",
                    true
                )
            }
        }

        const checked = await this.checkAccountsPath(path, source)
        if (!checked.ok) return checked
        this.accounts = { ...checked.choice, path }
        // Settings may have been chosen for another file; they stay (they do not depend on the file), the review is rebuilt.
        this.audit(
            'info',
            'accounts-chosen',
            'ok',
            `Accounts file chosen (${source}), ${String(checked.choice.accountCount)} account(s).`
        )
        return { ok: true, choice: checked.choice, warnings: checked.warnings }
    }

    // One look at a path. Used when it is chosen and again when the wizard finishes (the file may have changed since).
    private async checkAccountsPath(
        path: string,
        source: 'default' | 'pick'
    ): Promise<
        | { readonly ok: true; readonly choice: AccountsChoice; readonly warnings: readonly string[] }
        | WizardRefusal
    > {
        const bad = accountsPathProblem(path)
        if (bad !== null) return refusal('invalid', bad, 'Choose the file again.')
        const isDefault = source === 'default' && path === this.deps.defaultAccountsPath
        const present = await this.exists(path)
        if (!present) {
            if (isDefault) {
                return {
                    ok: true,
                    choice: { source, fileName: fileNameOf(path), accountCount: 0, willCreate: true },
                    warnings: [
                        "The app's own accounts file does not exist yet. It is created empty when you finish; add your accounts on the Accounts page."
                    ]
                }
            }
            return refusal(
                'invalid',
                'The accounts file does not exist (moved or deleted?).',
                'Choose the file again.'
            )
        }
        const loaded = await this.loadAccounts(path)
        if (loaded.ok) {
            return {
                ok: true,
                choice: {
                    source,
                    fileName: fileNameOf(path),
                    accountCount: loaded.file.accountCount,
                    willCreate: false
                },
                warnings: []
            }
        }
        if (loaded.empty === true && isDefault) {
            return {
                ok: true,
                choice: { source, fileName: fileNameOf(path), accountCount: 0, willCreate: false },
                warnings: ['The accounts file has no account yet. Add your accounts on the Accounts page.']
            }
        }
        return refusal(
            'invalid',
            this.deps.redactor.redact(loaded.message),
            loaded.empty === true
                ? 'This file has no account in it, so it may be the wrong file. Choose another file.'
                : 'Choose another file, or fix this one on the Accounts page later.'
        )
    }

    // ---- step 3: basic settings ------------------------------------------------------------------------------------

    setBasicSettings(raw: unknown): SettingsStepResult {
        if (this.accounts === null) {
            return {
                ...refusal(
                    'locked',
                    'The accounts file is not chosen yet.',
                    'Go back to step 2 and choose it.'
                ),
                errors: {}
            }
        }
        const parsed = validateBasicSettings(raw)
        if (!parsed.ok) {
            const first = Object.values(parsed.errors)[0] ?? 'Check the settings.'
            this.audit(
                'warn',
                'settings-refused',
                'invalid',
                'The basic settings were refused (invalid value).'
            )
            return {
                ...refusal('invalid', first, 'Correct the marked setting and press Next again.'),
                errors: parsed.errors
            }
        }
        this.settings = parsed.value
        this.audit('info', 'settings-chosen', 'ok', 'Basic settings chosen.')
        return { ok: true, settings: parsed.value }
    }

    // ---- step 4: review --------------------------------------------------------------------------------------------

    review(): WizardReviewResult {
        if (!this.prerequisitesOk || this.accounts === null || this.settings === null) {
            return refusal(
                'not-ready',
                'Some steps are not finished yet.',
                'Go back and finish the earlier steps.'
            )
        }
        return { ok: true, review: buildReview(publicChoice(this.accounts), this.settings) }
    }

    // ---- finish ----------------------------------------------------------------------------------------------------

    // One at a time. Changes nothing unless `confirmed` is exactly true.
    finish(confirmed: unknown): Promise<WizardFinishResult> {
        const next = this.queue.then(
            () => this.runFinish(confirmed),
            () => this.runFinish(confirmed)
        )
        this.queue = next.catch(() => undefined)
        return next
    }

    private async runFinish(confirmed: unknown): Promise<WizardFinishResult> {
        if (confirmed !== true) {
            return {
                ...refusal(
                    'not-confirmed',
                    'The confirmation is missing, so nothing was changed.',
                    `Tick the box "${FINISH_CONFIRM_TEXT}" and press Finish again.`
                ),
                doneSteps: []
            }
        }
        const accounts = this.accounts
        const settings = this.settings
        if (!this.prerequisitesOk || accounts === null || settings === null) {
            return {
                ...refusal(
                    'not-ready',
                    'Some steps are not finished yet, so nothing was changed.',
                    'Go back and finish the earlier steps.'
                ),
                doneSteps: []
            }
        }
        const block = this.deps.runBlock()
        if (block !== null) {
            return {
                ...refusal(
                    'blocked',
                    `${block} Nothing was changed.`,
                    'Stop the run or wait until the engine is ready, then press Finish again.'
                ),
                doneSteps: []
            }
        }

        // Everything is checked again from scratch: the computer, the file and the settings may have changed.
        const prereq = await this.checkPrerequisites()
        if (!prereq.canContinue) {
            return {
                ...refusal(
                    'not-ready',
                    `The computer check no longer passes (${prereq.blockers[0] ?? 'see step 1'}). Nothing was changed.`,
                    'Go back to step 1, fix the problem, and check again.'
                ),
                doneSteps: []
            }
        }
        const again = await this.checkAccountsPath(accounts.path, accounts.source)
        if (!again.ok) {
            this.accounts = null
            return { ...again, doneSteps: [], message: `${again.message} Nothing was changed.` }
        }
        const recheck = validateBasicSettings(settings)
        if (!recheck.ok) {
            return {
                ...refusal(
                    'invalid',
                    'The basic settings are not valid. Nothing was changed.',
                    'Go back to step 3.'
                ),
                doneSteps: []
            }
        }

        const done: WizardApplyStep[] = []
        const notes: string[] = []
        const steps: ReadonlyArray<readonly [WizardApplyStep, string, () => Promise<ActionResult>]> = [
            ['accounts-file', 'the accounts file', () => this.deps.host.useAccountsFile(accounts.path)],
            ['timer', 'the timer', () => this.deps.host.setTimer(settings.timerEnabled, settings.timerTime)],
            ['theme', 'the theme', () => this.deps.host.setTheme(settings.theme)],
            ['headless', 'the browser window setting', () => this.deps.host.setHeadless(settings.headless)]
        ]
        for (const [id, what, run] of steps) {
            let outcome: ActionResult
            try {
                outcome = await run()
            } catch (e) {
                outcome = { ok: false, message: e instanceof Error ? e.message : 'unknown error' }
            }
            // The browser window setting lives in the engine's config.json and is written through the running engine. With no
            // account yet the engine is not started, so it cannot be written now. That is not a failure of the wizard: say so
            // honestly (a note, and the step is NOT listed as done) and let the user set it on the Settings page later.
            if (
                !outcome.ok &&
                id === 'headless' &&
                (outcome.code === 'ENGINE_DOWN' || outcome.code === 'CONFIG_MISSING')
            ) {
                notes.push(
                    'The browser window setting was NOT saved yet: the engine is not running (it starts after you add an account). Set it on the Settings page later.'
                )
                continue
            }
            if (!outcome.ok) {
                const detail = this.deps.redactor.redact(outcome.message)
                const doneText =
                    done.length === 0
                        ? 'No setting was changed.'
                        : `These steps were already done and stay as they are: ${done.join(', ')}.`
                this.audit('error', 'apply-failed', id, `Wizard stopped at ${id}. ${doneText}`)
                return {
                    ...refusal(
                        'apply-failed',
                        `Could not set ${what}: ${detail} ${doneText}`,
                        'Fix the problem named above, then run the wizard again. Steps that were done are checked again and are harmless to repeat.'
                    ),
                    doneSteps: [...done]
                }
            }
            done.push(id)
        }

        // Only after every step worked: the marker, so the wizard is not offered again at the next start.
        try {
            await this.writeMarker(done)
        } catch {
            notes.push(
                'Your choices are saved, but the app could not remember that the wizard is finished, so it may be offered again at the next start.'
            )
        }
        this.completed = true
        const finishedAt = this.now().toISOString()
        this.audit('info', 'finished', 'ok', `Wizard finished: ${done.join(', ')}.`)
        return {
            ok: true,
            message: `Setup finished: ${String(done.length)} step(s) applied and checked.`,
            finishedAt,
            doneSteps: done,
            notes
        }
    }

    // A small record (format, time, step names). No path, no e-mail, no secret. Written whole, then renamed.
    private async writeMarker(steps: readonly WizardApplyStep[]): Promise<void> {
        const text = `${JSON.stringify({ format: MARKER_FORMAT, finishedAt: this.now().toISOString(), steps }, null, 2)}\n`
        await mkdir(dirname(this.deps.markerPath), { recursive: true })
        const temp = `${this.deps.markerPath}.${randomBytes(4).toString('hex')}.tmp`
        try {
            await writeFile(temp, text, 'utf8')
            await rename(temp, this.deps.markerPath)
        } catch (e) {
            await rm(temp, { force: true }).catch(() => undefined)
            throw e
        }
    }

    private audit(level: 'info' | 'warn' | 'error', action: string, result: string, message: string): void {
        this.deps.audit.write({
            level,
            component: 'Wizard',
            action: `wizard-${action}`,
            result,
            message: this.deps.redactor.redact(message)
        })
    }
}

function publicChoice(c: AccountsChoice & { readonly path?: string }): AccountsChoice {
    return { source: c.source, fileName: c.fileName, accountCount: c.accountCount, willCreate: c.willCreate }
}
