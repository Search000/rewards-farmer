# Phase 20 - Restore: verification and pre-restore safety

## What was built
- Restore check (`src/main/restoreService.ts`, `src/shared/restore-rules.ts`, `restore-types.ts`, `restore-ui-rules.ts`): manifest, every file, size, SHA-256, app version, settings schema, and each file's own content are checked before anything else.
- Preview: per file `replace / create / unchanged / keep / cannot-restore`, with blockers and warnings. A restore never deletes a file.
- Safety copy ("pre-restore snapshot"): written and read back (sizes + SHA-256) into `<userData>/backups/pre-restore`, before any change could happen. If it fails, the restore stops.
- UI: **Restore...** button on the Backups page (disabled with a reason when the backup failed its check) and the Restore window up to the confirmation step. The last button "Restore now" is disabled with its reason (rule 17). Applying a restore is Phase 21.
- Wiring: `BackupService.loadVerified`, `MANIFEST_VERSION_MESSAGE`, `FarmerService.restoreBlock()`, IPC `restore:preview` / `restore:prepare` (one backup id, nothing else), preload, main.

## Decision for the user
If the backup remembers another accounts-file place, the restore keeps the accounts file chosen now, puts the saved accounts into it, and restores all other settings. A warning says so.

## Files changed in this finishing step
backupService.ts, backup-rules.ts, farmer.ts, ipc.ts, main.ts, preload.ts, ipc-types.ts, BackupsPage.tsx, tests/renderer/backups.test.tsx, tests/renderer/restore.test.tsx (new), tests/main/restore.test.ts (+1 test), test bridge stubs.

## Commands run and observed results (Linux sandbox, Node 22.22.2)
- `tsc --noEmit`: pass. `eslint .`: pass.
- Pass: restore 55 (main) + 23 (rules), backup rules/ui/verify, backup service, launchers, repo-hygiene, no-typed-commands, all 15 renderer files (184 tests).
- Not passing here: accounts.integration, accountsAuto, engineSettings.integration, engine-settings-rules (1), farmer.integration (timeout). Observed cause in accountsAuto: "Node.js 24+ needed (version 22 found)", and `engine/node_modules` is not installed. Not re-run on Node 24 with the engine installed; so NOT VERIFIED there.
- Test files after farmer.integration in alphabetical order were not run (limit reached).
- `START.bat` / `TEST.bat`: NOT TESTED (no Windows here). Run TEST.bat on your PC.

## Verdict
Phase 20 code complete. Full verification pending TEST.bat on Windows (Node 24, engine installed). STOP: Phase 21 not started.
