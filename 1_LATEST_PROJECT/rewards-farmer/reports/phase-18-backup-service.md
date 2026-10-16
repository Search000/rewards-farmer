# Phase 18: Backup service and manifest

## 1. Phase and date
Phase 18, 2026-10-15. Done on Linux (Node 24.21.0). Nothing was run on Windows.

## 2. Objective
Build the backup service: back up config, accounts metadata and settings (secrets handled by the Phase 10 rules), write a manifest with app version, time and checksums, and write each backup to a temporary place first so a half-written backup never looks valid (master prompt, Phase 18). Service only. The backup screen is Phase 19.

## 3. Files inspected
- `Microsoft_Rewards_Farmer_Master_Prompt_Phases_12-50.md` (Phase 18 text, rules 1 to 27).
- The Phase 17 ZIP `rewards-farmer-MASTER-phase17.zip`. This time the Phase 17 code WAS inside it, so nothing had to be put back.
- `README_FILE_MAP.md`, `docs/threat-model.md` (T4, T6), `docs/configuration-reference.md`, `reports/phase-17-notification-ui.md` (report style).
- `src/main/secrets.ts`, `src/shared/secrets-rules.ts` (Phase 10 rules), `src/main/accounts.ts` (existing account backups), `src/main/privatePerms.ts`, `src/main/jsonlLog.ts`, `src/main/appSettings.ts`, `src/main/engine/redact.ts`, `src/main/zipWriter.ts`, `src/main/main.ts`, `src/shared/farmer-types.ts`, `src/shared/accounts-types.ts`.
- `tests/main/helpers.ts`, `tests/main/secrets.integration.test.ts`, `tests/fixtures/fake-secrets.ts`, `tests/repo-hygiene.test.ts`, `tests/launchers.test.ts`, `vitest.config.mts`, `eslint.config.mjs`, `.gitignore`.

## 4. Files created / modified
New:
- `src/shared/backup-types.ts` (manifest, summary and result types)
- `src/shared/backup-rules.ts` (fixed file names, id format, account counter, strict manifest check)
- `src/main/backupService.ts` (the service)
- `tests/backup-rules.test.ts` (28 tests), `tests/main/backup.test.ts` (26 tests + 1 root-only skip)
- `reports/phase-18-backup-service.md` (this file)

Changed:
- `src/shared/farmer-types.ts`: two new error codes `READ_FAILED` and `BACKUP_EMPTY`.
- `docs/configuration-reference.md` (new section "Backups (Phase 18, service only)"), `docs/threat-model.md` (new row T16), `docs/feature-support-matrix.md` (new row).
- `README_FILE_MAP.md` (Phase 18 section).

NOT changed: `START.bat`, `TEST.bat` (byte-identical to the Phase 17 ZIP, checked with `cmp`), `main.ts`, `ipc.ts`, `preload.ts`, anything in `src/renderer`.

## 5. Implementation summary
**What a backup holds** (folder `<app data>/backups/full/backup-YYYYMMDD-HHMMSS-mmm/`):
- `engine-config.json`: copy of the engine `config.json` (can hold webhook tokens).
- `accounts.env`: copy of the accounts file you chose on Home (holds passwords and 2FA secrets).
- `app-settings.json`: copy of the app settings (no secrets).
- `manifest.json`: written by the service. Version 1. App version, time, platform, per file: fixed name, size, SHA-256, "contains secrets"; the skipped list with reasons; total size; the NUMBER of accounts.

Not in a backup: browser sessions, logs, engine program, `node_modules`.

**Missing sources.** A file that does not exist yet (or no accounts file chosen) is skipped, and the manifest and the result text say so. Any other read problem (permission denied, a folder instead of a file, a file over 20 MB) stops the whole backup with `READ_FAILED`. Nothing at all to save gives `BACKUP_EMPTY` and creates no folder.

**Never a half-written backup.**
1. Sources are read once into memory. The originals are never touched.
2. The backup folder and a hidden `.tmp-backup-...` folder are made private first (POSIX 700; Windows `icacls`), then files are written (mode 600).
3. Each file is flushed to disk and read back. Its checksum must equal the original's.
4. The manifest is written LAST and read back through the strict parser (`parseManifest`).
5. ONE rename turns `.tmp-...` into `backup-...`.
6. If anything fails before that, the temporary folder is removed. If it cannot be removed, it stays hidden, the message says so, and it is counted as "unfinished". It is never listed and never used as a backup.

**Secrets (Phase 10 rules).** Values never go to the renderer, the audit log, the result text, an error text or the manifest. Error texts use plain words for the error code (`permission denied`, `the disk is full`), never a folder path (a path can hold the Windows user name). The audit line holds the backup id, file count, size and skipped count only.

**Small read-only `list()`.** It was needed to prove "an incomplete backup is never presented as valid". It lists only folders whose `manifest.json` passes the strict check AND whose id equals the folder name. Everything else (temp folders, folders without a manifest, a copied manifest in a differently named folder) is only counted as "unfinished". It does NOT verify checksums. That is Phase 19.

**Not connected to anything.** The service is not created in `main.ts` and has no IPC route or button. `grep` shows `backupService` is used only by its own file and the tests. So nothing in the app can start a backup yet (rule 17: no control without an action). Phase 19 adds the connection and the screen.

## 6. Commands actually run
All on Linux. Node 24.21.0 (npm package `node@24`; the sandbox default is Node 22).
- `npm ci` (root), `npm --prefix engine ci --ignore-scripts --replace-registry-host=always`
- `npx tsc --noEmit` (before and after the changes), `npx eslint .`, `npx prettier --check .`
- `npx vitest run tests/backup-rules.test.ts`, `npx vitest run tests/main/backup.test.ts`, then `npx vitest run` (whole suite, one run)
- Mutation check: five deliberate breaks of `backupService.ts`, each followed by `vitest run tests/main/backup.test.ts`, then the file was restored (`diff` against the saved copy printed nothing)
- `npm run build`
- A real run of the service on real files (bundled with esbuild, outside the project, temp folder deleted afterwards), then `sha256sum` on the stored files
- `START.bat` / `TEST.bat`: **NOT TESTED** (no Windows here). They were not changed. `tests/launchers.test.ts` (static file checks) passes inside the full run.

## 7. Actual command outputs / test evidence
- `prettier --check .`: "All matched files use Prettier code style!"
- `tsc --noEmit`: no output, exit 0. `eslint .`: no output, exit 0.
- `vitest run` (whole suite): **Test Files 49 passed (49); Tests 691 passed, 5 skipped (696); exit 0.** Before this phase: 47 files, 637 passed, 4 skipped. The difference is exactly the two new files: 28 + 26 passed, plus 1 new root-only skip.
- `npm run build`: exit 0 (`built in 651ms`). The `dist` folder was deleted again, it is not in the ZIP.
- Mutation check (do the tests really catch bugs?):
  - no clean-up of the temp folder after a failure: **4 tests failed**
  - read-back checksum compare switched off: **1 test failed**
  - files written straight into the final folder (no temp folder): **3 tests failed**
  - permissions tightened after writing instead of before: **2 tests failed**
  - `list()` also accepting temp folders: **0 failed**. Checked why: such a folder is still rejected by the second rule (the manifest id must equal the folder name), so the behavior is the same. Not a test gap.
- Real run on real files (the engine's real `config.example.json`, a FAKE accounts file, a fake settings file):
  - result: `Backup backup-20261014-223042-560 created: 3 file(s), 3.7 KB.`
  - folder mode 700, every file mode 600 (read from the disk)
  - `sha256sum` of the three stored files equals the three checksums in `manifest.json` (first 70 characters compared per line, all three match)
  - `list()` shows exactly that one backup, 0 unfinished
  - the audit line: `backup-...: 3 file(s), 3.7 KB, 0 skipped (contents not logged).` No address, no password, no path.
- What the 26 service tests cover: byte-identical copies; checksums computed independently in the test; originals unchanged; manifest written last; two backups in one millisecond; two requests at once; skipped sources; nothing to back up; unreadable source; folder / oversize source; disk full on the second file; one wrong byte in a copy; failing rename; failing rename AND failing clean-up (leftover hidden folder never listed); hand-made unfinished folders; `list()` on a missing or unreadable folder; no FAKE secret, e-mail or folder path in the manifest, the result, the audit log or any error text; private folder before the first secret byte; mode 700 / 600; failing permission change shown as a note.

## 8. Acceptance criteria checklist
- A backup is created with a manifest and checksums: **PASS** (tests and the real run, checksums re-checked with `sha256sum`).
- An incomplete backup is never presented as valid: **PASS** in tests for: disk full, a wrong copy, a failing rename, a crash with failing clean-up, hand-made leftovers. A real power cut or a killed process: **NOT TESTED** (simulated only by the failing-operations above).
- Manifest has app version, timestamp, checksums: **PASS**.
- Written to a temporary location, moved into place only when complete: **PASS**.
- Secrets handled per the Phase 10 rules: **PASS** in tests (nothing secret in manifest, result, audit, errors; private folder from the start). Windows `icacls`: **NOT TESTED**.

## 9. Known issues and unresolved questions
- **Windows is not tested.** `icacls`, the folder rename on NTFS, `START.bat`, `TEST.bat`: NOT TESTED. The old Windows worker crash (exit 3221226505) is still undiagnosed.
- **A real permission-denied folder** test is skipped here because the sandbox runs as root (it runs on a normal user account). The same case is covered by an injected `EACCES`.
- **The backup is not encrypted** and holds real secrets (a restore needs them). Anyone who can open your Windows account can open it. Do not put the folder in a synced or shared place.
- **`list()` does not verify checksums.** A backup file that is changed or deleted by hand after the backup is NOT noticed yet. Verification is Phase 19, restore is Phases 20 and 21.
- Unfinished `.tmp-` folders from a real crash are only counted, never deleted by the app. Removing them needs your consent and is not built.
- No backup is made automatically, and none can be started from the app yet.

## 10. Security / data impact
- New data on disk: only when something calls the service (nothing does yet): `<app data>/backups/full/...`, private to the current user. `backups/` is already git-ignored (`tests/repo-hygiene.test.ts` passes).
- No change to `config.json`, the accounts file, sessions or settings. The service only reads them (the test compares their checksums before and after).
- No network request, no new dependency, no renderer or IPC change.
- Test data is FAKE and lives in temp folders only. This ZIP holds no `.env`, sessions, real accounts, `node_modules`, `dist` or logs.
- New threat model row **T16** (secrets in the backup, half-written backup).

## 11. Verdict
**PASS** for the Phase 18 acceptance criteria (Linux, service level). Everything that needs Windows is **NOT TESTED**, and the service is deliberately not connected to a button yet.

## 12. User decision required
1. **Accounts file in the backup.** The prompt says "accounts metadata". I saved the FULL accounts file (with passwords and 2FA secrets) in the private folder, like the existing Phase 7 account backups do. Reason: a restore with no passwords is not a real restore (Phase 21: "no data loss"). The manifest itself holds only the account NUMBER, never an e-mail. Alternative: a backup without passwords (smaller risk, but you would have to type every password again after a restore). Default: full copy. Please say if you want the other way.
2. **Encryption.** Not built. Do you want an optional password for backups in a later phase? Default: no.
3. **Where backups live.** `<app data>/backups/full`. A different folder (for example a second drive) would be a Phase 19 setting if you want it.
4. Please double-click `TEST.bat` on Windows when you can. It should now run 49 test files.

## 13. Explicit stop notice
I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.
