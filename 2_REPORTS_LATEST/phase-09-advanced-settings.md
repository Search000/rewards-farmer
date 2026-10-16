# Phase 09 Report: Advanced settings (login, check-in, timing, search options)

1. **Phase and date:** Phase 9, 2026-10-12.

2. **Objective:** Non-secret part of screenshots 5-7: map login/check-in, timing, search and (user-approved) advanced switches to real engine config fields; save/discard/reset; unsaved-change warning; no evasion controls.

3. **Files inspected:** `docs/configuration-reference.md`, `reports/phase-08-settings.md`, the 20-phase master prompt, engine sources at the pinned commit (`engine/src/index.ts`, `Activities.ts`, `BrowserSearch.ts`, `ReadToEarn.ts`, `QueryEngine.ts`, `Browser.ts`, `Validator.ts`, `scripts/api/configEditor.js`, ...).

4. **Files created/modified:** `src/shared/engine-settings-types.ts`, `src/shared/engine-settings-rules.ts`, new `src/shared/duration.ts`, `src/renderer/pages/SettingsPage.tsx`, `tsconfig.json`, `vitest.config.mts`, new `tests/types/*`, `tests/engine-settings-rules.test.ts`, new `tests/engine-validator.parity.test.ts`, `tests/main/engineSettings.integration.test.ts`, `tests/renderer/settings.test.tsx`, new `tests/launchers.test.ts`, `START.bat`, `TEST.bat`, `docs/configuration-reference.md`, this report.

5. **Implementation summary:** Fields grew from 14 to 41. New: 9 login/check-in switches, 5 timing fields (text with required unit, parsed like the engine's `ms` library, 24 h cap, 1 sec floor on search and read delays), 6 search options (including ordered search-word source list), 4 advanced switches (`clusters` 1-8, `apiSearch`, `apiSearchOnBing`, `proxy.ignoreCertificateErrors` with warning). Save sends only changed fields through the engine's `PATCH /config`; backup first; read-back; audit line; disabled during a run. Full table: `docs/configuration-reference.md`.

   **Not built (rule 9 / decision D1):** `contintueOnBotWarning`, `scrollRandomResults`, `clickRandomResults`, `humanize.*`, `experimental.edgeBrowsing`, Probability of typo, Timezone/Latitude/Longitude. Secrets (webhooks, `chinaApi.appkey`) wait for Phase 10.

6. **Commands actually run (Linux sandbox, Node 24.21.0):** `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, `node node_modules/vitest/vitest.mjs run`.
   `START.bat` / `TEST.bat` output: **NOT TESTED**. No Windows here. Only static checks (`tests/launchers.test.ts`, 10 tests: uses `cd /d "%~dp0"`, `pause`, SUCCESS/FAILED line, no secret words, no global install or delete). Run both on Windows.

7. **Actual command outputs / test evidence:**
   - `tsc --noEmit`: clean. `eslint .`: clean. `prettier --check .`: "All matched files use Prettier code style!"
   - Vitest: **18 files passed, 256 tests passed, 1 skipped (257), 116 s.** The skip is `units.test.ts` (permission-denied test, skipped on Windows and when running as root).
   - Phase 9 specific: rules test 17, validator parity vs the engine's real zod schema 5, engine API integration 19 (real engine process), Settings page renderer 16.
   - Setup note: the engine lockfile points at `registry.npmmirror.com`, blocked here. Engine dependencies were installed from the official registry into a temp folder using a sed-edited copy of the lockfile. Engine files were not modified.

8. **Acceptance criteria checklist:**
   - Every enabled field has a verified effect on the engine or is disabled with reason: PARTIAL. Each field cites its engine read site, and values are accepted by the engine's real validator and round-trip through the real API. No real full run was done, so effect on a live farming run is NOT TESTED.
   - Save/cancel/reset and unsaved-change warning: tested (renderer + integration).
   - Invalid, missing values, write failure: tested. Restart persistence: read-back after save only, no separate app restart test.
   - Config migration: none needed for engine config. `app-settings.json` migration from Phase 8 unchanged.
   - No evasion controls: yes, see "Not built".

9. **Known issues and unresolved questions:**
   - No screenshot comparison done (Phase 18).
   - Decisions 1-3 for this phase were taken from the transcript text only; the user messages themselves were not in the files I received. Please confirm: declined human-imitation options, 1 sec floor, advanced switches included.
   - Missing `START.bat` / `TEST.bat` in the Phase 8 zip; recreated in this phase.
   - This tree was rebuilt by replaying the recorded commands onto the Phase 8 zip (the Phase 9 files themselves were not in the zip). Results above are from re-running everything on the rebuilt tree.
   - `git` history of the project is absent in the zip; nothing committed.

10. **Security/data impact:** No secrets stored or logged. `config.json` backup before each write. `proxy.ignoreCertificateErrors` weakens TLS checks for proxy connections; off by default, warning shown.

11. **Verdict:** PASS for automated checks on real Windows (see Update 3). PARTIAL for the rest: opening the app window from `START.bat`, a live farming run and the screenshot match are not confirmed.

12. **User decision required:** Confirm the three decisions in item 9. Run `TEST.bat` and `START.bat` on Windows and send the output.

13. **Explicit stop notice:** I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.

## Update after the user ran the launchers on Windows (2026-10-12)

- Real Windows run: `START.bat` built the renderer and main process (vite and esbuild finished, no errors). It was started after an interrupted `npm ci` (Ctrl+C), so `node_modules` existed but was incomplete.
- Real Windows run: `TEST.bat` reported Type-check, Lint, Formatting, Tests all FAIL. Log: `'tsc' is not recognized` (also eslint, prettier, vitest). Cause: the launchers only checked that the `node_modules` folder exists, so an unfinished install was treated as done.
- Fix: both launchers now treat the install as done only when `node_modules\.package-lock.json` (written by npm at the end of a finished install) exists, same for `engine\node_modules`. Otherwise `npm ci` runs again. The message tells the user not to close the window.
- Re-checked here (Linux): `tsc`, `eslint`, `prettier` clean; `tests/launchers.test.ts` updated and passing. The new launchers are NOT TESTED on Windows.

## Update 2: second Windows run of TEST.bat (2026-10-12)

- Real Windows result: Type-check PASS, Lint PASS, Formatting PASS, Tests 251 passed, 1 failed, 5 skipped. The 5 skips are by design on Windows (4 in `stale-engine.test.ts` are POSIX-only, 1 permission test in `units.test.ts`).
- The failure was `farmer.integration.test.ts`: "start failure: the engine cannot launch the bot process at all". The state showed the real spawn error (`ENOENT`) but no error notice. Cause: a real app bug, not a test bug. When the bot could not be launched, the engine went starting -> idle between two status reads, so the app never saw an active run end and never showed the error. On a slow machine this is likely, on the Linux sandbox it did not happen.
- Fix (`src/main/farmer.ts`): after an accepted Start the app remembers the last known exit time. If the engine is idle again with a newer exit, the run end is reported even when the active phase was never seen. An old exit is never mistaken for the new one.
- Re-run here (Linux): `tsc`, `eslint`, `prettier` clean; farmer integration 25/25, twice, also under CPU load. I could NOT reproduce the failure on Linux before the fix, so the fix is verified only as "no regression here". Windows re-run of `TEST.bat` is needed.

## Update 3: third Windows run of TEST.bat (2026-10-12 12:03, user machine, Windows 10.0.26300, Node 24.15.0, npm 11.12.1)

- Real result: Type-check PASS, Lint PASS, Formatting PASS, Vitest **17 files passed, 1 skipped, 252 tests passed, 5 skipped, 0 failed** (31.6 s). The previously failing test "start failure: the engine cannot launch the bot process at all" now passes on Windows (744 ms).
- The 5 skips are by design on Windows (4 POSIX-only, 1 permission test).
- `npm ci` finished for both the app and the engine with the official registry host replaced (`--replace-registry-host=always`).
- Warnings seen, not errors: `vitest.config.mts` uses `__dirname` (a Vite notice); `npm audit` reports 2 high-severity packages in the pinned engine (upstream code, not changed here; Phase 16 reviews it).
- `START.bat` built the app (earlier real run). Whether the app window opened was not reported yet.

## Update 4: user screenshots of the running app (2026-10-12)

- The user ran `START.bat`; the app opened and the Settings page shows Login & check-in, Timing, Search options and Advanced.
- Problem 1 (screenshots, red boxes): large empty gaps. Cause: cards were placed in two flex rows, so a short card left blank space under it next to a tall one. Fix: one column-flow container (`columnCount` 2 on wide windows, 1 on narrow), cards no longer stretch or leave holes.
- Problem 2: texts such as "decision D1" and "rule 9" were shown to the user. They are internal references (rule 9 is in the master prompt file; D1 is my own decline in `docs/requirements-matrix.md`), not user decisions. Replaced by plain sentences ("Not included: it only helps to hide the bot from Microsoft ...").
- Problem 3: "can't click". The greyed controls are the screenshot controls the engine has no setting for, or that only hide the bot. They stay disabled on purpose (rule 17) and now say why in plain words.
- Re-run here (Linux): tsc, eslint, prettier clean; full Vitest result is in the chat reply. The new layout is NOT visually checked here (no Electron/browser in this sandbox). Needs a look on Windows.
