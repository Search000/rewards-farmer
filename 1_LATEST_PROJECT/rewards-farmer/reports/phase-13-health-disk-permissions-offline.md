# Phase 13 report: health panel, disk / permissions / offline

1. **Phase and date:** Phase 13, 2026-10-14. Started after the user wrote `NEXT PHASE`. Phase 14 is not started.

2. **Objective:** Finish the health panel with real checks for free disk space, folder read/write permission and network/offline state; add a manual "Re-run checks" action and a safe automatic re-check; test low-disk, permission-denied and offline states with isolated fixtures.

3. **Files inspected:** the master prompt (Phase 13 section and rules), the Phase 12 code (`healthService.ts`, `health-rules.ts`, `useHealth.ts`, `HealthPage.tsx`), `src/main/main.ts` (data folders), `useFarmerState.ts`, `tests/main/helpers.ts`, the Phase 12 tests.

4. **Files created/modified:**
   - New: `tests/main/health-system.test.ts`, `scripts/capture-health-13.mjs`, `reports/phase-13-screenshots/`.
   - Changed: `src/shared/health-types.ts` (4 new row ids, group `system`), `src/shared/health-rules.ts` (disk thresholds, byte text, drive letter, re-check key and timing), `src/main/healthService.ts` (3 new probes, 4 new rows), `src/main/main.ts` (passes the app data folder), `src/renderer/hooks/useHealth.ts`, `src/renderer/pages/HealthPage.tsx`, and the Phase 12 tests (`health-rules`, `health`, `health.integration`, `renderer/health`) for the new rows and the new button.
   - No other phase changed. IPC unchanged (still one channel `health:run`, no argument).

5. **Implementation summary (4 new rows, group "This computer"):**
   - **Free disk space:** `statfs` of the app data folder and of the engine folder. Lowest value decides. Under 1 GB = warning, under 200 MB = error. Shows both values; names the drive letter in the advice. If one place cannot be measured the other still counts and the text says so; if neither can: unknown.
   - **App data folder / Engine folder (read and write):** really creates a tiny uniquely named file (opened "fail if exists"), reads it back, deletes it. Never touches an existing file. Handles: missing folder, a file where a folder should be, permission denied (EACCES/EPERM), read-only (EROFS), disk full (ENOSPC), other codes, and "test file could not be deleted" (warning). Advice is in plain language (move the project to Documents, Security tab, Controlled folder access).
   - **Internet connection:** DNS lookup of `rewards.bing.com` (the host the engine needs), then opens a TCP connection to port 443 and closes it at once. **No request and no byte is sent** (a test proves 0 bytes received by a local server). Name not found = error ("looks offline"); name found but no connection = warning (a proxy or firewall can make that normal, and accounts may use their own proxy).
   - **Re-run checks button:** real action, disabled while a run is going (cannot double-start).
   - **Automatic re-check, only while the Health page is open:** when the engine process or the accounts file changes, when the system goes online/offline, and when the window comes back to the front after 15 s or more. Waits 1.5 s of quiet (debounce), never starts an automatic run less than 5 s after the last one finished, stops when the page closes. Pushing state the checks do not look at (engine detail text, version) does not trigger anything.

6. **Commands actually run** (sandbox: Linux, Node v24.21.0, runs as root):
   - `npx prettier --check .`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
   - `node scripts/capture-health-13.mjs` (real Electron window under Xvfb).
   - `START.bat` and `TEST.bat`: **NOT TESTED** (no Windows here). Not changed in this phase.

7. **Test evidence (final run):**
   - prettier clean, tsc no errors, eslint clean, build ok.
   - `vitest run`: **Test Files 33 passed (33), Tests 402 passed, 2 skipped (404).** Before this phase: 32 files / 376 passed. New: 26 tests.
   - The 2 skipped tests are root-only skips: the old Phase 3 permission test, and the new "REAL read-only folder" test (root can always write, so a real EACCES cannot be made in this sandbox). The permission-denied, read-only and disk-full cases are covered with isolated stand-ins instead; a missing folder and a file-instead-of-folder are covered with REAL state.
   - Real (not simulated) states in tests: a local server (connect ok, 0 bytes sent), a local port with nobody listening (ECONNREFUSED -> warning), the reserved `.invalid` name (real DNS failure -> error), a missing folder, a file where a folder should be, an existing folder with files that must stay unchanged.
   - Low disk is tested with an isolated probe only (no real disk is filled). Offline is tested with an isolated probe plus the real DNS failure above.
   - Mutation checks: min gap set to 0 made 2 renderer tests fail; restored.
   - Real window: 17 rows. Real results in this sandbox: disk 8.7 GB ok, both folders readable and writable ok, internet = **Problem** (this sandbox has no internet: real `ENOTFOUND`). Pressing Re-run changed the "Checked" time from 10:01:36 to 10:01:42. 0 console problems. Screenshots: `reports/phase-13-screenshots/`.

8. **Acceptance check:** "Disk, permission and offline failures are detected from real state and shown with actionable messages."
   - Disk: real `statfs` on a real folder (test) and in the real window; failure levels via isolated probe. Messages name the drive and say what to delete/move.
   - Permission: real file test; missing/not-a-folder are real; EACCES/EROFS/ENOSPC via stand-in (root limitation, stated above).
   - Offline: real DNS failure and real refused connection; messages mention Wi-Fi/VPN/firewall and the Re-run button.
   - Every new warning/error row has a fix of 30+ characters with no typed commands (tested over 3 failure scenarios).

9. **Known gaps:**
   - A real permission-denied folder was not tested (needs a non-root user). Windows behaviour of `statfs`, file locks and "Controlled folder access" is NOT TESTED (no Windows).
   - Windows launchers NOT TESTED.
   - The internet check connects only to `rewards.bing.com:443`. If a user reaches the site only through a proxy, the row shows a warning although farming may work. A proxy-aware check is not built (it needs the proxy design from a later phase).
   - Not built: comparing the engine commit with `ENGINE_PIN` (from Phase 12, still needs a decision).

10. **Needs user decision:**
   - The internet check host (`rewards.bing.com`). It is the only outside host the check touches. Say if you want a different host or no network check.
   - Disk limits (200 MB error / 1 GB warning) are my defaults.
   - Health item in the sidebar (from Phase 12).
   - Phase 6 messages that still say "Run: npm run engine:install" break rule 27. Not touched.

11. **Risks:** The automatic re-check on window focus can run the checks when the user only clicks around; it is limited to once per 15 s and only while the Health page is open. The DNS lookup uses the system resolver, so a stale DNS cache can make a short outage look fine for a moment.

12. **Next phase:** Phase 14. Not started. Waiting for `NEXT PHASE`.

## Follow-up after user answers (2026-10-14, not a new phase)

The user answered the open questions:
- Internet check host `rewards.bing.com`: **approved as is** (connection only, nothing is sent).
- Disk limits 200 MB error / 1 GB warning: **approved as is**.
- Health item in the sidebar: **stays**.
- Windows launchers: the user ran them on their own PC and reported they work. This is the user's statement, not a result I observed; I still did not run any `.bat` file.
- Phase 6 messages: **fix approved**. Done, small change only:
  - `src/main/farmer.ts` (4 messages), `src/main/engine/supervisor.ts` (1), and the "outside the app" notices in `HomePage.tsx`, `AccountsPage.tsx`, `SettingsPage.tsx` now say "double-click START.bat" instead of `npm run ...` / `git submodule ...`.
  - `tests/main/farmer.integration.test.ts` updated to the new wording. NEW `tests/no-typed-commands.test.ts` scans all of `src/` and fails if a typed command comes back (rule 27).
  - Final run after this change: prettier clean, tsc clean, eslint clean, build ok, Vitest **34 files, 403 tests passed, 2 skipped** (the same 2 root-only skips).
- Phase 14 is still NOT started.
