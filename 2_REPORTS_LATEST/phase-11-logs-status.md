# Phase 11 report: real logs and engine status

1. **Phase and date:** Phase 11, 2026-10-12. Started after the user wrote `NEXT PHASE`. Phase 12 is not started.

2. **Objective:** Integrate real engine logs and status; filtering, timestamps, severity, safe copy/export, refresh; redact secrets in the view and in exports; show unknown/unavailable instead of guessing; handle volume, rotation, permission errors and a disconnected stream; never fabricate a log line.

3. **Files inspected:** `docs/integration-contract.md`, `docs/architecture.md` (section 13), `docs/requirements-matrix.md`, `engine/scripts/api/README.md` (`GET /logs`, `GET /events`), `src/main/{farmer,ipc,main,jsonlLog}.ts`, `src/main/engine/{apiClient,redact,supervisor}.ts`, `src/shared/*`, `src/renderer/{App,routes}.tsx`, renderer hooks/components, `tests/main/helpers.ts`, `tests/fixtures/fake-bot.cjs`, screenshot 1.

4. **Files created/modified:**
   - New: `src/shared/logs-types.ts`, `src/shared/logs-rules.ts`, `src/main/engine/sse.ts`, `src/main/logService.ts`, `src/renderer/hooks/useLogs.ts`, `src/renderer/pages/LogsPage.tsx`, `tests/main/{sse,logService,logs.integration}.test.ts`, `tests/logs-rules.test.ts`, `tests/renderer/logs.test.tsx`.
   - Changed: `src/main/engine/apiClient.ts` (`logsAfter`, `openEvents`), `src/main/jsonlLog.ts` (debug level, `engine` source, size rotation = archive), `src/main/{ipc,main}.ts`, `src/preload/preload.ts`, `src/shared/ipc-types.ts`, `src/renderer/{App,routes}.tsx`, `components/Sidebar.tsx`, `docs/integration-contract.md`, `tests/launchers.test.ts` (earlier hotfix), 4 renderer test mocks (3 new bridge methods), `tests/renderer/shell.test.tsx` (8 sidebar items).
   - Launcher hotfix before this phase (not a phase): `START.bat` / `TEST.bat` (one-at-a-time lock, real install check, long-path warning). Cause: both were started 2 seconds apart and corrupted `node_modules`.

5. **Implementation summary:**
   - `LogService` (main) reads the live SSE stream with the token in a header, resumes with `Last-Event-ID`, falls back to `GET /logs?afterId=` when the stream cannot open, reconnects with backoff, and treats 45 s of silence as a dead stream.
   - Every line is redacted in main on arrival (known secrets plus patterns) and again on export. Buffer: newest 5000 lines in memory, newest 2000 sent to the screen. Dropped, missed (id gaps) and disk-write problems are counted and shown.
   - Lines are also written to `engine.log` (all levels) and `errors.log` (warn + error). Files rotate by size (10 MB): the full file is renamed to a time-stamped archive, never deleted or overwritten (rule 10).
   - Engine restart: old lines stay, new lines get a new "session"; the page shows a marker that is drawn by the UI, not a log line.
   - Level the engine did not give stays `unknown`. A missing time is `-`. Version, account, points and run state show `Unknown` when the engine did not report them.
   - New page **Logs**: status card, level filter, text search, follow-newest, Refresh, Copy, Export (main opens the save dialog; the renderer sends only a filter, never a path), clear empty / unavailable / error states.
   - IPC: 3 new channels (`logs:get-state`, `logs:refresh`, `logs:export`), sender-checked; filter shape validated in main.

6. **Commands actually run** (sandbox: Linux, Node v24.21.0 for the integration tests; the default sandbox Node is v22, which the app correctly refuses):
   - `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, `npx vitest run`, `npm run build`.
   - `START.bat` and `TEST.bat`: **NOT TESTED** (no Windows here). Only the static launcher tests ran (`tests/launchers.test.ts`, 16 + 7 new checks pass).

7. **Actual command outputs / test evidence:**
   - typecheck: no errors. eslint: no output (clean). prettier: "All matched files use Prettier code style!".
   - `vitest run`: **Test Files 28 passed (28), Tests 335 passed, 1 skipped (336)**. The 1 skipped test (`units.test.ts`, a permission test) skips itself when run as root, as in this sandbox. It is not part of Phase 11.
   - New tests: 5 (SSE parser) + 17 (LogService with an HTTP stand-in engine) + 2 (real engine API, unmodified `server.js`, fake bot) + 4 (rules) + 9 (renderer).
   - Real-engine test proves: every line shown has the same id, title and message as the engine's own `/logs`; none is invented; history is kept after the engine stops; a restart gives a new session; a failing bot shows an ERROR line.
   - `npm run build`: renderer and main built (`dist/main/main.js` 150.6 kB).

8. **Acceptance criteria checklist:**
   - Logs/status match real engine events: PASS (real-engine test).
   - Sensitive values redacted in view, files and export: PASS (fake secrets, incl. a secret learned after the line arrived).
   - High volume: PASS (3000 lines; bounded buffer; dropped count). Rotation: PASS (archive, no loss). Permission/disk error: PASS (shown, no crash). Disconnected stream: PASS (cut, 503, silent stream, engine down).
   - Never fabricate a line / success: PASS by design and by test.
   - Looks right in the real Electron window: **NOT TESTED** (no GUI here).

9. **Known issues and unresolved questions:**
   - Logs page is **not in the 7 reference screenshots**. Added as a sidebar item "Logs". Decision taken: keep (see follow-up below).
   - `user` is the engine's own field (the label in square brackets, e.g. `alpha`), not always an e-mail.
   - `errors.log` carries engine warn/error only (app warnings stay in `app.log`).
   - Per-account and per-run log files from architecture section 13 are **not** built (engine log lines do not carry a reliable account/run key). Age-based cleanup of archives is not built on purpose (needs your consent).
   - Windows launchers still unrun on Windows. Engine's own `engine:test` failures (upstream) unchanged.

10. **Security/data impact:** No secret written anywhere except fake test strings. New IPC surface is read-only plus Export (user picks the path in a native dialog). Logs are never sent anywhere. Archives accumulate until you delete them.

11. **Verdict:** PASS (code and tests). PARTIAL for the visual check in a real window.

12. **User decision required:**
   - Keep the extra **Logs** sidebar item, or put the log view somewhere else (for example under the kebab menu)? Default: keep.
   - Run `START.bat` on Windows and tell me the result (and whether the lock and install check behave).

## Follow-up after Phase 11 (user request, 2026-10-12): Secrets & API keys as its own page

User decisions applied: (1) "Secrets & API keys" is its own sidebar page, like Logs. (2) The Telegram and Discord sidebar tabs are removed; their fields live on that page. (3) Logs stays in the sidebar.

- Sidebar now: Home, Accounts, Parallel farming, Secrets & API keys, Logs, Settings, About (7 items; was 8). `src/renderer/routes.ts`, `components/Sidebar.tsx` (key icon).
- New `src/renderer/pages/SecretsPage.tsx` (page card with the h1 "Secrets & API keys"). `components/SecretsCard.tsx` is now the page body: fields are grouped under headings in this order: Discord, Telegram, ntfy, PushPlus, ServerChan, China search API. Same write-only behaviour as Phase 10 (no reveal, no copy, never shown after saving).
- `SettingsPage.tsx` no longer shows the secrets card.
- Old links `#/telegram` and `#/discord` open the Secrets page (no dead route). Outside Electron the page says secrets can be saved only inside the desktop app (before, the card was silently hidden).
- Not changed: engine config fields, IPC, main process, redaction. Only the screen layout moved.
- Tests: `tests/renderer/shell.test.tsx` (7 sidebar items, legacy hashes), `tests/renderer/secrets.test.tsx` (own page, groups and order, no secret fields on Settings, outside Electron).
- Evidence (sandbox Linux, Node v24.21.0, engine dependencies installed with `--ignore-scripts`): `tsc --noEmit` clean; `eslint .` clean; `prettier --check .` clean; `vitest run`: **28 files passed, 338 tests passed, 1 skipped** (the skipped permission test skips itself as root); `npm run build` ok.
- NOT TESTED: the new page in a real Electron window (no GUI here); `START.bat` / `TEST.bat` on Windows.

## Closing check of Phase 11 (2026-10-13): real Electron window

Done in the same session as the hand-over of the Phase 11 ZIP. No product code changed. One helper script was added: `scripts/capture-logs.mjs` (drives the real built app over the DevTools protocol under Xvfb, like `capture-screenshots.mjs` from Phase 5).

- Environment: Linux sandbox, Node v24.21.0, Electron 44.7.0 (real binary downloaded), Xvfb. `npm ci` for the app and for `engine/` (with `--ignore-scripts`).
- `tsc --noEmit`: clean. `eslint .`: clean. `prettier --check .`: clean.
- `vitest run`: **28 files passed, 338 tests passed, 1 skipped** (the skipped permission test skips itself when run as root). Duration 122 s.
- `npm run build`: ok (`dist/main/main.js` 150.6 kB, `dist/preload/preload.js` 3.7 kB).
- Real window run (`node scripts/capture-logs.mjs reports/phase-11-screenshots`): the **Logs** page opens in the real Electron window with the heading "Logs". With the engine not started it shows: Engine "Not started", Engine version "Unknown", Run "Unknown (engine not reachable)", Run started "-", Last exit "-", Current account "Unknown", Current points "Unknown", Log stream "Engine not running", and the message "The engine is not running, so there are no logs to show." Copy and Export are disabled (nothing to copy). Nothing is invented.
- The **Secrets & API keys** page also opens in the real window (heading "Secrets & API keys", honest "engine is not running" message).
- Console check: **0 errors, 0 warnings** during the four page visits (evidence: `reports/phase-11-screenshots/evidence.json`).
- Screenshots: `reports/phase-11-screenshots/01-logs-engine-not-running.png`, `02-secrets-page.png`, `03-home.png`, `04-logs-narrow.png` (800x600).
- NOT TESTED: the Logs page **with live lines** in a real window (needs a running engine with a bot; the lines, filter, copy and export are covered by the real-engine integration test and renderer tests, not by a screenshot). `START.bat` / `TEST.bat` on Windows (no Windows here).

Verdict for the visual item that was PARTIAL: the empty/unavailable state is now checked in the real window. The live-lines state stays NOT TESTED in a window.

13. **Explicit stop notice:** I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.
