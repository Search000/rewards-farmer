# Phase 05 Report: Desktop shell and visual design system

## 1. Phase and date
Phase 5, 2026-10-11. Built in the Linux sandbox (Ubuntu 24.04, Node 24.21.0 local, Electron 44.7.0 under Xvfb). **Not run on Windows yet.**

## 2. Objective
Common window, sidebar, routing, dark theme and shared components only. No fake data, no backend. Truthful "not connected" state.

## 3. Files inspected
`Microsoft_Rewards_Farmer_Master_Prompt_15_Phases.md`, Phase 1-4 reports, `docs/requirements-matrix.md` (decisions D1-D8, P3-1..7, Phase 4 decisions), `docs/architecture.md`, screenshots 1 and 3 (viewed, colors sampled with Pillow), Phase 4 project zip.

## 4. Files created/modified
New: `src/main/{main,window,ipc}.ts`, `src/preload/preload.ts`, `src/shared/{app-info,ipc-types}.ts`, `src/renderer/{index.html,main.tsx,App.tsx,theme.ts,tokens.ts,routes.ts,global.css}`, `src/renderer/hooks/useHashRoute.ts`, `src/renderer/components/*` (AppShell, AppBarShell, Sidebar, PageCard+InfoCard+StatRow, ActionButton, LabeledField, SelectField, ToggleSwitch, ConfirmDialog, Notifications, StateBlock, NotConnected, DisabledReason, Hint), `src/renderer/pages/{PlaceholderPage,DesignSystemPage}.tsx`, `vite.config.mts`, `scripts/{build-main,capture-screenshots}.mjs`, `tests/setup.ts`, `tests/renderer/{theme,shell,components}.test.ts(x)`, `reports/phase-05-screenshots/*`.
Modified: `package.json` (+deps, scripts, `main`), `package-lock.json`, `tsconfig.json` (Bundler resolution, DOM, JSX), `vitest.config.mts` (jsdom), `eslint.config.mjs`, `SETUP_WINDOWS.md` (section 10), `diagnose-windows.bat` (+build, +electron version). Engine untouched.

## 5. Implementation summary
- Electron main: single-instance lock, `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, new windows denied, navigation blocked, webview blocked. Native window frame (screenshots show a normal Windows title bar). App name "Rewards Farmer LUCK" (your Phase 4 decision).
- IPC: one channel `app:get-info`, typed in `ipc-types.ts`. No passthrough.
- Renderer: React 19 + MUI 9, hash router (7 sidebar routes + dev-only design-system page), theme from colors sampled out of your screenshots. Light theme exists but is DERIVED (no light screenshot).
- Hamburger: collapses sidebar to icons (wide) or opens an overlay (below 900 px). Sun: switches dark/light (in memory only, resets on restart). Palette: disabled with reason. Engine icon: static "not connected" indicator. Kebab: one item, opens the design system page.
- Every non-data state is real: StateBlock (loading/error/empty/unavailable), DisabledReason tooltips, NotConnected banner on every placeholder page.
- Production build injects a strict CSP meta tag (`script-src 'self'`; `style-src 'unsafe-inline'` is needed by Emotion/MUI).
- Pages Home/Accounts/Settings/About etc. show ONLY the development-state banner. Nothing from screenshots 1-7 is faked as a working page. The design-system page has a "layout reference" with all controls disabled and values `-`.

## 6. Commands actually run
`npm ci` (Phase 4 tree), `npm i -E` for runtime and dev deps, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run check` (several times), `npm run build`, `node scripts/capture-screenshots.mjs` (launches the built app with `xvfb-run electron . --no-sandbox --remote-debugging-port=9333`), `npm audit`.

## 7. Actual command outputs / test evidence
- `npm run check`: exit 0. typecheck 0 errors, eslint 0 problems, prettier ok, **5 files, 35/35 tests pass** (7 Phase 4 + 28 new).
- `npm run build`: renderer (Vite) + main + preload (esbuild) OK. `dist/renderer/index.html` contains the CSP meta tag.
- `npm audit` (app tree): found 0 vulnerabilities.
- Fresh clone (`git clone`, then `git submodule update --init`, `npm ci`): `npm run check` exit 0, 35/35 tests, `npm run build` ok. Without the submodule init, 1 Phase 4 test fails (needs `engine/package.json`), so `--recurse-submodules` is required.
- Running real app (evidence.json): title "Rewards Farmer LUCK"; `getAppInfo()` over IPC returned name/version 0.0.1/platform linux/Electron 44.7.0/Chrome 152.0.7977.130; exposed API keys = `["getAppInfo"]` only; `typeof require` and `typeof process` in renderer both undefined; `window.open()` returned null; CSP present; body background `rgb(18, 19, 24)` = `#121318`; **console errors/warnings: none**.
- Screenshots (1280x720 unless noted) in `reports/phase-05-screenshots/`: 01 home, 02 accounts, 03 settings, 04 about, 05/06 design system, 07 modal, 08 notification, 09 light theme, 10 narrow 800x600, 11 narrow overlay, 12 device scale factor 2.
- Bugs found by tests/runs and fixed: (1) a disabled switch still reported a change under a raw click in jsdom, added a guard in `ToggleSwitch`; (2) `ErrorOutline` icon name missing in MUI 9, now `ErrorOutlined`; (3) the capture script was not yet linted/formatted when I first said checks passed, fixed, and `npm run check` re-run after the last edit.

### Measured match against your screenshot 1 (rule V8: 8 px)
| Item | Reference | Mine | Result |
|---|---|---|---|
| App bar height | 46 px | 46 px | match |
| Sidebar divider x | 222 | 222 | match |
| Sidebar label y (7 items) | 79,116,154,190,226,264,299 | 78,115,152,189,224,262,297 | within 2 px |
| Card width | about 994 | 1000 | within 6 px |
| Hamburger left edge | 9 | 16 | 7 px off |
| Title left edge | 48 | 60 | **12 px off, exceeds 8 px** |
| Right-most icon right edge | 1266 | 1256 | 10 px off, **exceeds 8 px** |
Reference y values assume a 20 px native title bar in the screenshot. Fonts differ slightly (Roboto from npm; reference font unknown). Not "exact same".

## 8. Acceptance criteria checklist
- Window shell, sidebar, routing, dark theme, typography, spacing, icons, cards, inputs, dropdown, toggles, tooltips, modal, notifications: DONE (see gallery screenshots).
- Dimensions/spacing match screenshots: **PARTIAL** (table above; app bar title/right icons off by more than 8 px).
- Keyboard focus, accessible labels: tested in jsdom (Tab order start, Enter on nav, Space on switch, Escape on dialog, roles/labels). Real screen reader: NOT TESTED.
- Resizing: 800x600 collapses to overlay (screenshots 10/11). Real window drag-resize: NOT TESTED.
- High-DPI: one capture at device scale factor 2 (12). Real high-DPI Windows display: NOT TESTED.
- Loading/error/disabled styles: done and unit tested.
- No fake data: true. Placeholders show a banner or `-`.
- Component tests pass: 35/35.

## 9. Known issues and unresolved questions
1. Discord has no MUI icon; `Forum` is a stand-in until you approve a real logo asset.
2. Palette button is disabled (no screenshot of its menu). Light theme is derived and unreviewed by you.
3. Theme choice is not saved (needs main-process AppSettings, Phase 6).
4. Design-system menu item is visible to all users now; hide or remove before Phase 14.
5. App bar title and right icon offsets above 8 px: fix in this phase if you want, otherwise Phase 13.
6. Sandbox run used `--no-sandbox` (root user in this container), so renderer OS-sandbox is NOT proven here. `sandbox:true` is set in code.
7. Windows: nothing in Phase 5 was run on your PC yet.
8. Engine still has 2 high `npm audit` items from Phase 4 (decision in Phase 12).

## 10. Security/data impact
No secrets, no accounts, no network calls, no engine process started. Renderer has no Node access. One IPC read-only channel. No telemetry. No files written outside the project.

## 11. Verdict
**PARTIAL.** Everything built and tested in the sandbox (35/35, build ok, real app launched, no console errors), but visual match has measured gaps over 8 px and Windows is unverified.

## 12. User decision required
See the chat message (Windows run, discord icon, light theme, offsets, theme persistence, gallery menu item).

## 13. Explicit stop notice
I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.
