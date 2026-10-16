# Phase 07 Report: Accounts screen and account data lifecycle

## 1. Phase and date
Phase 7, 2026-10-11. Linux sandbox, Node 22.22.0, **no npm registry** (no `npm ci`, no Electron, no React, no MUI, no real Vitest, no jsdom), no Windows.

**How this package was made (read first).** The Phase 7 files written in earlier sessions were never saved into a ZIP. The log `New_Text_Document.txt` holds the exact file-writing commands of the last Phase 7 session (11 blocks: shared types, validation rules, `.env` editor, `AccountsService`, patches to `farmer.ts`/`ipc.ts`/`preload.ts`/`main.ts`, two test files, helper patch, last `langCode` patch). I replayed those blocks in log order on top of `rewards-farmer-phase6.zip` (the user's newest Phase 6 package). Every block exited 0. The renderer part (hook, page, dialog, route, renderer tests) was never saved in that log, so I wrote it new in this session.

## 2. Objective
Accounts screen (screenshot 2) on the real account store: list from the real file, add / edit / remove only through guarded, backed-up, atomic writes, honest empty / loading / error / disabled states, no secrets in the window or in logs.

## 3. Files inspected
`Microsoft_Rewards_Farmer_Master_Prompt_15_Phases.md`, `New_Text_Document.txt` (tail, block map, Phase 7 blocks), `phase-04..06` reports, `farmer.integration.test.ts`, `rewards-farmer-phase6.zip` (full tree), screenshot 2 (`photo_...968_y.jpg`), `docs/requirements-matrix.md`, `docs/architecture.md` section 5, `engine/src/util/Validator.ts` (AccountSchema), renderer components `PageCard`, `StateBlock`, `ConfirmDialog`, `ActionButton`, `LabeledField`, `Notifications`, `DisabledReason`, `HomePage`, `useFarmerState`, `App.tsx`, `routes.ts`.

## 4. Files created/modified
New (replayed from log): `src/shared/{accounts-types,accounts-rules}.ts`, `src/main/engine/envEdit.ts`, `src/main/accounts.ts`, `tests/main/{envEdit.test,accounts.integration.test}.ts`.
New (written this session): `src/renderer/hooks/useAccountsState.ts`, `src/renderer/components/AccountDialog.tsx`, `src/renderer/pages/AccountsPage.tsx`, `tests/renderer/accounts.test.tsx`, this report.
Modified: `src/main/{farmer,ipc,main}.ts`, `src/preload/preload.ts` (replayed), `tests/main/helpers.ts` (replayed, adds `redactor`), `src/renderer/App.tsx` (route), `tests/renderer/home.test.tsx` (bridge stand-in now has the 4 account methods, otherwise the typecheck would fail), `SETUP_WINDOWS.md` (section 12).
Not touched: `engine/`, `package.json`, `package-lock.json`.

## 5. Implementation summary
- **Store**: only the accounts `.env` chosen on Home. `AccountsService` lists slots `ACCOUNT_N_*` as flags (`hasPassword`, `hasTotp`, ...), language/region, proxy address without credentials, and the problems the engine itself would reject (same rules as `Validator.ts`). Secret VALUES never leave the main process.
- **Change path** (add/edit/remove): refuse during a run or while busy, backup copy first (mode 0600, private folder), edit in memory keeping comments / other accounts / CRLF / BOM / file mode, check nothing else moved, check the file did not change on disk meanwhile, temp file + flush + rename, read back, restart the engine on the new file, audit entry (e-mail yes, secrets no). Changes are serialized. Removing the last account stops the engine.
- **Stale list guard**: edit/remove send `slot` + the e-mail the user saw; main refuses if the slot now holds another account.
- **Renderer**: `AccountsPage` (list, chips, engine-problem warnings, file path, last backup, Add button bottom right like screenshot 2), `AccountDialog` (same validation as main for instant hints, shown after the first Save; server refusal shown inside the dialog), remove confirmation dialog, disabled controls with a reason tooltip (rule 17). List is read again when the Home state changes.
- Empty state text is the exact text of screenshot 2.

## 6. Commands actually run (this session)
`unzip` of the uploaded archives into separate folders; a Python extractor for the 11 logged blocks; replay with `bash` (paths rewritten to my work folder); `prettier --write` (3.8.1, project pins 3.9.10) on `src` and `tests`; stand-in test runner (extracted from the log) with `node` 22 on a temp copy where `MIN_NODE_MAJOR` 24 was changed to 22; `tsc` (TypeScript from the sandbox) over `src/main`, `src/shared`, `src/preload`; a `ts.transpileModule` syntax pass over every `.ts/.tsx/.mts` file in `src` and `tests`. Tried `npm view`/`curl` to the npm registry: unreachable (no route), not worked around.

## 7. Actual command outputs / test evidence
- Replay: all 11 blocks exit 0; files exist with expected sizes (accounts.ts 479 lines, envEdit.ts 229, accounts-rules.ts 288, accounts.integration.test.ts 461).
- `envEdit.test.ts` + `accounts.integration.test.ts` under the stand-in runner: `RESULT pass=67 fail=0 skipped=0`. The integration file runs against the **real, unmodified engine API** (`engine/scripts/api/server.js`) with the fake bot fixture.
- Phase 6 regression with the same runner: `farmer.integration.test.ts` **25/25**; `units.test.ts` 21 pass, 4 fail, 1 skipped (same 4 as in the log: the runner has no fake timers and no fetch mock, not a code fault); `stale-engine.test.ts` cannot load in this runner (`describe.skipIf` missing), so it did NOT run.
- Typecheck main/shared/preload: no errors except the known noise from the missing `electron` package (`ipc.ts` lines 44-45 and implicit-any callbacks that follow from it).
- Syntax pass: 0 files with syntax errors in `src` and `tests`, including the new renderer files.
- Prettier: new/changed files formatted with 3.8.1.
- From your log (earlier session, quoted, NOT re-run): mutation checks (extra line injected into the file, engine reload removed) made the tests fail, so the tests do detect those faults.

## 8. Acceptance criteria checklist
- Inspect real storage format before modifying: DONE (engine loader and Validator read; editor keeps unknown lines).
- Listing and details from real data: DONE in main (28 integration tests, real engine API). Rendering: NOT TESTED (no React/MUI here).
- Add/import/remove safely, confirm destructive actions: add/edit/remove DONE and tested in main; confirm dialog written, NOT TESTED. Import: not offered (file is chosen on Home).
- Preserve session data and permissions: DONE (sessions are never touched; file mode, BOM, CRLF kept; tested).
- Empty, loading, error, selected states: written; renderer tests written (14), **NOT RUN**.
- No identifiers or secrets in logs: DONE (audit test checks no password, 2FA secret, proxy password).
- Backup/restore: backup DONE (tested: backup holds the exact old bytes, backup failure changes nothing). Restore: NOT IMPLEMENTED (manual copy from the backup folder).
- Never create fake production accounts: DONE (fakes only in temp dirs of tests).
- `npm run check`, renderer tests, build, real window, screenshots: **NOT TESTED** here.

## 9. Known issues and unresolved questions
1. **Renderer is unverified.** `useAccountsState.ts`, `AccountDialog.tsx`, `AccountsPage.tsx`, `accounts.test.tsx` were never typechecked or run. MUI 9 API details (`ListItem secondaryAction`, `slotProps`) are assumed from earlier MUI versions. Expect small type fixes on the first Windows `npm run check`.
2. Prettier here is 3.8.1, project 3.9.10: run `npm run format` first on Windows.
3. `stale-engine.test.ts` and 2 Scheduler tests were not run in this session (runner limits). They passed on Windows in Phase 6.
4. No restore button; backups pile up in `backups\accounts` (never deleted by the app, rule 10).
5. Phase 6 items still open from your side: `npm run start` window not yet seen on Windows, real-account run, Home screenshots.
6. Screenshot 2 shows only the empty state; the populated list layout is my design (cards with chips), not a copy. Needs your review.
7. Engine still has 2 high `npm audit` items (Phase 12). Design-system menu item still visible. Discord icon stand-in.

## 10. Security/data impact
Reads and writes only the accounts file you chose, plus backup copies (contain secrets, mode 0600, private folder, never in Git). The window receives flags and e-mails, never passwords, 2FA secrets, recovery e-mails or proxy credentials. Main treats the window as untrusted: exact-shape check, length limits, full re-validation. No network calls beyond 127.0.0.1. No telemetry.

## 11. Verdict
**PARTIAL.** Main-process side verified in this session against the real engine API (67/67 and Phase 6 regression 25/25 under a stand-in runner). Renderer, full typecheck, lint, real Vitest, build, window and screenshots NOT verified.

## 12. User decision required
1. On Windows, from a fresh unzip, **[CMD]**: `npm ci`, `npm run format`, `npm run check`, `npm run build`, `npm run start`. Send me the output. Failures get fixed inside Phase 7.
2. With the app open: Accounts page screenshot (no file yet, and with a file), then Add a FAKE account, Edit it, Remove it. Check the backup folder.
3. Is the list layout OK, or do you want a different one?
4. When satisfied, say `NEXT PHASE` for Phase 8 (Settings).

## 13. Explicit stop notice
I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.
