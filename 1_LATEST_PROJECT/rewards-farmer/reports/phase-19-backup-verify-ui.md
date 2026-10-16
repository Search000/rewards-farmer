# Phase 19: Backup verification, Backups page and failure tests

## 1. Phase and date
Phase 19, 2026-10-15. Done on Linux (Node 24.21.0, Xvfb for the Electron window). Nothing was run on Windows.

## 2. Objective
Master prompt, Phase 19: (a) verify each backup after writing it (manifest, checksums, file presence); (b) build the backup UI: create, list and inspect backups (version, timestamp, size); (c) test missing-file, permission-denied and low-disk cases during backup and show clear, actionable messages. Acceptance: every backup is verified after writing; failures never leave a half-written backup that looks valid and are shown with clear messages.

## 3. Files inspected
- `Microsoft_Rewards_Farmer_Master_Prompt_Phases_12-50.md` (Phase 19 text, rules 1 to 27).
- `rewards-farmer-MASTER-phase18.zip` (the project), `README_FILE_MAP.md`, `reports/phase-18-backup-service.md`.
- `src/main/backupService.ts`, `src/shared/backup-types.ts`, `src/shared/backup-rules.ts`, `src/main/{main,ipc,healthService,privatePerms}.ts`, `src/preload/preload.ts`, `src/shared/ipc-types.ts`, `src/renderer/{App.tsx,routes.ts}`, `components/{Sidebar,PageCard,StateBlock,ActionButton,ConfirmDialog,DiagnosticsCard,Notifications}.tsx`, `pages/NotificationsPage.tsx`, `hooks/{useNotifications,useHealth}.ts`.
- `tests/main/backup.test.ts`, `tests/helpers/notifyBridge.ts`, `tests/renderer/{shell,diagnostics,notifications}.test.tsx`, `scripts/capture-notifications-17.mjs`, `docs/{configuration-reference,threat-model,feature-support-matrix}.md`.

## 4. Files created / modified
**Starting point (please read).** The ZIP held no Phase 19 code. When I picked the work up, the working copy already held an unfinished Phase 19 start from earlier in this session: types, rules, IPC, preload and `main.ts` wiring, and a half-changed `backupService.ts` that did NOT compile (6 type errors). I read all of it, finished it and tested it. Nothing from that start was trusted without a test.

New:
- `src/shared/backup-ui-rules.ts` (page texts and small decisions, no React, no file access)
- `src/renderer/pages/BackupsPage.tsx`, `src/renderer/components/BackupDetailsDialog.tsx`, `src/renderer/hooks/useBackups.ts`
- `tests/main/backup-verify.test.ts` (55 tests, 2 root-only skips), `tests/backup-verify-rules.test.ts` (26), `tests/backup-ui-rules.test.ts` (11), `tests/renderer/backups.test.tsx` (18)
- `scripts/capture-backups-19.mjs`, `reports/phase-19-screenshots/` (5 PNG + `evidence.json`), this report

Changed:
- `src/shared/backup-types.ts` (verification, detail, fail reason + fix, bridge `BackupsApi`, IPC names)
- `src/shared/backup-rules.ts` (`verifyEntry`, free-space rule, `reasonFromErrno`, `failureFix`, `formatBytes`)
- `src/main/backupService.ts` (check after writing, `setAside`, free-space check before writing, `list()` with a fresh check, `inspect()`, `openFolder()`, reason + fix on every failure)
- `src/main/{main,ipc}.ts`, `src/preload/preload.ts`, `src/shared/ipc-types.ts` (4 backup calls, none takes a path)
- `src/renderer/{routes.ts,App.tsx}`, `components/Sidebar.tsx` (new sidebar item **Backups**, after Health)
- `tests/helpers/notifyBridge.ts` (new `installBridge` helper), `tests/renderer/shell.test.tsx` (sidebar now has 10 items)
- `docs/configuration-reference.md` (new section "Backups (Phase 19)"), `docs/threat-model.md` (new row T17), `docs/feature-support-matrix.md` (new row), `README_FILE_MAP.md`

NOT changed: `START.bat`, `TEST.bat`, `FORMAT.bat`, `package.json`, the engine, `config.json`, the accounts file.

## 5. Implementation summary
**Check after writing.** After the one rename that gives the folder its final name, the service reads the finished folder again from the disk and compares it with the manifest: manifest present, strict parser, same id as the folder, every listed file present, is a file, right size, right SHA-256. If anything is wrong the backup is reported as FAILED (`verify-failed`), and the folder is renamed to a hidden `.tmp-failed-...` name. It is not deleted (rule 10), but it can never look like a backup. If even that rename fails, the page lists it as **Damaged**.

**Check every time the list is read.** `list()` runs the same check for each backup, so a backup damaged LATER (file deleted by an antivirus, one changed byte, cut-off file, edited manifest) is shown as **Damaged: do not use**, never as OK. A folder without a usable manifest is not a backup (counted as "unfinished"). Items the manifest does not list are only a note.

**Failures (actionable).** Every failed backup returns the exact reason, a machine reason and a "What to do" text (page shows both and keeps them on screen):
- low disk: free space is asked BEFORE anything is written (needs files + 1 MB). Refused with how much is needed and how much is free; not even the folder is made. If free space cannot be read, the backup is not blocked (a really full disk is still caught while writing as `ENOSPC`).
- disk full while writing, permission denied, read-only, source unreadable, folder-instead-of-file, too large, nothing to back up, copy differs, verify failed: each has its own text naming real buttons and pages (Create backup, Health page rows, Home page). No typed commands (rule 27).
- missing file: a source that does not exist yet is skipped and stated in the result and in the list; the backup is still checked.

**Page.** Sidebar item **Backups**. Intro, a permanent security warning (holds real secrets, not encrypted, only your Windows account can open the folder), **Create backup** (busy while running, one at a time), **Open backup folder** (main opens the fixed folder; disabled until a folder exists), **Check again**, a summary sentence that never says "all good" when one is damaged, one row per backup (time, app version, files, size, skipped items, status chip, **Inspect**), the unfinished count. **Inspect** shows the manifest facts (id, time, app version, platform, size, account COUNT), a fresh check with each problem, each file (name, size, short SHA-256, "Holds secrets") and what was not included. Honest states: outside Electron, loading, list unreadable (with next step), empty.

**Security.** No bridge call takes a path. `inspectBackup(id)` accepts only the strict id format before touching the disk (tests: `..`, slashes, drive letters, `.tmp-` names, non-strings are all refused with zero disk access). Results, fixes, audit and app logs hold names, sizes and plain reasons only.

**Not built, on purpose:** Restore (Phases 20 and 21), Delete (needs your approval, rule 10), a different backup folder, encryption.

## 6. Commands actually run
All on Linux, Node 24.21.0 (npm package `node@24`; the sandbox default is Node 22).
- `npx vitest run` (baseline, before any change), `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, `npx vitest run` (whole suite), `npm run build`
- Ten deliberate breaks of `backupService.ts` / `backup-rules.ts`, each followed by a run of the three backup test files, each restored afterwards (`diff` printed nothing)
- `node scripts/capture-backups-19.mjs reports/phase-19-screenshots` (the REAL built app in Electron under Xvfb, throw-away user-data folder, FAKE accounts file, temporary `engine/config.json` copy of `config.example.json`, removed afterwards)
- `START.bat` / `TEST.bat`: **NOT TESTED** (no Windows here). They were not changed. `tests/launchers.test.ts` (static file checks) passes inside the full run.

## 7. Actual command outputs / test evidence
- Baseline before the phase: 49 files, 691 passed, 5 skipped.
- `tsc --noEmit`: exit 0. `eslint .`: exit 0. `prettier --check .`: "All matched files use Prettier code style!"
- `vitest run` (whole suite): **Test Files 53 passed (53); Tests 799 passed, 7 skipped (806); exit 0.** The difference to the baseline is exactly the four new files: 53 + 26 + 11 + 18 = 108 new passing tests, plus 2 new root-only skips.
- `npm run build`: exit 0 (`built in 603ms`). `dist/` is not in the ZIP.
- Mutation check (do the tests really catch bugs?). All ten were caught:

| Deliberate break | Tests that failed |
| --- | --- |
| checksum comparison switched off | 2 |
| size comparison switched off | 3 |
| no check after writing | 2 |
| a failed backup is not set aside (no rename) | 2 |
| free-space check switched off | 3 |
| free-space rule needs no reserve | 3 |
| `inspect` accepts any name | 9 |
| `list` marks a damaged backup OK | 9 |
| a missing file is not reported as missing | 1 |
| `ENOSPC` mapped to the wrong reason | 1 |

- Real window run (the built app, Xvfb), from `reports/phase-19-screenshots/evidence.json`:
  - empty page: "There is no backup yet."
  - pressed **Create backup**: "Backup backup-20261015-062710-223 created and checked: 3 file(s), 3.9 KB, every checksum matches."; list: "1 backup. Every one passed the check just now." chip "Checked: OK"
  - **Inspect**: three files with name, size, short SHA-256, "Holds secrets" on config and accounts, not on app settings
  - removed `accounts.env` from that backup folder on the disk, pressed **Check again**: "1 backup. 1 failed the check and must not be used." chip "Damaged: do not use"; Inspect: "Accounts file (accounts.env) is missing from the backup."
  - console problems: **0**
- What the service tests cover: check reads the finished folder from the disk; damage right after the rename (the backup is NOT created, hidden `.tmp-failed-` folder, never listed); damage AND failing set-aside (listed as Damaged, message says so); later damage (deleted file, one changed byte, longer file, cut-off file, edited manifest checksum, file replaced by a folder, missing manifest, extra item = note only); good and damaged side by side; unreadable backup file (injected `EACCES`); inspect (no content, no path, no secret; 9 hostile names and 5 non-strings refused with zero disk access; not found; no manifest); open folder (no folder yet, exact folder, system error without path, throwing call, not available); low disk (before writing, nothing written, exact boundary, free space unreadable or throwing does not block); disk full on the second file; permission denied (making the folder, writing a file, reading your own file); read-only; missing accounts / config / settings; nothing to back up; a source that is a folder; every fix text names a real place and no typed command; no FAKE secret, e-mail or folder path in any failure result or log; originals untouched and a second try works.
- What the 18 page tests cover: outside Electron; list with statuses; empty; unfinished count; Create (busy, one call, result, list read again); three failure texts (low disk, permission denied, missing file) with "What to do"; bridge failure; Inspect (OK, damaged, failed); Open folder; unreadable folder; Try again; no Restore or Delete button; and TWO tests against the REAL service on real files (create from the page, delete a file, **Check again** shows Damaged, nothing secret or personal on the page; real low-disk text).

## 8. Acceptance criteria checklist
- Every backup is verified after writing: **PASS** (tests; real window run).
- Failures never leave a half-written backup that looks valid: **PASS** in tests for disk full, wrong copy, failing rename, damage after the rename, damage plus failing set-aside, hand-made leftovers. A real power cut or a killed process: **NOT TESTED** (simulated by failing operations only).
- Failures are shown with clear, actionable messages: **PASS** (service texts, page tests, real service on the page).
- Backup UI: create / list / inspect with version, timestamp, size: **PASS** (page tests, real window).
- Missing-file case: **PASS**. Low-disk case: **PASS** (injected free space and `ENOSPC`; a real full disk: **NOT TESTED**). Permission-denied case: **PASS** with injected `EACCES` / `EPERM`; the two tests with a REAL `chmod 000` file are **SKIPPED** here because the sandbox runs as root (they run on a normal account).
- Rule 17 (no control without an action): every enabled control calls the real service; Open backup folder is disabled with a reason until a folder exists. There is no Restore or Delete button.
- Rules 23 to 25: `START.bat` / `TEST.bat` unchanged and **NOT TESTED** on Windows.

## 9. Known issues and unresolved questions
- **Windows is not tested.** Folder rename on NTFS, `icacls`, `shell.openPath` opening Explorer, `START.bat`, `TEST.bat`: NOT TESTED. The old Windows worker crash (exit 3221226505) is still undiagnosed.
- A real permission-denied file and a real full drive were not tested (root sandbox, no tiny disk); injected errors only.
- The check proves a backup is unchanged since it was made. It cannot prove the source was right, and a changed file together with a matching manifest edit would pass (no signature or encryption).
- `.tmp-` and `.tmp-failed-` folders are only counted, never deleted by the app. A "clean up" button needs your consent and is not built.
- The troubleshooting guide (Phase 15) has no section for backup failures yet; the page shows the fix text itself. Adding guide sections needs Windows-tested fixes (my fix texts are `NOT TESTED` on Windows).
- The list checks every backup each time it is read. With very many backups this gets slow (each is a few KB; no limit or paging yet).

## 10. Security / data impact
- New data on disk: only when you press **Create backup**, as in Phase 18 (`<app data>/backups/full/...`, private to your Windows account). A backup that fails its check is renamed to a hidden `.tmp-failed-` folder in the same place.
- No change to `config.json`, the accounts file, sessions or settings. The service only reads them. No network request, no new dependency.
- Four new bridge calls, none takes a path; the id is checked against a strict format in main. Threat model row **T17**.
- Backups still hold real secrets and are NOT encrypted (the page says so permanently).
- Test data is FAKE and lives in temp folders only. The capture run used a throw-away user-data folder and a FAKE accounts file. This ZIP holds no `.env`, sessions, real accounts, `node_modules`, `dist`, `engine/config.json` or logs.

## 11. Verdict
**PASS** for the Phase 19 acceptance criteria (Linux, service, page and real Electron window). Everything that needs Windows is **NOT TESTED**.

## 12. User decision required
1. **Sidebar place.** I put **Backups** after Health. OK, or somewhere else?
2. **Damaged backups and leftovers.** The app never deletes them (rule 10). Do you want a "Delete this backup" or "Clean up unfinished items" button later, with a confirm dialog? Default: no.
3. **Backup folder.** Still `<app data>/backups/full`. Do you want a setting for another drive?
4. **Accounts file in the backup (from Phase 18).** Full copy with passwords is still the default. Same question as before: keep, or save without passwords? And do you want optional encryption later?
5. Please double-click `TEST.bat` on Windows when you can. It should now run 53 test files.

## 13. Explicit stop notice
I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.
