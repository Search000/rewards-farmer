# Phase 17: Notifications, settings UI and test action

## 1. Phase and date
Phase 17, 2026-10-15. Done on Linux (Node 24.21.0). Nothing was run on Windows.

## 2. Objective
Let the user set up notifications on a screen and check them with a real test action (master prompt, Phase 17).

## 3. Files inspected
- The Phase 16 ZIP (`rewards-farmer-MASTER-phase16`), mainly `src/shared/notifications-types.ts`, `src/shared/notifications-rules.ts`, `src/main/notifications.ts`, `src/main/ipc.ts`, `src/preload/preload.ts`, `src/renderer/*`.
- The transcript text file of the earlier Phase 17 session (about 80% of the work).
- Upstream engine source (earlier session result): `Logger.shouldPassFilter`, `webhookLogFilter`.

## 4. Files created / modified
The Phase 17 code was NOT inside the Phase 16 ZIP. It was put back from the transcript:
- Every file the transcript wrote with a shell command was replayed in the original order (hook, card, page, route, sidebar, App, tests, test helper, log-filter fix).
- ONE file was not visible in the transcript (it was written with a file tool and only its name was logged): `src/shared/notifications-ui-rules.ts`. It was written again here from what the tests and the page need. The 23 rules tests and the page tests (all of them written earlier) pass against it, so it does what they require. Its wording may differ from the earlier version.

New:
- `src/shared/notifications-ui-rules.ts` (re-written, see above)
- `src/renderer/hooks/useNotifications.ts`
- `src/renderer/components/NotificationChannelCard.tsx`
- `src/renderer/pages/NotificationsPage.tsx`
- `tests/notifications-ui-rules.test.ts`, `tests/helpers/notifyBridge.ts`, `tests/renderer/notifications.test.tsx`, `tests/renderer/notifications.service.test.tsx`
- `scripts/capture-notifications-17.mjs`, `reports/phase-17-screenshots/`

Changed:
- `src/shared/notifications-types.ts` (new `problem` and `logFilter` fields), `src/main/notifications.ts` (fills them), `src/shared/notifications-rules.ts` (`readLogFilter`, and the wrong "warnings and errors by default" text removed from 3 places)
- `src/renderer/routes.ts`, `src/renderer/components/Sidebar.tsx`, `src/renderer/App.tsx` (new item "Notifications" after Secrets & API keys)
- `tests/renderer/shell.test.tsx` (sidebar 8 to 9 items), `tests/main/notifications.test.ts`
- `docs/configuration-reference.md` (section "Notifications (Phase 17)")
- Formatting only (Prettier): `src/main/configRepair.ts`, `src/main/farmer.ts`, `tests/main/accountsAuto.test.ts`, `tests/main/configRepair.test.ts`, `tests/main/helpers.ts`, `tests/main/troubleshooting.fixes.test.ts`. This was the "7 old Prettier files" problem from Phase 15/16; `TEST.bat` no longer fails on formatting.

## 5. Implementation summary
- New sidebar page **Notifications**. One card per channel the engine really delivers: Discord, ntfy, Telegram, PushPlus.
- Each card: state in words (On / Off - ready to switch on / Needs attention / Not set up), what the engine sends, the missing or invalid fields, one switch (saved at once by the Phase 16 service), one "Send test message" button.
- Test result stays on the card: title, the exact service text, and an honest line whether a request was started. A failed bridge call says "not known whether a message was sent".
- Every disabled control says why: channel not set up, engine not ready, run active, change or test going out.
- ServerChan and WeChat ClawBot: listed under "Not available", disabled switch, reason.
- Page states: `config.json` missing, permission denied, not valid, unreadable; state could not be read (Try again); offline hint (a test is still allowed).
- Addresses, tokens and chat IDs are never on this page. Opening the page sends nothing.
- **Phase 16 text bug fixed.** The cards said the engine posts "warnings and errors by default". The engine source shows that with `webhookLogFilter.enabled` off (the example default) it posts EVERY non-debug log line to Discord, ntfy and Telegram, and the lines can hold account e-mail addresses. The page now reads the flag and shows which case you are in.

## 6. Commands actually run
All on Linux, Node 24.21.0 (npm package `node@24`; the sandbox default is Node 22, where the real-engine tests fail with "Node.js 24+ needed").
- `npm ci`, `npm --prefix engine ci --ignore-scripts --replace-registry-host=always`
- `npx prettier --write` (files listed above), `npx prettier --check .`
- `npx tsc --noEmit`, `npx eslint .`
- `npx vitest run` (whole suite, one run)
- `npm run build`
- `node scripts/capture-notifications-17.mjs <dir>` against the real built app in Electron under Xvfb
- `START.bat` / `TEST.bat`: **NOT TESTED** (no Windows here). They were not changed in this phase; `tests/launchers.test.ts` (file checks only) passes.

## 7. Actual command outputs / test evidence
- `prettier --check .`: "All matched files use Prettier code style!"
- `tsc --noEmit` and `eslint .`: no output, exit 0.
- `vitest run`: **Test Files 47 passed (47); Tests 637 passed, 4 skipped (641); exit 0.** The 4 skips are the root-only permission tests (sandbox runs as root).
- Phase 17 tests inside that run: `notifications-ui-rules` 24 (incl. log-filter), page `notifications.test.tsx` 33 (incl. log-filter), page with the REAL service `notifications.service.test.tsx` 9, service `tests/main/notifications.test.ts` 34 (+1 skip).
- `npm run build`: ok.
- Real Electron window (Xvfb), 0 console errors:
  - without `engine/config.json`: page shows "config.json is missing" + Check again, the two "Not available" rows. `reports/phase-17-screenshots/`.
  - with the engine's `config.example.json` copied to `engine/config.json` for the capture only (deleted afterwards): four cards "Not set up", summary "No channel is on. The engine sends no notifications.", log-filter warning "EVERY log line except debug". `reports/phase-17-screenshots/with-config/`.
- Not sent anywhere: no real message went to Discord, ntfy, Telegram or PushPlus. Sending was tested against a recording stand-in for the network (Phase 16 style).

## 8. Acceptance criteria checklist
- Settings persist: PASS (switch written to the real `config.json` in the service test, read back).
- Test action reports the real outcome (success or exact failure reason): PASS at UI + service level with a network stand-in. A real message to a real service: NOT TESTED (needs your own webhook).
- Permission denied, misconfiguration, offline visible and understandable: PASS in tests. A real permission-denied folder: NOT TESTED (root sandbox; the POSIX test is skipped).
- Unsupported controls disabled and explained: PASS.
- Notifications fire only when configured: PASS (unchanged from Phase 16, page opens with no request).

## 9. Known issues and unresolved questions
- `notifications-ui-rules.ts` was written again (see section 4). Texts may differ slightly from your earlier version.
- Message **title** and **log filter** are not editable here. The Phase 16 service has no option for them; a safe edit needs a new validated write with backup. Not built. Decision for you (below).
- Windows `START.bat` / `TEST.bat` NOT TESTED. The old Windows worker crash (exit 3221226505) is still undiagnosed.
- The capture script puts the example config in place by hand, so the "with config" screenshot is the real window reading a real file, not a configured account.

## 10. Security / data impact
- No secret reaches the renderer. The state holds on/off and problem text only. Test: no saved fake token or address appears in the page text.
- The only write is `webhook.<channel>.enabled` via the existing Phase 16 service (backup first). No new files in user data.
- The test message is fixed plain text, no account data.
- `engine/config.json` created for the screenshot was deleted. The ZIP holds no `.env`, sessions, accounts, `node_modules` or logs.

## 11. Verdict
**PASS** for the settings UI and the test action (Linux). **PARTIAL** overall: Windows runs and a real delivery test are NOT TESTED, and title / log-filter editing is not built.

## 12. User decision required
- Do you want the message title and the log-filter switch editable in a later phase (needs new service code)? Default: not built.
- Please double-click `TEST.bat` on Windows and send one real test message to your own Discord / ntfy / Telegram / PushPlus. `FORMAT.bat` is no longer needed.

## 13. Explicit stop notice
I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.
