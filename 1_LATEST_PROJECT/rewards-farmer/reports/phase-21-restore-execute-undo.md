# Phase 21 - Restore: execution, undo and round-trip

## What was built
- Apply restore (`RestoreService.apply(id, confirmed)`): runs only when `confirmed === true` (exactly). Checks the backup again from scratch, makes a fresh checked safety copy, writes the restore record (journal) BEFORE the first file, writes each file atomically, reads each one back (size + SHA-256 vs backup), then marks the record finished.
- Rollback: if one write fails or reads back wrong, the files already written are put back from the safety copy and checked. If that put-back also fails, the state is "interrupted" and Undo finishes the job. New restores are refused until an interrupted one is undone.
- Undo (`undo(confirmed)`): puts every changed file back from the pre-restore safety copy; a file the restore created is removed. First makes a new safety copy of the files as they are now, so nothing is lost. Refused while a run is active, if another accounts file was chosen, or if the safety copy is damaged.
- Interrupted restore/undo: found again after restart (`history()` = `interrupted` / `undo-interrupted`); running Undo again finishes it.
- Record is checked: damaged or hand-edited record (for example a role outside the three files) is not trusted.
- App: app locked during restore (`FarmerService.runRestoreExclusive`), engine reads the files again afterwards (`reloadAfterRestore`); a missing app-settings file means defaults.
- UI: confirm checkbox + "Restore now" (disabled with reason until ticked), result and failure boxes, "Last restore" box on the Backups page with Undo + confirm dialog.
- IPC/preload: `restore:apply`, `restore:undo`, `restore:history`. Apply takes id + confirmation; undo only the confirmation.

## Files changed (main ones)
src/main/restoreService.ts, src/main/farmer.ts, src/main/appSettings.ts, src/main/main.ts, src/main/ipc.ts, src/preload/preload.ts, src/shared/restore-types.ts, restore-rules.ts, restore-ui-rules.ts, ipc-types.ts, src/renderer/components/RestoreDialog.tsx, src/renderer/pages/BackupsPage.tsx, src/renderer/hooks/useRestoreHistory.ts.
Tests: tests/main/restore-apply.test.ts (new, 45), tests/main/restore.test.ts, tests/restore-ui-rules.test.ts (new), tests/renderer/restore.test.tsx (+5), bridge stubs in other renderer tests.

## Commands run and observed results (Linux sandbox, Node 24.22.0, engine installed and built)
- `tsc --noEmit`: exit 0. `eslint .`: exit 0. `prettier --check .`: all files pass. `npm run build`: ok.
- `vitest run` (all): Test Files 58 passed (58); Tests 957 passed, 7 skipped (964). Duration 203 s.
- Phase 21 evidence: round trip backup -> change -> restore -> undo -> restore again loses no data; interrupted restore (never-finishing write) found after "restart" and undone; failing disk rolled back; undo interrupted and finished; no secret in results, record or logs.
- `START.bat` / `TEST.bat`: NOT TESTED (no Windows here). Run TEST.bat on your PC.

## Notes
- Node 24 for the test run came from the npm package `node@24`; engine `npm ci` and build were done only for testing. They are not in the ZIP.
- No screenshots were taken (no Electron window here): NOT VERIFIED on screen.

## Verdict
Phase 21 code complete and automatically tested. Windows TEST.bat and on-screen check pending. STOP: Phase 22 not started.
