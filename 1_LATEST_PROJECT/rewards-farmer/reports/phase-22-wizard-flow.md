# Phase 22 - First-run setup wizard: flow (part 1 + part 2 + completion; see the end)

Status: **half done on purpose.** Part 1 = the rules and the service behind the wizard (everything that decides and writes).
Part 2 = the screens and the wiring into the app. Phase 22 is NOT finished and NOT approved as a whole.

## Done in part 1
- `src/shared/wizard-types.ts`: steps (prerequisites, accounts location, basic settings, review), results, refusals, `WizardHost` (what the app must offer to apply the choices).
- `src/shared/wizard-rules.ts` (pure): prerequisite evaluation from the real Health rows (Node, engine files, engine packages and engine build must be fine; Git may be a warning; a row that is red, unknown or did not run stops the wizard), accounts path check, strict basic-settings validation (wrong type = error, extra keys dropped, time HH:MM), step gating, review lines and warnings.
- `src/main/setupWizard.ts` (`SetupWizardService`): `isFirstRun`, `getState`, `reset`, `checkPrerequisites`, `chooseAccounts('default' | 'pick')`, `setBasicSettings`, `review`, `finish(confirmed)`.
  - Steps 1 to 3 only read and keep choices in memory. Nothing is written before `finish(confirmed === true)`.
  - `finish` checks the computer, the accounts file and the settings again, then applies in order: accounts file, timer, theme, headless. If a step fails it stops, names the steps already done, writes no marker, and the wizard can run again.
  - Marker `setup-wizard.json` (format, time, step names only) is written after every step worked. If it cannot be written, the choices stay applied and a note says so.
  - No password, cookie or API key is asked for, held or returned. Accounts are only counted. Results hold the file name, never the folder or an e-mail. Error texts and audit lines go through the redactor.

## Tests (real files in a temp folder; health and the app's setters are stand-ins, tests only)
- `tests/wizard-rules.test.ts`: 46 tests. `tests/main/setup-wizard.test.ts`: 55 tests (happy path, invalid input at every step, locked steps, dialog cancelled, wrong/missing/empty/relative file, run active, file changed after choosing, computer check failing at the end, failing step, throwing step, marker not writable, two finishes at once, no secret in results or logs).

## Commands run and observed results (Linux sandbox, Node 24.22.0)
- `tsc --noEmit`: exit 0. `eslint .`: exit 0. `prettier --check .`: pass.
- vitest on wizard-rules, setup-wizard, restore-apply, restore, repo-hygiene, no-typed-commands, launchers: 7 files, 224 tests passed.
- The whole suite was NOT re-run after part 1 (it passed after Phase 21: 58 files, 957 tests). START.bat / TEST.bat: NOT TESTED (no Windows here).

## NOT done yet (part 2)
1. IPC channels, preload bridge, `FarmerShellApi` entries and test-bridge stubs.
2. Main wiring: the `WizardHost` on real code (`FarmerService` needs a public "use this accounts file" step; theme; headless through the engine settings service), `markerPath`, `runBlock`, and the first-run check at start.
3. The four wizard screens, first-run redirect, Back/Next, confirmation box, result and failure boxes.
4. Renderer tests, one test against the real services, screenshots (none taken: NOT VERIFIED on screen), final phase report.

## Verdict
Part 1 code complete and tested. STOP. Phase 22 is half done; Phase 23 not started.


---

# PART 2 (added 2026-10-16)

## Done in part 2
- `src/shared/wizard-types.ts`: `WIZARD_IPC`, `WizardApi`; `ipc-types.ts`: `FarmerShellApi` extends `WizardApi`.
- `src/main/ipc.ts`, `src/preload/preload.ts`: 8 wizard channels. No channel takes a path; `chooseAccounts` takes the word `default` or `pick`; `finish` takes the confirmation (service refuses unless exactly `true`).
- `src/main/main.ts`: `SetupWizardService` built on the real services (FarmerService, settings store, EngineSettingsService, HealthService); one shared file dialog; first-run answer taken BEFORE `farmer.init()`.
- `src/main/farmer.ts`: `wizardBlock()`, `useAccountsFile(path)` (creates the app's own file only if missing, never overwrites; saves the path only after the file loaded).
- `src/main/engineSettings.ts`: `setHeadless(bool)` (same backup + engine validation + read-back as Save).
- `src/main/setupWizard.ts`: `detectFirstRun()`, `needsWizard()`; if the headless step fails with ENGINE_DOWN or CONFIG_MISSING (no account yet, engine not started) the wizard still finishes, the step is NOT listed as done, and a note says it was not saved. Any other failure still stops the wizard. `wizard-rules.ts`: review warning for the same case.
- BUG FOUND AND FIXED: `farmer.init()` creates the app's own accounts file, so a live "is there an accounts path" check would never see a first run.
- Renderer: `pages/WizardPage.tsx` (4 steps, Back/Next, tick box before Finish, failure/result boxes), route `#/setup` (not in the sidebar; opens by itself on a first run; "Not now" leaves without writing), theme applied at once after Finish.
- Tests: new cases in `tests/wizard-rules.test.ts` and `tests/main/setup-wizard.test.ts`; new `tests/main/wizard.integration.test.ts` (real FarmerService + real engine API); wizard stubs added to the renderer test bridges.

## Checked (sandbox: Linux, Node 22, no real Vitest)
- Run with a small stand-in for Vitest (NOT the real one): wizard-rules + setup-wizard: 113 passed, 0 failed.
- wizard.integration.test.ts: 7 of 7 passed, but only in a scratch copy where the engine's Node 24 check was lowered to 22 (the sandbox has Node 22). Not run with Node 24.
- `tsc` did NOT really run (no @types/node, no vite/client, no MUI in the sandbox).

## NOT TESTED / NOT DONE
- Real Vitest, ESLint, Prettier, full `tsc`, build: NOT RUN. Run TEST.bat on Windows (and FORMAT.bat first if Prettier complains).
- `WizardPage.tsx` was never rendered: no renderer test written, no screenshot, no Electron window. NOT VERIFIED on screen.
- START.bat / TEST.bat: NOT TESTED (no Windows).
- No way yet to open the wizard again by hand except `#/setup` (re-run is Phase 23).

## Verdict
PARTIAL. Code for the whole flow exists and the service layer is tested; the screens are unverified. Phase 23 not started.
I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.


---

# COMPLETION (2026-10-16): real checks of part 2 and the missing renderer tests

The "Checked" and "NOT TESTED" lines of part 2 above were written in a sandbox without the real tools. They are replaced by this section.

## Added now
- `tests/renderer/wizard.test.tsx` (31 tests): opens by itself on a first run, stays on Home otherwise, a failing first-run question leaves Home alone, `#/setup` by hand; step 1 (rows, blocker, Next disabled with its reason, Check again, lost answer, Not now writes nothing); step 2 (Next disabled until a file is chosen, only the words `default` / `pick` are sent, name and count, "will be created", refusal with fix, cancelled dialog shown as information, lost answer, Back); step 3 (exactly the chosen values are sent, refused value marked, lost answer); step 4 (summary and warnings, Finish disabled until the box is ticked, `confirmed = true` sent once, result, service note, failed step with what stayed done, refusal, lost answer, review not ready, Back keeps choices); no password / cookie / key field in the wizard; two tests against the REAL `SetupWizardService` on real accounts files (all four steps applied once and in order, no secret, e-mail or folder on screen; a failing computer check cannot pass step 1).
- Prettier applied to 6 files that were not formatted.

## Commands run and observed results (Linux sandbox, Node 24.22.0, engine installed and built)
- `tsc --noEmit`: exit 0. `eslint .`: exit 0. `prettier --check .`: all files pass.
- `vitest run` (all): Test Files 62 passed (62); Tests 1108 passed, 7 skipped (1115) (one file, `repo-hygiene`, failed only in a run where `node_modules` was a symbolic link; run again with a real folder it passes, 4 of 4).
- `npm run build` was NOT re-run for this completion (it passed after Phase 21; no build file changed except the new page).

## Still NOT VERIFIED
- The screens have never been seen in a real Electron window: no screenshots. Look at them on your PC (first start with no accounts file, or `#/setup`).
- `START.bat` / `TEST.bat`: NOT TESTED (no Windows here). Run TEST.bat.
- Opening the wizard again from a button is Phase 23, not done.

## Verdict
Phase 22 code complete and automatically tested (services, IPC, screens). On-screen check and Windows run pending. STOP: Phase 23 not started.
