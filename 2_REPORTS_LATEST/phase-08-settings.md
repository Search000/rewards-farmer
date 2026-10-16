# Phase 08 Report: Settings and task settings

Date: 2026-10-11. Environment: Linux sandbox, Node 22.22.2, **no npm registry** (no `npm ci`, no real Vitest, no React, no MUI, no jsdom, no Electron), no Windows.

## What was built

- `src/shared/engine-settings-types.ts`, `src/shared/engine-settings-rules.ts`: one table (`FIELDS`) maps each control to a real `config.json` path. 14 controls: Log level, Browser, Headless, Use proxy for search queries, Disable images, Parallel mode, and 8 task toggles.
- `src/main/engineSettings.ts`: reads config with the engine's `GET /config`, writes only changed fields with the engine's validated `PATCH /config`, makes a backup first, reads back, writes an audit line. Reset restores the example values for the mapped fields only.
- IPC, preload, `main.ts` wiring; `Farmer` blocks saves while a run starts or is active.
- `src/renderer/pages/SettingsPage.tsx`, `hooks/useEngineSettings.ts`: Save, Discard, Reset (with confirm), unsaved-change warning, unsaved-change prompt when leaving the page (`App.tsx`), missing-field notice, disabled controls with the reason.
- `docs/configuration-reference.md`: field, path, type, default, allowed values, restart requirement.
- **Shutdown** (app setting): closes this app after a run that finished without errors. Stored in `app-settings.json` (schema 1 -> 2, backup copy first). Not for the PC. Switch is saved at once, not part of Save/Discard. Stop by the user or an error run does not close the app.

## Layout (matches screenshots 3-7)

The page follows the screenshots: top "Settings" card (User Agent rows, Reset to defaults, Save), then two cards "App & browser settings" and "Task settings" with the two-column switch grid. Controls with no real engine setting are shown **in their screenshot position, greyed out and empty**, with the reason. They hold no value and write nothing. Icons for the User Agent rows and exact spacing are not matched yet (no way to render the page here). Compare with the screenshots on Windows.

## Not built (on purpose)

User Agent, Randomization, Timezone/Latitude/Longitude, Typo probability, Collect cookies, Share data (protection-evasion / data-harvesting, rule 9, decision D1). Device name, Session, Refresh proxy, Check Bing/restriction/accounts, Logs in excel, Point target, Gift card URL, Speed, Search/Tasks method, completion modes, Cooldown, OpenRouter key, search words (engine has no such setting). They are greyed out on the page with the reason.

## Test evidence

| Check | Result | How it was run |
| --- | --- | --- |
| `tests/engine-settings-rules.test.ts` (9 tests) | 9 pass | Throw-away stand-in runner (NOT Vitest) with `tsx`, against the real `engine/config.example.json` |
| `tests/main/engineSettings.integration.test.ts` (12 tests) | 12 pass | Same stand-in runner, against the **real engine API process**: read, save, no-change save, bad shape, engine 422, backup failure, run active, audit line, reset, reset without example |
| Typecheck of `src/shared`, `src/main`, rules and integration tests | clean | `tsc` with stubs for `electron` and `vitest` types |
| `tests/main/shutdown.integration.test.ts` (5 tests) | 5 pass | Stand-in runner against the real engine API: on + clean finish closes once and is audited; off, user Stop, and error run do not close; value survives restart |
| App settings store tests (6, in `tests/main/units.test.ts`) | 6 pass | Stand-in runner on the extracted block: defaults, corrupt file, sanitize, schema 1 -> 2 migration with backup, schema 2 not backed up again |
| Regression: `farmer.integration` 23/25, `accounts.integration` 27/28 | same as Phase 7 baseline | The few fails are stand-in runner gaps (`toBeUndefined`, `toBeGreaterThan` missing), identical on the untouched Phase 7 tree |
| `tests/renderer/settings.test.tsx` (7 tests) | **NOT RUN** | Needs React, MUI, jsdom. Written, not executed |
| Updated `tests/renderer/shell.test.tsx` (placeholder test now uses Telegram) | **NOT RUN** | Same reason |
| ESLint, Prettier, full `npm run check`, `npm run build`, `npm run start` | **NOT RUN** | No registry / Electron in the sandbox |

## Recovery note

The first Phase 8 session's files were lost. They were rebuilt by replaying the commands recorded in the session transcript onto the Phase 7 snapshot, then re-tested (results above). A second, different Phase 8 attempt in the transcript was NOT used: its file bodies are not in the transcript.

## Needs Windows verification

1. `npm ci`, then `npm run check` (typecheck, lint, format, all tests). Expect possible Prettier or lint fixes in the new files.
2. `tests/renderer/settings.test.tsx` and `tests/renderer/shell.test.tsx` must pass on real Vitest.
3. `npm run start`: open Settings, change a toggle, Save, check `engine/config.json`, restart the app, check the value persisted. Compare the page with screenshots 3-4.

## Unresolved

- Screenshot fidelity of the Settings page is unchecked (no screenshot capture possible here).
- Restart persistence is covered only by the read-back after save, not by a separate app restart test.

I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.
