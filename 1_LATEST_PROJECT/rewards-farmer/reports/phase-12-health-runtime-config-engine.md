# Phase 12 report: health panel (runtime, configuration, engine)

1. **Phase and date:** Phase 12, 2026-10-14. Started after the user wrote "phase 12 theke kaj koro" and said not to touch other phases. Phase 13 is not started.

2. **Objective:** Health panel UI plus real checks for runtime (Node, Git, app), configuration (engine files, packages, build, config.json, accounts file) and engine (process, API, config, version). Every failed check says what to do. A check that cannot run is shown as unknown, never as OK.

3. **Files inspected:** the master prompt (Phases 12-50), `README_FILE_MAP.md`, `reports/phase-11-logs-status.md`, `src/main/{farmer,ipc,main}.ts`, `src/main/engine/{apiClient,supervisor,staleEngine}.ts`, `src/main/engineSettings.ts`, `src/main/jsonlLog.ts`, `src/preload/preload.ts`, `src/shared/*`, `src/renderer/{App,routes}.tsx`, `components/{Sidebar,PageCard,StateBlock}.tsx`, `pages/LogsPage.tsx`, `START.bat`, test helpers and the Logs tests.

4. **Files created/modified:**
   - New: `src/shared/health-types.ts`, `src/shared/health-rules.ts`, `src/main/healthService.ts`, `src/renderer/hooks/useHealth.ts`, `src/renderer/pages/HealthPage.tsx`, `scripts/capture-health.mjs`, `tests/health-rules.test.ts`, `tests/main/health.test.ts`, `tests/main/health.integration.test.ts`, `tests/renderer/health.test.tsx`, `reports/phase-12-screenshots/`.
   - Changed: `src/main/{ipc,main}.ts`, `src/preload/preload.ts`, `src/shared/ipc-types.ts`, `src/renderer/{App,routes}.tsx`, `components/Sidebar.tsx`, 5 renderer test mocks (1 new bridge method), `tests/renderer/shell.test.tsx` (7 -> 8 sidebar items, Health added).
   - No earlier phase was changed in behaviour.

5. **Implementation summary:**
   - `HealthService` (main) runs 13 checks every time it is called. Nothing is cached. Each row has its own `checkedAt` time.
   - Node and Git: real `node --version` / `git --version` (same `node` the supervisor uses). Node below 24 = error. Git missing = warning when the engine is already here, error when it is not.
   - Files: engine API script, `node_modules/.package-lock.json`, `dist/index.js`, `config.json` are real file tests. Rows that depend on missing engine files become `unknown` ("Not checked"), so there is one red row, not five.
   - config.json: read in memory, parsed, then checked with the same `extractValues` rules as the Settings page. If it is not JSON, the parser message is NOT shown (it can quote the file, which may hold secrets).
   - Accounts file: taken from the live farmer state.
   - Engine: process state from the supervisor; `GET /health` and `GET /config` of the real engine; engine version compared with `engine/package.json` (mismatch = a stale engine is still running).
   - A check that throws or takes more than 10 s becomes `unknown`. Engine messages go through the redactor.
   - Two calls at once share one run.
   - IPC: one new channel `health:run`, sender-checked, no argument (the renderer cannot choose a path or command).
   - UI: page "Health" grouped Runtime / Configuration / Engine. Status is written in words, not only by icon. Summary line never counts unknown as good. Runs once when the page opens.

6. **Commands actually run** (sandbox: Linux, Node v24.21.0):
   - `npx prettier --check .`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
   - `node scripts/capture-health.mjs` (real Electron window under Xvfb).
   - `START.bat` and `TEST.bat`: **NOT TESTED** (no Windows here). They were not changed in this phase.

7. **Test evidence (final run, after the last code edit):**
   - prettier: all files clean. tsc: no errors. eslint: clean. build: ok.
   - `vitest run`: **Test Files 32 passed (32), Tests 376 passed, 1 skipped (377).** Before this phase: 28 files / 338 tests. New: 38 tests = 4 rules + 27 service + 2 against the REAL engine API (unmodified `server.js`) + 5 renderer. The 1 skipped test is the root-permission test from an earlier phase.
   - Mutation check: setting the minimum Node to 20 made the "Node too old" test fail; restored to 24.
   - Real window: Health page opened twice, 13 rows both times, 0 console problems. In this sandbox it correctly shows 2 problems (engine not built, no config.json), 2 warnings (no accounts file, engine not started), 4 unknown (engine not running), 5 OK.

8. **Acceptance check:**
   - Every row is a real check: yes (service tests change the folder/commands/engine and the row changes; the integration test reads version from the real engine).
   - Every warning/error has a fix text: enforced in code (`makeCheck` throws without it) and tested over 5 broken scenarios; no typed commands (tests assert no `npm ` / `git submodule`).
   - Unknown never shown as OK: tested (rules, service, renderer).
   - No secret in a row: tested with a fake secret inside a broken config.json.

9. **Known gaps / not done (by design):**
   - No manual "re-run" button and no automatic re-check: that is Phase 13. The page says: close and open it again.
   - No disk-space, permission or offline checks: Phase 13.
   - Not built: comparing the engine commit with `ENGINE_PIN` (needs a decision; packaged builds may not have that file).
   - Windows launchers and the Health page with a running engine in a real window: NOT TESTED (the real engine is covered by the integration test only).

10. **Findings in other phases (not touched):**
   - Some older messages from Phase 6 (`farmer.ts`) still say "Run: npm run engine:install". That breaks master rule 27 (the user does not type commands). Health uses START.bat wording instead. Awaiting user decision to fix.
   - Health in the sidebar is not in the reference screenshots (like Logs). Placement is a user decision.

11. **Risks:** Node/Git are looked up from the PATH the app was started with. If the app is started from a place with a different PATH than the engine will get, the row could differ. The engine uses the same `node` lookup, so they agree today.

12. **Next phase:** Phase 13 (manual re-run, automatic re-check, disk/permission/offline checks). Not started. Waiting for `NEXT PHASE`.
