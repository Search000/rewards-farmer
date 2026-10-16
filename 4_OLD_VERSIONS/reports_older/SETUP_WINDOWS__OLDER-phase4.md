# Windows Setup (Phase 4)

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

Expected: typecheck, lint, format check pass; 7 tests pass.

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
