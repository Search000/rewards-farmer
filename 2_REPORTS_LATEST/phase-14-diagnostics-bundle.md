# Phase 14 report: diagnostics bundle export

1. **Phase and date:** Phase 14, 2026-10-14. Started after the user wrote "start from phase 14, do not go to other phases". Phase 15 is not started.

2. **Objective:** Let the user export one safe, cleaned diagnostics ZIP (versions, config with secrets hidden, health results, newest log lines) that contains no secrets, sessions, tokens, cookies or real account data; test it with missing files, very large logs and permission-denied destinations.

3. **Files inspected:** the master prompt (Phase 14 section and rules), the Phase 13 project ZIP (`rewards-farmer-MASTER-phase13-closed.zip`), the four loose Phase 14 files the user sent (`diagnosticsService.ts`, `diagnostics-rules.ts`, `zipWriter.ts`, `diagnostics.test.ts`), the session transcript (`New_Text_Document.txt`), `healthService.ts`, `health-rules.ts`, `ipc.ts`, `preload.ts`, `main.ts`, `HealthPage.tsx`, `useHealth.ts`, `redact.ts`, `jsonlLog.ts`, `tests/main/helpers.ts`.

   **How the code was recovered:** the Phase 13 ZIP did not hold any Phase 14 work (it was lost with the earlier session). The four loose files were used exactly as sent. Everything else was rebuilt from the commands and file contents recorded in the transcript, then compiled and tested here. Nothing was invented that the transcript did not describe, except the new renderer tests (`tests/renderer/diagnostics.test.tsx`), the `any` fix in two tests and the Phase 13 fix below.

4. **Files created/modified:**
   - New (the user's four files): `src/main/diagnosticsService.ts`, `src/shared/diagnostics-rules.ts`, `src/main/zipWriter.ts`, `tests/main/diagnostics.test.ts`.
   - New (rebuilt): `src/shared/diagnostics-types.ts`, `src/renderer/components/DiagnosticsCard.tsx`, `tests/helpers/readZip.ts`, `tests/main/zipWriter.test.ts`, `tests/diagnostics-rules.test.ts`.
   - New (written now): `tests/renderer/diagnostics.test.tsx`, `scripts/capture-diagnostics.mjs`, `reports/phase-14-screenshots/`.
   - Changed: `src/shared/farmer-types.ts` (2 error codes `EXPORT_BLOCKED`, `EXPORT_FAILED`), `src/main/engine/redact.ts` (`containsKnownSecret`), `src/shared/ipc-types.ts`, `src/preload/preload.ts`, `src/main/ipc.ts` (ONE new channel `diagnostics:export`, no argument), `src/main/main.ts` (service wiring and save window), `src/renderer/pages/HealthPage.tsx` (the card), the 6 renderer test stand-ins (new `exportDiagnostics` member), `docs/threat-model.md` (T15), `docs/feature-support-matrix.md` (1 row).
   - **Fix to Phase 13 code:** `src/main/healthService.ts`. The network probe promise was created early and only read later; when a probe failed, Node reported an unhandled rejection and `vitest run` exited with code 1 although every test passed (this was already in the Phase 13 ZIP; it would make `TEST.bat` look failed). The failure is now turned into "unknown" at once. Behaviour of the checks did not change.
   - No other phase changed.

5. **Implementation summary:**
   - **Health page card "Diagnostics bundle"** with one button "Export diagnostics". Main shows the save window (default name `rewards-farmer-diagnostics-<date-time>.zip`, folder Documents), builds the bundle, checks it, writes it. The result (saved, or the exact reason it was not) stays on screen. Closing the save window shows nothing.
   - **ZIP content (6 files):** `README.txt`, `diagnostics.json` (app/Electron/system versions, engine state and versions, `ENGINE_PIN` commit, accounts status as numbers only, app settings, engine config, health result, log report, list of what is left out), `health.txt` (readable checks with "What to do"), `logs/app.log.txt`, `logs/engine.log.txt`, `logs/errors.log.txt`.
   - **Never read:** `.env` / accounts file, the sessions folder, the secrets store. `audit.log` is not included. The accounts path is not included either (only "file chosen").
   - **Layer 1, cleaning (`Scrubber.text`):** known secret values and secret patterns (same Redactor as the log files), cookies, web tokens (JWT), URL tokens, long hex, long mixed letter+digit strings, e-mail addresses (numbered `<email-1>`, same address = same number), IP addresses (not 127.x / 0.0.0.0), the home folder and the Windows user name in paths.
   - **Config copy (`cleanConfig`):** numbers, true/false, null and short harmless text are kept; the fields the Secrets page manages show `<set>` / `<not set>`; any other text under a key that looks secret (pass, token, key, url, user, mail, proxy, chat, topic, id ...) or longer than 80 characters or changed by the scrubber becomes `<hidden>`; depth, array and key counts are limited.
   - **Layer 2, independent check (`Scrubber.verify`):** looks at the finished file contents again for 13 kinds of leak. **One finding = nothing is saved** (`EXPORT_BLOCKED`, text names the kind, never the value). Written to `audit.log` and `app.log` without the value.
   - **Big logs:** only the last 1 MB of each log is read, at most 2000 lines, a cut first line is dropped, control characters become `?`, a line over 4000 characters is shortened. A finished bundle over 20 MB is refused.
   - **Writing:** the name always ends in `.zip` (so `config.json` can never be overwritten; it becomes `config.json.zip`); written to a temporary name next to the target, then renamed; temporary file removed on any failure; an older file stays untouched until the new one is complete. A relative path is refused. A second export during a running one is refused. Health checks that hang are cut after 30 s and reported inside the bundle.
   - **Plain error messages** for access denied, folder missing, disk full, read-only, folder in the way, file open elsewhere, name not allowed, other codes.
   - **ZIP writer:** own small writer (no new package), deflate, UTF-8 names, no folders, no encryption, checks names (no `..`, no absolute path, no backslash, no duplicates ignoring case).

6. **Commands actually run** (sandbox: Linux, Node v24.21.0 via the `node` npm package, runs as root):
   - `npm ci`, `npm --prefix engine ci --ignore-scripts`, `npx prettier --check .`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
   - `node scripts/capture-diagnostics.mjs reports/phase-14-screenshots` (REAL Electron window under Xvfb).
   - A real bundle was made with the real service and checked with the real tools `unzip -t`, `unzip -l`, Python `zipfile.testzip()` and `grep` (section 7).
   - `START.bat` and `TEST.bat`: **NOT TESTED** (no Windows here). Not changed in this phase.

7. **Test evidence (final run, exit codes all 0):**
   - `tsc` 0 errors, `eslint` 0 problems, `prettier --check` "All matched files use Prettier code style!", `npm run build` ok.
   - `vitest run`: **Test Files 38 passed (38), Tests 470 passed, 3 skipped (473). No "Errors" line.** Before this phase: 34 files / 403 passed / 2 skipped. New: **67 tests** (rules 21, zip writer 4, service 35, renderer 7) plus 1 new skip.
   - The 3 skipped tests are root-only skips (the 2 from Phase 13 and the new "REAL permission denied folder" test: root can always write). The permission-denied case is covered by an isolated stand-in for 7 error codes (EACCES, EPERM, ENOSPC, EROFS, EBUSY, ENAMETOOLONG, unknown) and by the real missing-folder and folder-in-the-way cases.
   - **Planted fake secrets:** ~25 FAKE values (Discord URL, Telegram token, ntfy token, passwords, 2FA secret, unknown password, bearer token, cookie, JWT, proxy user/password/IP, e-mails, Windows user name, config secrets, a future unknown `apiToken` field) are written into real temp logs and config. The test proves **none** appears in any file of the ZIP and none in the audit line. The accounts file and sessions folder content (also planted) never appears.
   - **Safety check proven:** a deliberately broken redactor (changes nothing) makes the export fail with `EXPORT_BLOCKED`, "NOT saved", nothing written, an older file at the target untouched, no temp file left.
   - **Real big file:** a 30 MB log exports in under 4 s (asserted), bundle under 300 KB, newest line present, "older lines are not included" stated; a single 3 MB line without line break does not break it.
   - **Mutation check:** removing the e-mail replacement from the scrubber made **31 of 57** tests fail; file restored, 56 pass / 1 skip again.
   - **Real tools on a real bundle** (made by the real service with planted fake secrets):
     ```
     testing: README.txt OK / diagnostics.json OK / health.txt OK / logs/app.log.txt OK / logs/engine.log.txt OK / logs/errors.log.txt OK
     No errors detected in compressed data of .../bundle.zip.
     Python zipfile.testzip() -> None, 6 files
     grep for password, e-mail, IP, cookie value, Windows user name, webhook id in the unzipped files -> NONE FOUND
     ```
     Example cleaned log line: `login *** for <email-1> from <ip>` and `C:\\Users\\<user>\\AppData`.
   - **Real Electron window** (built `dist/`, Xvfb): Health page shows the "Diagnostics bundle" card with its text and an enabled "Export diagnostics" button, 17 check rows still there, **0 console problems**. Screenshots and `evidence.json` in `reports/phase-14-screenshots/` (wide and 800 px narrow).

8. **Acceptance check:**
   - "Exported bundle contains no secrets": proven by the planted-secret test, the independent check, the real-tool grep above. **Cannot be promised for every possible secret format** (stated in the bundle README and in threat model T15).
   - "Export fails gracefully with a clear message in every error case": missing logs/config/pin/package.json, invalid or huge config.json, unreadable log (folder in its place), damaged log (NUL, bad UTF-8), health hang and health throw, huge logs, size limit, cancelled window, window fails to open, relative path, folder missing, folder in the way, real read-only (root-skipped) and 7 stand-in error codes, a second click while running, redactor failure. Each has a test. **PASS**.

9. **Known gaps:**
   - **Windows not tested:** `START.bat`, `TEST.bat`, the Windows save window, Windows paths and file locks. The native save window was not driven in the real window (a native dialog cannot be automated here); the same code path is covered by the stand-in `pickSavePath` and the real-file tests.
   - A REAL permission-denied folder needs a non-root user (skipped here).
   - The cookie rule removes the rest of the line after `Cookie:` (safe, but that log line is no longer valid JSON).
   - `ENGINE_PIN` is read only when the app is not packaged; the packaged location is for Phase 43.
   - The bundle is not encrypted (not requested). The user decides who gets it.
   - ZIP64 not supported (a bundle is a few KB to MB; over ~4 GB is refused).

10. **Security/data impact:** No user file is changed. The app reads only logs, `config.json`, `package.json` of the engine, `ENGINE_PIN`; it writes only the ZIP the user chose, plus 2 lines in `audit.log`/`app.log` (no path, no secret). New IPC channel takes no argument, so a compromised screen cannot choose a file or a path. Threat model entry T15 added. No telemetry, no network call.

11. **Verdict:** **PASS** (with the Windows and real-permission items marked NOT TESTED above).

    Overall progress (master prompt phases 12 to 50): 3 of 39 phases done (12, 13, 14) = about 8 percent. Counting the earlier phases 1 to 11 as done: 14 of 50 = 28 percent.

12. **Needs user decision:**
    - **E-mail addresses:** in the app and the logs they stay visible (user decision 7 of Phase 3). In the bundle they are replaced by `<email-1>` etc., because the master prompt says "no real account data". Say if you want them visible in the bundle.
    - **IP addresses and your Windows user name** are also hidden in the bundle (not asked, safer by default).
    - Default save folder (Documents) and the file name pattern.

13. **Explicit stop notice:** I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.
