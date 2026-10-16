# Phase 10 Report: Secret handling and API keys

1. **Phase and date:** Phase 10, 2026-10-12. Started after the user wrote `NEXT PHASE`. Phase 11 is not started.

2. **Objective:** Handle all sensitive fields safely: API key / token fields, masked in the UI, never in logs, reports or Git; redaction tests with fake tokens; tests for missing, invalid, rotated keys and an unavailable store.

3. **Files inspected:** `engine/src/interface/Config.ts`, `engine/src/util/Validator.ts`, `engine/src/util/ConfigEnvOverrides.ts`, `engine/src/util/Load.ts`, `engine/scripts/api/lib.js` (`redactSecrets`), `engine/scripts/api/server.js` (`GET /config`), `engine/config.example.json`, `src/main/engineSettings.ts`, `src/main/accounts.ts`, `src/main/engine/redact.ts`, `src/main/engine/supervisor.ts`, `src/main/ipc.ts`, `src/preload/preload.ts`, `src/renderer/pages/SettingsPage.tsx`, `.gitignore`, `docs/threat-model.md`.

4. **Files created / modified:**
   - New: `src/shared/secrets-types.ts`, `src/shared/secrets-rules.ts`, `src/main/secrets.ts`, `src/main/privatePerms.ts`, `src/renderer/hooks/useSecrets.ts`, `src/renderer/components/SecretsCard.tsx`, `tests/secrets-rules.test.ts`, `tests/privatePerms.test.ts`, `tests/redact-secrets.test.ts`, `tests/main/secrets.integration.test.ts`, `tests/renderer/secrets.test.tsx`, `tests/fixtures/fake-secrets.ts`, this report.
   - Modified: `src/main/main.ts`, `src/main/ipc.ts`, `src/preload/preload.ts`, `src/shared/ipc-types.ts`, `src/main/engine/redact.ts`, `src/main/engineSettings.ts`, `src/main/accounts.ts`, `src/renderer/pages/SettingsPage.tsx`, `src/renderer/components/ActionButton.tsx`, three renderer test bridges, `tests/repo-hygiene.test.ts`, `docs/configuration-reference.md`, `docs/threat-model.md`.
   - Not changed: `START.bat`, `TEST.bat`, the `engine/` submodule.

5. **Implementation summary:**
   - 8 secret fields (Discord URL, ntfy URL and token, Telegram bot token and chat ID, PushPlus token, ServerChan SendKey, China API appkey) on Settings, card "Secrets & API keys". Table with paths and formats: `docs/configuration-reference.md`, section "Phase 10".
   - **Write-only.** The main process reads the config, keeps only "set / not set", and sends that to the screen. Typed values go to main once. No reveal, no copy button.
   - **Storage decision.** OS credential store: **not used**, on purpose. The bot reads these values only from `config.json` (checked in `Load.ts`; `CONFIG_*` env overrides are used only by the CLI helper and the manual-login script). A second store would be a copy that protects nothing. So the one real file is protected instead (details in the docs section "Why not the Windows credential store"). The master prompt allows "or a local file with restrictive permissions".
   - Save path: validate (format, length, no control characters) → register in redactor → backup copy → engine `PATCH /config` → limit file to current user → check exact value in the file → audit line "saved (value not logged)". Clear works the same. Both are refused while a run is active.
   - File permissions: `config.json`, the config-backup folder and copies are limited to the current user (POSIX 600/700, Windows `icacls`). Account-file backups got the same on Windows (before, `mode` was ignored there).

6. **Commands actually run (Linux sandbox, Node 24.21.0 from the npm package `node@24`):** `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, `node node_modules/vitest/vitest.mjs run`, `npm run build`. Engine dependencies installed with `npm ci --replace-registry-host=always --ignore-scripts` (the lockfile points to a blocked mirror).
   **`START.bat` / `TEST.bat` output: NOT TESTED** (no Windows here, files unchanged; static test `tests/launchers.test.ts` 10/10 passes). Please run both.

7. **Actual results:**
   - `tsc --noEmit`: clean. `eslint .`: clean. `prettier --check .`: "All matched files use Prettier code style!". `npm run build`: main 133.8 kB, preload 3.3 kB built, no errors.
   - Vitest: **23 files passed, 292 tests passed, 1 skipped (293)**, 92.8 s. The skip is the permission-denied test in `units.test.ts` (skipped on Windows and as root).
   - New this phase: rules 7, permissions 4, redaction 3, real-engine integration 14, Secrets card renderer 8.
   - Real-engine integration (engine API scripts unmodified): all 8 fields saved at their real paths; state and IPC payload checked to hold no value; neighbouring fields untouched; rotation (old value still masked); clear and clear-when-empty (no backup made); backup made before change, mode 600 / 700 and config.json 600 (POSIX); invalid values refused before the engine (file unchanged); run-active refusal; engine not running; config.json removed; app log and audit log scanned for every fake value (none found).
   - Stand-in engine: an engine error text that repeats the value is masked; a changed value read back is reported as failure.

8. **Real defects found by these tests and fixed in this phase:**
   1. The engine's `GET /config` hides Discord / ntfy / Telegram values, so a read-back through the API could never match. Found by the real-engine test (the first run failed 11 of 14). Fix: the exact value is checked in the file itself, inside main.
   2. The engine's `GET /config` does **not** hide the PushPlus token, the ServerChan SendKey or the China appkey. Not a bug of this app, but it is why only main reads that answer. Documented in a test.
   3. The redactor missed Telegram bot tokens inside API addresses (`.../bot123456:AA.../sendMessage`). Fixed in `redact.ts`, covered by `tests/redact-secrets.test.ts`.
   4. On Windows the `mode` option of the backup folders was ignored. Fixed with `icacls`.

9. **Acceptance criteria:**
   - Secrets protected across UI, logs, config files, exports: UI/IPC/logs verified by test. Config file and backups protected by user-only permissions (verified on POSIX; Windows `icacls` call verified with a stand-in runner only). **Exports do not exist yet** (Phase 12 diagnostics bundle, Phase 13 backup/restore): they must reuse the redactor and these permissions.
   - Redaction tests pass: yes (fake tokens, test-only, isolated in `tests/fixtures/fake-secrets.ts`).
   - Missing / invalid / rotated keys: tested. "Credential store unavailable": not applicable (no separate store); the equivalent cases are engine not running, config.json missing, backup failure, engine refusal. All tested.
   - `.gitignore` coverage: `config.json`, `backups/`, `logs/`, `.env*`, `accounts.env` checked by `repo-hygiene.test.ts`. (`engine/config.json` cannot be checked from the outer repo because `engine` is a submodule; the engine has its own ignore file.)

10. **Known issues and unresolved questions:**
    - NOT TESTED: Windows `icacls` on a real machine, the card on screen (no Electron here), a real webhook delivery (no notification sending exists yet, Phase 12).
    - If `icacls` fails, the save still succeeds and says so in the message; the audit log has a warning line.
    - A saved value that existed **before** this app (typed by hand into `config.json`) is shown as "Saved" without being checked for format.
    - The phase 9 question "add the `searchOnBingLocalQueries` toggle?" was not answered. Not built.
    - The user's Phase 9 request for the human-imitation options (random click/scroll, humanize, typo, user agent, timezone/location) was declined again. They only hide the bot from Microsoft. Unchanged.
    - `npm audit` still reports 2 high-severity packages in the pinned engine (Phase 16).
    - Git: nothing committed.

11. **Security / data impact:** No secret was written to any log, report or test output other than fake test strings. `config.json` and its backups are now user-only. The new IPC surface is 3 channels, all sender-checked and re-validated in main.

12. **Verdict:** PASS for the automated checks. PARTIAL overall: Windows launchers, the on-screen card and Windows file permissions are not confirmed.

13. **User decision required:**
    - Run `TEST.bat` and `START.bat` on Windows, open Settings, scroll to "Secrets & API keys", save and clear one test value, and send a screenshot.
    - Say whether to add the `searchOnBingLocalQueries` toggle.

14. **Explicit stop notice:** I have not started Phase 11. Waiting for your explicit `NEXT PHASE`.
