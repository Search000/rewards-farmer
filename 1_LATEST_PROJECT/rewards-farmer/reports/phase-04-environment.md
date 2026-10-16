# Phase 04 Report — Environment & Scaffold

## Verdict: DONE for Linux sandbox. Windows NOT verified.

## Environment (sandbox, observed)
Ubuntu 24.04, shell /bin/sh, Git 2.43.0, system Node v22.22.2 (too old for engine, needs >=24), npm 10.9.7, Python 3.12.3, gcc 13.3.0, no pnpm/yarn. No global installs done. Node 24.21.0 installed into a local folder only (`/home/claude/tools/node24`) via npm, used for all runs.
User machine: unknown. Prerequisites for Windows in `SETUP_WINDOWS.md`.

## Built
- Git repo with `engine/` = submodule of upstream `V4-china`, pinned `e0c15a6ae6bd102cb04f2a3351e2fa281f82961c` (file `ENGINE_PIN`). Engine files unmodified.
- Tooling (exact versions in `package-lock.json`, installed with `npm ci`): TypeScript 6.0.3, ESLint 10.12.0, typescript-eslint 8.71.1, Prettier 3.9.10, Vitest 5.0.3, @types/node 24.x.
- Files: `.gitignore` (secrets, sessions, logs, backups, config.json, .env*), `.gitattributes`, `.editorconfig`, `.prettierrc`, `.nvmrc`=24, `accounts.example.env` (fake placeholders), `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, folders `src/{main,preload,renderer,shared}`, `tests`, `docs`, `reports`.
- `src/shared/engine-contract.ts`: typed allow-list of the engine routes from the Phase 3 contract.
- Scripts: `check` (typecheck+lint+format:check+test), `engine:install`, `engine:build`, `engine:test`, `engine:browser`.
- Lockfile strategy: commit `package-lock.json`, always `npm ci`, exact version pins, engine keeps its own lockfile.

## Commands run and observed results
| Command | Result |
|---|---|
| `npm ci` (app, clean clone) | added 132 packages |
| `npm run check` | typecheck 0 errors, lint 0, format ok, 7/7 tests pass (run twice, also in fresh clone) |
| `npm ci` (engine) as-is | FAIL: `ENOTFOUND registry.npmmirror.com` |
| `npm ci --replace-registry-host=always` (engine) | ok, 171 packages |
| `npm run build` (engine, Node 24) | ok, `dist/index.js` created |
| `eslint .` (engine) | exit 0, no output |
| `npm run test:log-parser` (engine) | 1 pass, 8 FAIL |
| engine API smoke (fake fixture env, tmp copy, loopback) | see below |

### Engine API smoke (127.0.0.1:38211, token, fake `fixture@example.invalid`)
- no token -> 401, wrong token -> 401, right token `/health` -> ok, state idle, version 4.3.2.4.
- `/accounts` listed the fake account read from the API's **process environment** -> Phase 3 Option 1 (env injection) works for the API process.
- Server prints a stdout line `__API_READY__ {"host","port","pid","name","version","auth"}` when ready -> usable by EngineSupervisor instead of blind polling. Not in the README, found by running.
- Startup log: "Runtime state: memory-only". Run history and log buffer vanish when the API restarts.
- CORS origin printed as `*` by default.
- `/schedule` GET returned 200 (exists; we still do not use it).
- Server stopped cleanly after test. No run started, no browser launched.

## Findings that matter
1. **Engine lockfile uses a Chinese mirror for 2/178 packages.** Mitigated with `--replace-registry-host=always`; integrity hashes verify. Report to user, not patched.
2. **Engine tests are stale at the pinned commit (8/9 fail).** Cause confirmed: `abf2b54` (2026-08-30) made `logParser.js` match **Chinese** log lines; tests use English. Consequences: (a) our baseline for engine tests is "known failing", (b) V4-china engine log messages are **Chinese**, so Phase 10 per-account timelines and the log view will show Chinese text from the engine (app UI stays English), (c) our parsing must follow the Chinese format or use only structured fields (`user`, `level`, `platform`, `title`).
3. **API restart wipes history/logs buffer** (memory-only). Account edit needs API restart (Phase 3) -> Home "Finished||Failed" resets. Mitigation: our LogService persists files (B10); Phase 6 must persist run summaries itself.
4. CORS default `*`: set a restrictive `API_CORS_ORIGIN` in Phase 5/6 (still token-protected, loopback).

## Not verified
Real Windows (paths, `npm.cmd`, execution policy, taskkill, PID file). Browser download (`engine:browser`, host blocked in sandbox). Any real bot run. Whether the bot child inherits env from the API (only API reading was proven). Electron install (deferred to Phase 5). `npm audit` not run (offline-restricted, skipped on purpose; do in Phase 12).

## Deliverables
`rewards-farmer-phase4.zip` (264 files, ~2.7 MB, includes `.git` with submodule pin; excludes `node_modules`, `dist`; no secrets found by name scan), `SETUP_WINDOWS.md`, this report.

## Needs from you
1. Can you run `SETUP_WINDOWS.md` steps 1-4 on your PC and tell me exact output of `node --version` and `npm run check`? (Or I continue and Windows stays unverified.)
2. Keep app name "Microsoft Rewards Farmer" from screenshots? Using "Microsoft" in the name of a distributed app may raise trademark issues. Your call.
3. Phase 5 adds Electron + React + Vite (big downloads, binary from GitHub releases). OK?

## STOP
Phase 5 NOT started. Say `NEXT PHASE` when ready.

## UPDATE: real Windows run (user's PC, `diagnose-output.txt`)
Windows 10.0.26300.9550, Git 2.54.0.windows.1, Node v24.15.0, npm 11.12.1.
| Step | Result on Windows |
|---|---|
| `git submodule status` | `e0c15a6ae6bd102cb04f2a3351e2fa281f82961c engine` = pin OK |
| `npm ci` (app) | OK, 130 packages, 0 vulnerabilities |
| `typecheck`, `lint` | OK |
| `format:check` | **FAIL**: `SETUP_WINDOWS.md`. `npm run test` did NOT run (check chain stops at first failure) |
| `engine:install` | OK, 170 packages, `--replace-registry-host=always` worked, npm reports 2 high vulns |
| `engine:build` | OK |
Earlier failures in the first run were wrong folder (zip not unzipped), not project bugs.

**My mistake:** I appended a section to `SETUP_WINDOWS.md` after the last Prettier run and committed without rerunning `npm run check`, so my "check passes" was true for the previous commit only. Fixed in commit `c54bedf`; sandbox `npm run check` = exit 0, 7/7 tests. New zip contains the fix. NOT yet re-run on Windows.

### Engine `npm audit` (sandbox, 2 high)
- `brace-expansion` 4.0.0-5.0.11: dev only, via `eslint` -> `minimatch`. Not shipped.
- `adm-zip` <=0.6.0: runtime dependency, transitive via `fingerprint-generator` -> `generative-bayesian-network`. Advisories concern extracting untrusted ZIPs. Whether the engine ever does that: UNVERIFIED (no direct `adm-zip` use in engine `src/` or `scripts/`).
- `npm audit fix` NOT run: it edits upstream lockfile (unmodified-engine rule). Decide in Phase 12 (options: accept with note, override in our build, or pin a newer upstream commit after review).

### Windows status now
Verified on Windows: Git/Node/npm versions, submodule pin, app install, typecheck, lint, engine install + build.
Still unverified on Windows: app tests, `engine:browser`, any bot run, process kill, path handling in the app.
