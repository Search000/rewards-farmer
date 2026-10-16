# rewards-farmer MASTER package

Ei ekta zip e tomar sob file ache. Kono file delete kora hoyni.

## Ki kothay
| Folder | Ki ache |
|---|---|
| 1_LATEST_PROJECT/rewards-farmer | LATEST project = Phase 8 (Settings). Eta e use koro. .git ar engine submodule shoho |
| 2_REPORTS_LATEST | Phase 1-8 report, docs, SETUP_WINDOWS, Master Prompt (sob newest version) |
| 3_SCREENSHOTS | 7 ta reference screenshot (.jpg) |
| 4_OLD_VERSIONS/projects | Phase 4, 5, 5-fix, 6, 7(original) zip, jevabe chhilo |
| 4_OLD_VERSIONS/reports_older | Purano report version gula |
| 4_OLD_VERSIONS/loose_files_original | Phase 7 zip er moddhe thaka purano 2 ta file + AccountsPage.zip |

## Ami ki change korechi (shudhu 5 ta file, baki same)
1. src/renderer/pages/AccountsPage.tsx -> tomar loose AccountsPage.zip er file diye replace. Fix: icon DeleteOutline -> DeleteOutlined (MUI 9 e DeleteOutline nai, typecheck fail korto).
2. tests/main/farmer.integration.test.ts -> loose zip er file diye replace. Fix: test ar real engine/config.json thakle fail korbe na.
3. reports/phase-05-shell.md, phase-06-home.md, phase-07-accounts.md -> newest version (Windows result shoho). Purano gula 4_OLD_VERSIONS/reports_older e.

Purano version 2 ta file er original: 4_OLD_VERSIONS/loose_files_original/*.phase7-zip-version

## Note
- Git: HEAD ekhono Phase 5 commit. Phase 6 ar 7 er kaj commit kora nai (working tree e ache). Chaile commit koro: git add -A && git commit -m "Phase 6-7"
- node_modules nai. Windows e: npm ci, npm run check, npm run build, npm run start (SETUP_WINDOWS.md dekho).
- Ami npm/Electron run korte pari nai (sandbox). Tai 2 ta fix file Windows e abar check kora lagbe.
- Duplicate upload (same md5) ekbar rakha hoyeche: phase4, phase5-fix, phase7, files(1)/files, files(2), files(3), files(5) zip.
- Phase 5 er boro bundle zip (phase-05-shell.zip) baad: tar sob content upore ache (md5 diye milano).

## Phase 8 update
- Phase 8 code ager session e hariye gese. Transcript theke replay kore Phase 7 er upor boshano hoyeche.
- Notun file: src/main/engineSettings.ts, src/shared/engine-settings-*.ts, src/renderer/pages/SettingsPage.tsx, src/renderer/hooks/useEngineSettings.ts, docs/configuration-reference.md, tests (rules, integration, renderer), reports/phase-08-settings.md.
- Test: rules 9/9, real-engine integration 12/12 (stand-in runner, real Vitest na), typecheck clean.
- NOT RUN (sandbox e npm nai): real Vitest, ESLint, Prettier, build, Electron, settings.test.tsx, shell.test.tsx. Windows e `npm ci` then `npm run check`.
- Git: Phase 6, 7, 8 er kaj commit kora nai (working tree e ache).
- Shutdown = app bondho hobe (PC na), shudhu clean run shesh hole. app-settings.json schema 2 (backup shoho migrate). Test: tests/main/shutdown.integration.test.ts.
- Not built on purpose: User Agent, Randomization, Collect cookies, Share data, Geolocation, Typo (docs/requirements-matrix.md A3, D1).

## Phase 10 update
- Phase 10 (secrets / API keys) is in 1_LATEST_PROJECT. Report: `reports/phase-10-secrets.md`. Docs: last section of `docs/configuration-reference.md`.
- New: src/main/secrets.ts, src/main/privatePerms.ts, src/shared/secrets-*.ts, src/renderer/components/SecretsCard.tsx, tests (rules, permissions, redaction, real-engine integration, renderer).
- Test (Linux, Node 24.21.0): tsc, eslint, prettier clean. Vitest 23 files, 292 passed, 1 skipped. Build ok.
- NOT TESTED: Windows START.bat / TEST.bat, the card on screen, Windows icacls.
- Not built on purpose: human-imitation options (see Phase 9 report).

## Phase 11 + follow-up update
- Phase 11 (logs / engine status) is in 1_LATEST_PROJECT. Report: `reports/phase-11-logs-status.md`.
- Follow-up fix: **Secrets & API keys** is now its own sidebar page (like Logs). The Telegram and Discord sidebar tabs are removed; Discord, Telegram, ntfy, PushPlus, ServerChan and the search API key are all on the Secrets page, grouped. Settings no longer shows the secrets card.
- Changed: src/renderer/{routes.ts, App.tsx}, components/{Sidebar,SecretsCard}.tsx, pages/{SecretsPage (new),SettingsPage}.tsx, tests/renderer/{shell,secrets}.test.tsx, docs requirements/feature matrices.
- Test (Linux, Node 24.21.0): tsc, eslint, prettier clean. Vitest 28 files, 338 passed, 1 skipped. Build ok.
- NOT TESTED: the page in a real Electron window; Windows START.bat / TEST.bat.
- Phase 12 is NOT started (needs `NEXT PHASE`).

## Phase 11 closing check (2026-10-13)
- Phase 11 re-verified from this ZIP: Node 24.21.0, `tsc` clean, `eslint` clean, `prettier` clean, Vitest 28 files / 338 passed / 1 skipped, build ok.
- NEW: real Electron window run under Xvfb. Logs and Secrets pages open, honest "Unknown / engine not running" states, 0 console errors. Screenshots: `reports/phase-11-screenshots/`. Helper: `scripts/capture-logs.mjs`.
- Report updated: `reports/phase-11-logs-status.md` (new section "Closing check"; copy in 2_REPORTS_LATEST).
- Still NOT TESTED: Windows START.bat / TEST.bat (needs your PC), Logs page with live lines in a window.
- Phase 12 is NOT started (needs `NEXT PHASE`).

## Phase 12 update (2026-10-14)
- Phase 12 (health panel: runtime, configuration, engine) is in 1_LATEST_PROJECT. Report: `reports/phase-12-health-runtime-config-engine.md` (copy in 2_REPORTS_LATEST).
- NEW page **Health** in the sidebar: 13 real checks (Node, Git, engine files/packages/build, config.json, accounts file, engine process/API/config/version). Failed rows say what to do. Runs when the page opens. Re-run button = Phase 13.
- Verified: Node 24.21.0, `tsc` clean, `eslint` clean, `prettier` clean, Vitest 32 files / 376 passed / 1 skipped, build ok. Real Electron window run: 0 console errors. Screenshots: `reports/phase-12-screenshots/`. Helper: `scripts/capture-health.mjs`.
- Still NOT TESTED: Windows START.bat / TEST.bat (needs your PC).
- Phase 13 is NOT started.

## Phase 13 update (2026-10-14)
- Phase 13 (health: disk, permissions, offline) is in 1_LATEST_PROJECT. Report: `reports/phase-13-health-disk-permissions-offline.md` (copy in 2_REPORTS_LATEST).
- Health page now has 17 checks. NEW group "This computer": free disk space, app data folder and engine folder read/write, internet connection (only a connection to rewards.bing.com:443 is opened; nothing is sent).
- NEW **Re-run checks** button. The checks also re-run by themselves (only while the Health page is open) when the engine or accounts file changes, when the internet goes off/on, or when you return to the window.
- Verified: Node 24.21.0, `tsc` clean, `eslint` clean, `prettier` clean, Vitest 33 files / 402 passed / 2 skipped (root-only skips), build ok. Real Electron window run: 0 console errors. Screenshots: `reports/phase-13-screenshots/`. Helper: `scripts/capture-health-13.mjs`.
- Still NOT TESTED: Windows START.bat / TEST.bat, a real permission-denied folder (needs non-root), anything on Windows.
- Phase 14 is NOT started.

## Phase 13 follow-up (2026-10-14)
- User approved: internet check host, disk limits, Health menu. Phase 6 messages that told you to type `npm run ...` now say "double-click START.bat" (new test `tests/no-typed-commands.test.ts` guards this).
- Verified: tsc / eslint / prettier clean, build ok, Vitest 34 files / 403 passed / 2 skipped (root-only).
- Phase 14 is NOT started.

## Phase 14 update (2026-10-14)
- Phase 14 (diagnostics bundle export) is in 1_LATEST_PROJECT. Report: `reports/phase-14-diagnostics-bundle.md` (copy in 2_REPORTS_LATEST).
- NEW on the **Health** page: card "Diagnostics bundle" with **Export diagnostics**. Saves ONE ZIP (README, diagnostics.json, health.txt, 3 cleaned logs). No secrets, sessions, cookies, tokens, accounts file, e-mails (shown as `<email-1>`), IPs or Windows user name. A second independent safety check blocks the save if it finds anything secret.
- The Phase 14 code from the earlier session was NOT in the Phase 13 ZIP. It was rebuilt from your 4 files + the transcript (see report section 3).
- Fixed an old Phase 13 problem: `vitest run` ended with an error code although all tests passed (unhandled network-probe rejection in `healthService.ts`).
- NEW files: src/main/{diagnosticsService,zipWriter}.ts, src/shared/{diagnostics-rules,diagnostics-types}.ts, src/renderer/components/DiagnosticsCard.tsx, tests/{diagnostics-rules.test.ts,helpers/readZip.ts,main/zipWriter.test.ts,main/diagnostics.test.ts,renderer/diagnostics.test.tsx}, scripts/capture-diagnostics.mjs. Docs: threat-model T15, feature matrix row.
- Verified (Linux, Node 24.21.0): tsc / eslint / prettier clean, build ok, Vitest 38 files / 470 passed / 3 skipped (root-only), exit code 0. Real bundle opened with `unzip -t` OK, 0 planted secrets found. Real Electron window: card visible, 0 console errors. Screenshots: `reports/phase-14-screenshots/`.
- Still NOT TESTED: Windows START.bat / TEST.bat, the Windows save window, a real permission-denied folder (needs non-root).
- Questions for you: bundle hides e-mails (app/logs show them); OK? Save folder default = Documents; OK?
- Phase 15 is done, see "Phase 15 update" below.

## Phase 15 update (2026-10-14)
- Phase 15 (troubleshooting guide) is in 1_LATEST_PROJECT. Report: `reports/phase-15-troubleshooting.md` (copy in 2_REPORTS_LATEST). Guide: `docs/troubleshooting.md` (also copied to 2_REPORTS_LATEST).
- NEW on the **Health** page: every warning, error or unknown row has an **Open guide** button. It opens the matching section of the guide in a window. The guide has 19 sections; each says what you see, what to click, where it was seen (your PC / the test machine / only in tests) and whether the fix was really tried (`VERIFIED` or `NOT TESTED`).
- Found by really trying the old advice and FIXED: the Health page said "press Reset to defaults" for a broken `config.json` (it fails) and "press Save" for a missing setting (it does not write it). The 5 texts in `src/main/healthService.ts` now say what really works (rename `config.json` to `config.broken.json`, then press **Create config** on Home; or correct one value in Notepad).
- Also fixed: the guide window showed raw `**` and backticks (seen in the real window); it now shows bold and code.
- The Phase 15 code from the earlier session was NOT in the Phase 14 ZIP. It was put back from the transcript (see report section 3), the evidence run was done again here.
- NEW files: docs/troubleshooting.md, src/shared/troubleshooting-rules.ts, src/renderer/{guide.ts,components/GuideDialog.tsx}, tests/main/troubleshooting.fixes.test.ts, tests/renderer/troubleshooting.test.tsx, scripts/capture-guide-15.mjs, reports/phase-15-evidence.txt, reports/phase-15-screenshots/.
- Verified (Linux, Node 24.21.0): tsc / eslint / prettier clean, build ok, Vitest 40 files / 496 passed / 3 skipped (root-only), exit code 0. Real Electron window: 8 Open guide buttons, one opened, 0 console errors.
- Still NOT TESTED: everything on Windows (START.bat / TEST.bat, installing Node and Git, real permissions), a real full drive, a real VPN or firewall change.
- Questions for you: should START.bat also check the engine API script (needs a Windows test)? Do you want a Repair button for a broken config.json? Both are outside Phase 15 until you say yes.
- Phase 16 is done, see "Phase 16 update" below.

## Phase 16 update (2026-10-14)
- Phase 16 (notification service, backend only) is in 1_LATEST_PROJECT. Report: `reports/phase-16-notification-service.md` (copy in 2_REPORTS_LATEST).
- NEW files: src/shared/notifications-types.ts, src/shared/notifications-rules.ts, src/main/notifications.ts, tests/notifications-rules.test.ts, tests/main/notifications.test.ts.
- CHANGED files: src/main/main.ts, src/main/ipc.ts, src/preload/preload.ts, src/shared/ipc-types.ts, tests/renderer/*.test.tsx (notification mocks), docs/configuration-reference.md.
- The Phase 16 code was not in the Phase 15 follow-ups ZIP. It was put back from the transcript. One bug was fixed (two tests started together both sent a request).
- Tested on Linux with Node 24 (tsc, eslint, vitest all pass). NOT run on Windows. Run FORMAT.bat, then TEST.bat.
- Phase 17 is NOT started (needs `NEXT PHASE`).

## Phase 17 update (2026-10-15)
- Phase 17 (notification settings UI + test action) is in 1_LATEST_PROJECT. Report: `reports/phase-17-notification-ui.md` (copy in 2_REPORTS_LATEST).
- NEW sidebar page **Notifications** (after Secrets & API keys): one card per channel (Discord, ntfy, Telegram, PushPlus), a switch saved at once, a **Send test message** button with the real result kept on screen, clear states for missing / blocked / invalid config.json and offline. ServerChan and WeChat ClawBot are listed as "Not available" with the reason.
- Phase 16 text bug FIXED: the cards said "warnings and errors by default". The engine really sends every non-debug log line to Discord, ntfy and Telegram when no log filter is on, and those lines can hold e-mail addresses. The page now says which case you are in.
- The Phase 17 code was not in the Phase 16 ZIP. It was put back from the transcript text file. One file (`src/shared/notifications-ui-rules.ts`) was not in the transcript and was written again from the tests (see report section 4).
- Verified (Linux, Node 24.21.0): tsc / eslint / prettier clean, build ok, Vitest 47 files / 637 passed / 4 skipped (root-only), exit 0. Real Electron window: 0 console errors. Screenshots: `reports/phase-17-screenshots/`.
- The 6 old Prettier files from Phase 15 were formatted (formatting only), so TEST.bat should no longer fail on formatting.
- Still NOT TESTED: Windows START.bat / TEST.bat, a real message to a real service, a real permission-denied folder.
- NOT built: editing the message title and the log filter (needs new service code). Your decision.
- Phase 18 is NOT started (needs `NEXT PHASE`).


## Phase 18 update (2026-10-15)
- Phase 18 (backup service and manifest, service only) is in 1_LATEST_PROJECT. Report: `reports/phase-18-backup-service.md` (copy in 2_REPORTS_LATEST).
- NEW files: src/shared/{backup-types,backup-rules}.ts, src/main/backupService.ts, tests/backup-rules.test.ts, tests/main/backup.test.ts. CHANGED: src/shared/farmer-types.ts (2 new error codes), docs/{configuration-reference,threat-model (T16),feature-support-matrix}.md (copies in 2_REPORTS_LATEST).
- One backup = copies of engine config.json, the accounts file and app-settings.json + manifest.json (app version, time, SHA-256 per file, skipped list, account count). Written in a hidden `.tmp-` folder, flushed, read back, manifest last, ONE rename. Folder private to the current user. Holds secrets, NOT encrypted.
- NOT connected to any button yet (no IPC, not in main.ts). The backup screen is Phase 19. START.bat / TEST.bat unchanged.
- Verified (Linux, Node 24.21.0): tsc / eslint / prettier clean, build ok, Vitest 49 files / 691 passed / 5 skipped (root-only), exit 0. Five deliberate breaks of the service were all caught by the tests (one was equivalent behavior, see report). Real run on real files: folder 700, files 600, SHA-256 of stored files = manifest.
- Still NOT TESTED: Windows START.bat / TEST.bat, Windows icacls and folder rename, a real permission-denied folder (root sandbox), a real power cut.
- Decision for you: full accounts file (with passwords) in the backup, yes or no? Encryption later? See report section 12.
- Phase 19 is NOT started (needs `NEXT PHASE`).

## Phase 19 update (2026-10-15)
- Phase 19 (backup check, Backups page, failure tests) is in 1_LATEST_PROJECT. Report: `reports/phase-19-backup-verify-ui.md` (copy in 2_REPORTS_LATEST). Screenshots: `3_SCREENSHOTS/phase-19-screenshots/`.
- NEW sidebar page **Backups** (after Health): **Create backup**, **Open backup folder**, **Check again**, the list (time, app version, files, size, status), **Inspect**. Every backup is checked after writing and again every time the list is read; a damaged one shows "Damaged: do not use". Failed backups show the exact reason and a "What to do" text (low disk, permission denied, missing file and more). The free space is checked before anything is written.
- NEW files: src/shared/backup-ui-rules.ts, src/renderer/{pages/BackupsPage.tsx,components/BackupDetailsDialog.tsx,hooks/useBackups.ts}, tests/{backup-verify-rules,backup-ui-rules}.test.ts, tests/main/backup-verify.test.ts, tests/renderer/backups.test.tsx, scripts/capture-backups-19.mjs. CHANGED: src/main/{backupService,main,ipc}.ts, src/preload/preload.ts, src/shared/{backup-types,backup-rules,ipc-types}.ts, src/renderer/{routes.ts,App.tsx,components/Sidebar.tsx}, tests/helpers/notifyBridge.ts, tests/renderer/shell.test.tsx, docs/{configuration-reference,threat-model (T17),feature-support-matrix}.md (copies in 2_REPORTS_LATEST).
- Verified (Linux, Node 24.21.0): tsc / eslint / prettier clean, build ok, Vitest 53 files / 799 passed / 7 skipped (root-only), exit 0. Ten deliberate breaks of the service were all caught. Real Electron window: create, inspect, remove a file by hand, Check again shows Damaged, 0 console errors.
- Still NOT TESTED: Windows START.bat / TEST.bat, Windows folder rename and Explorer opening, a real permission-denied file and a real full drive (root sandbox). START.bat / TEST.bat unchanged.
- NOT built on purpose: Restore (Phases 20-21), Delete, other backup folder, encryption.
- node_modules and dist are NOT in this ZIP. On Windows: double-click START.bat.
- Phase 20 is NOT started (needs `NEXT PHASE`).

## Phase 20 update (Restore: verification and pre-restore safety)
- Phase 20 is in 1_LATEST_PROJECT. Report: `reports/phase-20-restore-verification.md` (copy in 2_REPORTS_LATEST).
- New: src/main/restoreService.ts, src/shared/restore-types.ts, restore-rules.ts, restore-ui-rules.ts, src/renderer/components/RestoreDialog.tsx, tests (restore.test.ts, restore-rules.test.ts, renderer/restore.test.tsx).
- Changed: backupService.ts (loadVerified), backup-rules.ts (MANIFEST_VERSION_MESSAGE), farmer.ts (restoreBlock), ipc.ts, main.ts, preload.ts, ipc-types.ts, BackupsPage.tsx (Restore... button), test bridge stubs.
- Restore only CHECKS and makes a safety copy (<userData>/backups/pre-restore). It changes no user file. Applying a restore is Phase 21 (not started).
- Sandbox result: tsc, eslint, prettier pass; restore + backup + all renderer tests pass. Integration tests that need Node 24 and the installed engine failed in the sandbox (Node 22): run TEST.bat on Windows. START.bat / TEST.bat NOT TESTED.
- Windows TEST.bat result (user run): 882 passed, 1 failed. The failure was a test bug (tests/main/backup.test.ts hard-coded a "/" in a path check, so the fake disk error never fired on Windows). Fixed by normalising "\" to "/" in the test. Source code unchanged. Not yet re-run on Windows.

## Phase 21 update
- Phase 21 (restore apply + undo) is in 1_LATEST_PROJECT. Report: `reports/phase-21-restore-execute-undo.md`.
- Test (Linux, Node 24.22.0): tsc, eslint, prettier clean. Vitest 58 files, 957 passed, 7 skipped. Build ok.
- NOT TESTED: Windows START.bat / TEST.bat, the dialog in a real Electron window.

## Phase 22 update (PART 1 + PART 2, verdict PARTIAL)
- Wizard rules + service are in 1_LATEST_PROJECT (`src/shared/wizard-*.ts`, `src/main/setupWizard.ts`). Report: `reports/phase-22-wizard-flow.md`.
- NOT done: IPC/preload, main wiring, the screens, renderer tests, screenshots.
- Test (Linux, Node 24.22.0): tsc, eslint, prettier clean. 7 related test files, 224 tests passed. Full suite not re-run.

- PART 2 added: IPC, preload, main wiring, WizardPage screen, route #/setup, first-run redirect, tests. See the end of `reports/phase-22-wizard-flow.md`.
- Verified only with a Vitest stand-in on Node 22: 113 unit tests + 7 integration tests passed. NOT RUN: real Vitest, ESLint, Prettier, tsc, the screen, START.bat / TEST.bat. Run TEST.bat on Windows.
- Phase 23 is NOT started.

## Phase 22 completion
- Phase 22 (setup wizard) code complete: services, IPC, screens, renderer tests. Report: `reports/phase-22-wizard-flow.md` (section COMPLETION).
- Test (Linux, Node 24.22.0): tsc, eslint, prettier clean. Vitest 62 files, 1108 passed, 7 skipped.
- NOT VERIFIED: screens in a real window (no screenshots), Windows START.bat / TEST.bat.
