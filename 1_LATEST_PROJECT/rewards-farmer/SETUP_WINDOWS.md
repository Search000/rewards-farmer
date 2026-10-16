# Windows Setup (Phase 4, extended in Phase 5)

Target: Windows 10/11 x64. These steps were written from a Linux sandbox run. **Not yet run on real Windows.** Treat Windows-specific lines as untested until you confirm.

Shell labels: **[PowerShell]** or **[CMD]**. Do not mix.

## 1. Prerequisites

| Tool                                                                                                                                                                                                  | Version                                    | Check            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------- |
| Git for Windows                                                                                                                                                                                       | any recent                                 | `git --version`  |
| Node.js                                                                                                                                                                                               | **24 or newer** (engine requires >=24.0.0) | `node --version` |
| npm                                                                                                                                                                                                   | comes with Node                            | `npm --version`  |
| Download Node from nodejs.org (choose 24 or newer). No global npm packages needed. No Rust, no Python, no C++ build tools required for this scaffold (Electron comes in Phase 5; will re-check then). |

## 2. Get the project (with engine submodule)

**[CMD] or [PowerShell]**

```
git clone --recurse-submodules <YOUR-REPO-URL> rewards-farmer
cd rewards-farmer
```

Forgot `--recurse-submodules`? Run `git submodule update --init`.
Engine is pinned to the commit in `ENGINE_PIN` (`e0c15a6ae6bd102cb04f2a3351e2fa281f82961c`, upstream `V4-china`). Do not `git pull` inside `engine/`.

## 3. Install and check the app tooling

```
npm ci
npm run check
```

Expected (Phase 5): typecheck, lint, format check pass; 35 tests pass (7 were Phase 4, 28 new).

## 4. Build the engine

```
npm run engine:install
npm run engine:build
```

Why `--replace-registry-host=always` is inside `engine:install`: upstream `engine/package-lock.json` points 2 of 178 packages (`qrcode-terminal`, `@types/qrcode-terminal`) at `registry.npmmirror.com`. The flag fetches them from npmjs instead. Every package still has an integrity hash that npm verifies. Engine files are not edited.

## 5. Browser for the bot (NOT tested here)

```
npm run engine:browser
```

Runs upstream `install:browser` (patchright chromium download). The sandbox could not reach the download host, so this is untested.

## 6. Engine's own tests: known failing

`npm run engine:test` -> 1 pass, 8 fail at the pinned commit. Cause (found): commit `abf2b54` changed `scripts/api/logParser.js` regexes to Chinese log text; the tests still use English. Upstream problem, not your setup. Not "fixed" by us (engine is unmodified).

## 7. Accounts file

Copy `accounts.example.env` to a place OUTSIDE the repo, fill locally. Never paste passwords into chat or Git. Format = `engine/env.example`.

## 8. Common Windows problems

- **PowerShell says "running scripts is disabled" for npm:** use **[CMD]** instead. Changing PowerShell execution policy is a machine setting; only do it if you understand it: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Optional, not required.
- **Long paths:** clone near drive root, e.g. `C:\src\rewards-farmer`.
- **Antivirus** may flag or slow `node_modules`/browser download. Do not disable it; add an exclusion only if you choose to.
- Never run these as Administrator.

## 9. Not done in this phase

Electron, React, Vite, packaging, installer, bundled `node.exe`. (Phase 5 and 14.)

## Send me the result (Windows)

In **[CMD]**, from the project folder, run `diagnose-windows.bat` (UNTESTED on real Windows). It writes `diagnose-output.txt` with versions and the output of the setup commands. It does not collect passwords or environment variables. Open it, check it, then paste or upload it to the chat. It may contain your Windows user name in paths.

## 10. Run the desktop shell (Phase 5)

Electron is a normal npm dependency (installed by `npm ci`; its binary is downloaded from GitHub releases during install).

**[CMD] or [PowerShell]**

```
npm run start
```

This builds the renderer (Vite) and main/preload (esbuild) into `dist/`, then opens the app window. Expected: window titled "Rewards Farmer LUCK", dark theme, sidebar with 7 items, every page shows "Development state: no data connected". Menu (three dots) -> "Design system (development)" shows all shared components.

Live UI editing while developing: terminal 1 `npm run dev:renderer`; terminal 2 (CMD) `set RF_DEV_SERVER_URL=http://127.0.0.1:5173 && npm run build:main && npx electron .` (PowerShell: `$env:RF_DEV_SERVER_URL="http://127.0.0.1:5173"; npm run build:main; npx electron .`). Not tested on Windows yet.

## 11. Home / Farmer screen (Phase 6)

Prerequisites (once), **[CMD]**, from the project folder:

```
npm ci
npm run engine:install
npm run engine:build
npm run check
npm run build
npm run start
```

On the Home page:

1. **Accounts Path / Open**: pick your accounts `.env` file (format = `engine/env.example`, kept OUTSIDE the repo). The app only counts `ACCOUNT_N_*` entries and forwards those variables to the engine process. Passwords are never shown or logged.
2. If the banner says the engine `config.json` is missing, press **Create config** (copies `engine/config.example.json`, never overwrites an existing file).
3. **Start** / **Stop** call the real engine control API on 127.0.0.1. A disabled button always shows its reason as a tooltip.
4. **Start at** + **Timer**: app-side timer (not an engine feature). A time missed while the PC was asleep is reported and NOT started late.
5. **Alternate proxies** is disabled on purpose: the engine takes proxies per account in the accounts file.
6. **Locked** / **Suspended** show `unknown`: the engine has no source for them.

Logs: `app.log` and `audit.log` (JSON lines, secrets redacted) in the `logs` folder inside the app's Electron user-data folder (normally under `%APPDATA%`, named after the app).

If the app is force-killed while the engine runs, the next launch stops the leftover engine process (only if its command line is our engine server; a recycled PID is never touched).

## 12. Accounts screen (Phase 7)

Open **Accounts** in the sidebar. The list is read live from the accounts `.env` file you chose on Home (the only account store). Nothing is stored anywhere else.

- **Add account** (button bottom right), **Edit** and **Remove** (icons on each row) change ONE account in your file. Before each change the app copies the whole file into its own `backups\accounts` folder (inside the Electron user-data folder), makes the change, checks that no other line moved, replaces the file in one step and reads it back.
- Passwords, 2FA secrets, recovery e-mails and proxy passwords are never shown. The list shows only "saved / not saved". In the Edit dialog an empty secret box means "keep the saved value"; tick "Remove the saved ..." to delete it.
- Changing an e-mail does not move the saved login session of the old e-mail.
- Add, Edit and Remove are disabled (with a tooltip that says why) while a run is active, while the engine starts or stops, when no accounts file is chosen, or when the file has a problem.
- After a change the engine API restarts on the changed file. Removing the LAST account stops the engine until you add one again.
- If another program edits the file in the middle of a change, the app refuses to overwrite it and tells you.

First, **[CMD]**, from the project folder, because the new files are not formatted by Prettier 3.9.10 yet:

```
npm run format
npm run check
npm run build
npm run start
```

Send me the output of `npm run check` (or `diagnose-output.txt`). Then try: Accounts -> Add account with a FAKE address first, check the file and the backup folder, then Remove it again.
