# Phase 06 Report: Home / Farmer screen

## 1. Phase and date
Phase 6, 2026-10-11. This session: Linux sandbox, Node 22.22.0, **no npm registry access** (only GitHub reachable), no Windows.

**How this package was made (read this first).** The earlier Phase 6 sessions were never saved into a ZIP. In this session the source was rebuilt by replaying the file-writing commands recorded in your `New_Text_Document.txt` log (31 write/patch commands, in original order) on top of `rewards-farmer-phase5-fix.zip`. Read-only, process-kill and screenshot commands were not replayed. Replay result: every command exited 0 except the original's own known failed patch (a Python `ValueError` in the log's "Create config" step, which the log fixed with the next command and which is also in the replay). Two later in-session `sed`/`python` fixes are included. I could not diff against the old tree, because it no longer exists, so fidelity is checked indirectly (section 7).

## 2. Objective
Home / Farmer screen (screenshot 1) on real data: accounts path picker, real Start/Stop through the engine control API, honest states, duplicate-start guard, process termination handling. No invented counts, points or success.

## 3. Files inspected
`New_Text_Document.txt` (the log), `Microsoft_Rewards_Farmer_Master_Prompt_15_Phases.md`, `phase-05-shell.md` and `phase-05-shell (1).md`, `rewards-farmer-phase5-fix.zip` (base), Phase 1-4 zips (listing only), `engine/scripts/api/*` at the pinned commit `e0c15a6` (through the test run), `src/renderer/components/*` props (LabeledField, ActionButton, ToggleSwitch, StateBlock, PageCard, Notifications).

## 4. Files created/modified
New: `src/main/{farmer,scheduler,appSettings,jsonlLog}.ts`, `src/main/engine/{apiClient,envFile,redact,snapshot,supervisor,supervisor-process,staleEngine}.ts`, `src/shared/farmer-types.ts`, `src/renderer/hooks/useFarmerState.ts`, `src/renderer/pages/HomePage.tsx`, `tests/main/{helpers,units.test,farmer.integration.test,stale-engine.test}.ts`, `tests/fixtures/fake-bot.cjs`, `tests/renderer/home.test.tsx`, `scripts/capture-home.mjs`.
Modified: `src/main/{main,ipc}.ts`, `src/preload/preload.ts`, `src/shared/{app-info,ipc-types}.ts`, `src/renderer/{App.tsx,routes.ts}`, `src/renderer/components/{AppShell,AppBarShell}.tsx`, `tests/renderer/shell.test.tsx`, `tests/setup.ts`, `eslint.config.mjs`, `vitest.config.mts`, `SETUP_WINDOWS.md` (section 11), this report.
Not touched: `engine/` (unmodified submodule files), `package.json`, `package-lock.json`.

## 5. Implementation summary
- **Engine supervisor** starts the unmodified upstream API (`engine/scripts/api/server.js`) on 127.0.0.1 with a random free port and random token, checks `/health`, restarts it automatically (limited), and reports `failed` with a Restart action after the limit. Checks Node 24+, engine folder, built `dist`, `config.json`. Writes `engine.pid`; on the next launch it stops a leftover engine only if the process command line is our `server.js` (a recycled PID is never killed).
- **Accounts path**: file dialog runs in the main process; the renderer never sends a path. Only `.env`-like names, size limit, directory/missing/empty errors; only `ACCOUNT_N_*` variables are forwarded to the engine. The renderer gets the account count and, during a run, the current account's e-mail for the "Current account" label; passwords and other fields never leave the main process.
- **Start/Stop** call real `POST /start` and `/stop`. Duplicate start is refused (`RUN_ACTIVE`). Start is blocked, with a visible reason, for: no accounts file, invalid file, engine missing, not built, config missing, Node missing, engine down. Bot exit with non-zero code, bot launch failure and engine death during a run are shown as errors with the engine's own last error line; the bot is not left orphaned.
- **Numbers** come from `/status`, `/points`, `/accounts`, `/history`, `/logs`. Unknown = `unknown` or `-`. Locked and Suspended always show `unknown` (no engine source). Section/Detail = newest engine log line of the run (redacted).
- **Alternate proxies** is shown disabled with the reason (engine has per-account proxies in the accounts file). Not faked.
- **Timer** ("Start at") is an app-side scheduler: persisted, validated `HH:MM`, starts a real run, reports a setup problem or a missed time (PC asleep) instead of hiding or starting late.
- **Logs**: `app.log` and `audit.log`, JSON lines, redacted (passwords, TOTP, proxy credentials, API token, bearer tokens, webhooks). Emails are written in full (your Phase 2 decision 7).
- **Theme choice** is now saved (Phase 5 open issue 3). **Engine icon** in the app bar now reflects the real link state.
- App quit stops the engine API and the bot. SIGTERM/SIGINT handlers were tried and removed again in the log (not reliable); orphan protection is the stale-engine reaper above.

## 6. Commands actually run (this session)
- `git clone` of the upstream URL (reachable).
- `unzip` of the three uploaded archives; replay of 31 logged command blocks via a small script (`npx`/`npm` calls inside them replaced by a no-op shim, `npx prettier` by the sandbox's prettier 3.8.1).
- `prettier --check src tests scripts *.mjs *.mts`.
- `tsc -p <temp config>` (TypeScript 6.0.2, `@types/node`) over `src/main`, `src/shared`, `src/preload`.
- `ts.transpileModule` syntax pass over every `.ts/.tsx/.mts` file in `src` and `tests`.
- `esbuild` bundle of `tests/main/*.test.ts` with a **minimal home-made vitest stand-in** (`describe/it/expect/vi.fn`, no fake timers), run with Node 22 in a **temp copy** where `MIN_NODE_MAJOR` was changed from 24 to 22. The repo copy still says 24.
- Attempted `npm ci` and `npm i node@24`: **failed**, the network policy denies `registry.npmjs.org`.

## 7. Actual command outputs / test evidence
**This session (re-run by me):**
- prettier: `All matched files use Prettier code style!` (prettier 3.8.1; project pins 3.9.10).
- tsc, main/shared/preload only: all errors are about the missing `electron` package (`Cannot find module 'electron'`, the types that follow from it, `process.resourcesPath`, and `process.versions.electron` in `ipc.ts`). No error in `farmer.ts`, `supervisor*.ts`, `apiClient.ts`, `envFile.ts`, `snapshot.ts`, `scheduler.ts`, `appSettings.ts`, `jsonlLog.ts`, `staleEngine.ts`, `farmer-types.ts`.
- syntax pass: 0 files with syntax errors in `src`, 0 in `tests`.
- Stand-in runner results: `units.test.ts` 23 pass, 1 skipped (permission test, root/Windows), **2 NOT RUN** (the two Scheduler tests that need fake timers); `stale-engine.test.ts` 4/4; `farmer.integration.test.ts` **25/25** against the real engine API (`engine/scripts/api/server.js`, unmodified) with the fake bot fixture. This covers path errors, missing config, engine missing/not built, Node missing, start failure, Start/Stop/restart, duplicate start, unexpected bot exit, engine killed idle and during a run, restart limit, quit stops engine and bot, timer (set, fire, missed, setup problem), secrets absent from logs and state, and "tests leave the real engine folder clean".
- Fidelity check of the replay: log outputs of `snapshot.ts` lines 30-110, `farmer-types.ts` lines 1-140 and `appSettings.ts` lines 1-60 match the rebuilt files line for line (0 missing lines). Other files were changed again by later logged patches, so they cannot be compared the same way.

**From your log (earlier session, NOT re-run here, quoted as history):** `npm run check` exit 0 three times in a row, "100 passed, 1 skipped (101)"; `npm run build` ok; the Linux/Xvfb capture produced two Home screenshots and `evidence.json` with no console errors; a force-kill test showed the leftover engine (pid 6725) stopped on the next launch. Those screenshots and `evidence.json` are **not** in any ZIP you gave me, so they are not in this package.

## 8. Acceptance criteria checklist
- Actual account path picker: DONE (main process dialog). Real dialog on Windows: NOT TESTED.
- Alternate proxy only if supported: DONE (disabled, reason shown).
- Start/Stop on the real process lifecycle: DONE and tested against the real engine API with a fake bot. Against the real bot with real accounts: NOT TESTED (needs your accounts, Chromium and engine build).
- Real current/total account status: DONE (null/unknown when no source).
- Honest idle/loading/running/stopped/error/unavailable states: DONE (main-process states tested; the renderer rendering of them is only covered by `home.test.tsx`, which **I could not run**).
- Duplicate start prevented, termination handled: DONE, tested.
- No invented counts/points/progress: DONE (tested for null mapping in `snapshot`).
- Tests for path errors, missing config, start failure, stop, restart, unexpected exit: DONE in the main-process tests, passing under the stand-in runner (25/25).
- `npm run check` / typecheck / eslint / full vitest incl. renderer tests / `npm run build` / real app launch / screenshots: **NOT TESTED in this session** (no registry, no Electron).

## 9. Known issues and unresolved questions
1. **You must run the checks on Windows** (section 12). Until then the full-project typecheck, eslint, the renderer tests (`home.test.tsx`, `shell.test.tsx` changes), the build and the window itself are unverified for this rebuilt tree.
2. The two Scheduler fake-timer unit tests were not run (stand-in limitation). They passed in the earlier session per your log.
3. Phase 6 screenshots are missing. Take them on Windows (Home with no accounts, Home with an accounts file set) or run `node scripts/capture-home.mjs reports\phase-06-screenshots` (the script is a Linux/Xvfb helper; not tested on Windows).
4. Locked and Suspended are `unknown` forever (no engine source). Alternate proxies is disabled.
5. A test-harness race fixed in the log: "Section" can be either of two bot lines depending on poll timing; the test accepts both. Real Home can briefly show either; both are real engine lines.
6. No Windows signal handling: if the app is killed hard, cleanup happens at the next launch, not immediately.
7. Engine still has 2 high `npm audit` items (Phase 12 decision). Design-system menu item still visible (remove before Phase 14). Discord icon stand-in (Phase 5 item).

## 10. Security/data impact
No secrets in the repo; fake accounts exist only inside test temp dirs. The engine API is bound to 127.0.0.1 with a random token; the token and all account secrets are redacted in logs and never sent to the renderer. Renderer still has no Node access; the preload exposes only typed Home calls. The app reads your accounts file and never writes to it; it writes only its own settings, logs and (on your click) `engine/config.json` if missing. No network calls other than 127.0.0.1. No telemetry.

## 10b. Windows run (your PC, Node 24.15.0, from `diagnose`/CMD output, 2026-10-11)
- `npm ci`: 275 packages, 0 vulnerabilities. `npm run build`: OK (renderer + main + preload).
- `npm run check` (final, after `npm ci`): typecheck 0 errors, eslint clean, prettier clean, **96 passed, 5 skipped, 0 failed** (9 files; `stale-engine.test.ts` skipped on Windows by design).
- Renderer tests (`home.test.tsx` 11/11, `shell.test.tsx` 11/11) and `farmer.integration.test.ts` 25/25 PASS on Windows against the real engine API.
- Earlier on the same PC: 1 failure, "the real engine folder has no config.json" (the test required that the real `engine/config.json` not exist, which breaks on any PC where it legitimately exists, including after the app's own "create config" button). Test rewritten to compare with the state captured before the tests ran. NOT re-run on Windows after this rewrite.
- Prettier warnings on `routes.ts` and `farmer.integration.test.ts` in the rebuilt tree were fixed by you with `prettier --write`; the same formatting is applied in the updated files.
- `npm run start`: output stops at "Downloading Electron binary..." . Whether the window opened: NOT SEEN.
- Real accounts run, Home screenshots: NOT DONE.

## 11. Verdict
**PARTIAL.** Main-process behaviour is verified in this session against the real engine API (52 stand-in test passes, 2 not run, 1 skipped). Renderer, build, lint, full typecheck, screenshots and Windows are NOT verified for this rebuilt tree.

## 12. User decision required
1. On Windows, from a fresh unzip, **[CMD]**: `npm ci`, `npm run check`, `npm run build`, then `npm run start`. Send me the output (or `diagnose-output.txt`). If `check` shows a failure, I fix it inside Phase 6.
2. With the app open: choose a real accounts `.env`, press Start with one real account, watch it, press Stop. Send screenshots of Home.
3. OK that Alternate proxies stays disabled and Locked/Suspended stay `unknown`?
4. When you are satisfied, say `NEXT PHASE` for Phase 7 (Accounts).

## 13. Explicit stop notice
I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.
