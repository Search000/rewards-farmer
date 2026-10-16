# Requirements Matrix (Phase 2)

## Assumptions (me chose, not you — reverse any)
A1. Engine = `V4-china` (only branch with control API).
A2. Controls with no upstream support: disabled + label "Not supported by engine". No fake behavior.
A3. Evasion-adjacent controls (UA override, Randomization, Typo probability, Geolocation, Collect cookies, Share data): NOT built, hidden or disabled. Equals option (b) from Phase 1. Option (a) or (c) changes this.
A4. No telemetry. Local only. API bound 127.0.0.1 with token.
A5. App writes only its own settings. `.env` and `config.json` edits need backup + approval.

## Visual requirements (V)
V1 Dark theme, near-black background, slate-blue primary buttons, lavender toggles (shots 1-7).
V2 App bar: hamburger, title, theme sun, palette, spinner/badge, kebab.
V3 Sidebar 7 items, active item pill, vertical divider.
V4 Home = 3 cards: Farmer (2 path fields, timer row), Current account, Accounts informations; Stop/Start bottom.
V5 Accounts = title, empty-state text, "+ Add account" floating button.
V6 Settings = top UA card, left "App & browser settings", right "Task settings", scrolling columns.
V7 Window min size and resize behavior: UNKNOWN. High-DPI: UNKNOWN.
V8 Measurable criterion (proposed): at 1280x720, page layout positions within 8 px of screenshot, colors within deltaE 5 (sampled from images). Needs your OK.

## Behavior requirements (B)
B1 Start/Stop call real API; button disabled while state invalid (running/stopped) per `/status.state`.
B2 Home numbers come from `/points`, `/accounts`, `/history`; unknown shows "unknown" or "-", never fake 0.
B3 Settings Save = validated PATCH `/config`; shows validation error from API; says "applies next run".
B4 Reset to defaults = backup then restore example values; confirm dialog.
B5 Logs shown redacted; secrets (passwords, tokens, keys) never in UI/log files.
B6 Add/edit/remove account = local `.env` write with backup + confirm. password field masked.
B7 First run: engine not found/API down/token wrong -> clear error state, no crash.
B8 Telegram/Discord: no separate pages any more (user decision, Phase 11 follow-up). Their tokens are edited on the "Secrets & API keys" page (own sidebar item, like Logs); only `webhook.*` fields are written; token masked after save.
B9 Visible risk notice: automation may violate Microsoft terms, account may be banned (upstream README says so).

## Unknown, screenshots cannot prove
Dropdown options, delay units, meaning of Session/Check Bing/Check restriction/Refresh proxy/Shutdown, kebab and palette menus, "Search words setting" dialog, Parallel farming/Telegram/Discord/About layouts, Accounts populated state, error/hover/focus states, light theme.

## Acceptance criteria (draft)
AC1 Every enabled control performs a real action (verified by test or manual log).
AC2 Every disabled control shows reason.
AC3 No API route used outside the list in `feature-support-matrix.md`.
AC4 Settings round-trip: save, reload, values equal; invalid value rejected.
AC5 No secret string appears in logs (grep test).
AC6 Visual check per V8 on 7 reference views.

## Optional additions (NOT in scope until you approve)
Backup/restore, update checker, installer, first-run wizard, auto-start with Windows (opt-in), crash recovery, accessibility pass.

## DECISIONS RECORDED (user reply after Phase 2)
D1 Evasion controls: user says needed. ASSISTANT DECLINES to build: Randomization, Typo probability, User-Agent override, Geolocation spoof. Not built, not exposed. Unchanged from A3. Also not built: Collect cookies, Share data.
D2 Engine = `V4-china`. CONFIRMED.
D3 Unsupported controls disabled + labeled. CONFIRMED.
D4 Accounts Path = pick `.env` file. CONFIRMED.
D5 Timer "Start at" = app-side timer, NEW. CONFIRMED.
D6 Browser dropdown = `chromium` (default) | `msedge`. Reason: upstream code comment in `src/browser/Browser.ts` (~line 96) says Edge 152 + patchright crashes on Microsoft account pages. Chromium safer. Chrome not supported upstream.
D7 "Shutdown" toggle = close THIS APP after run ends. NOT PC shutdown. NEW, simple.
D8 Visual match rule V8 (8 px, deltaE 5). CONFIRMED.

## Phase 3 approvals recorded
P3-1 Electron + TypeScript + React: OK. P3-2 pinned submodule, unmodified, separate process: OK. P3-3 `API_ALLOW_CONFIG_WRITE=true` on private API: OK. P3-4 app license GPL-3.0-or-later: OK (lawyer check before public release). P3-5 Node 24: user said "ok", read as bundle `node.exe` in installer (recommended). P3-6 `.env`: BOTH, Option 1 env-injection primary, Option 2 copy as fallback with backup + approval. P3-7 emails shown in full in UI and logs.

## New requirement B10 (logging, user request)
B10 Every app action and engine event is written to log files: what, when, which account, what action, result. Separate files: app, audit, engine, per-account, per-run, errors. Spec = `docs/architecture.md` section 13. Passwords, tokens, cookies never logged. Acceptance AC7: after a test run, each user click and each account's tasks appear in files with timestamp + account + action + result; secret grep finds none.

## Phase 4 decisions
App name = "Rewards Farmer LUCK" (user choice; drops "Microsoft" from the name). Phase 5 (Electron + React + Vite) approved by user ("ok"). Window title and About page must use the new name; screenshot title text will differ on purpose.
