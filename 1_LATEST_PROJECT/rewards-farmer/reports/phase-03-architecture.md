# Phase 03 Report — Architecture & Integration Design

## Verdict: DESIGN DONE. Needs your approval before any code.

## Evidence read
`scripts/api/README.md` (routes, auth, SSE, status codes, env vars, security), `scripts/api/server.js` (env load at line 35, `/accounts` route), `accounts.js`, `env.js`, `config.example.json`, `Config.ts`, `run.bat`. No code run. No dependency installed.

## Proposal
Electron + TypeScript shell, React UI. Upstream `V4-china` pinned submodule in `engine/`, unmodified, run as separate process. App talks only to its control API on 127.0.0.1 with random token. See `docs/architecture.md`.

## Findings that change the plan
1. Accounts read once at API start -> any account change needs API restart (blocked during run).
2. Engine expects `.env` in its own root. User's chosen `.env` needs env-injection or copy. Spike in Phase 4.
3. Config Save needs `API_ALLOW_CONFIG_WRITE=true` on the app's private API only.
4. No account write route exists. AccountStore = new local code.
5. Timer = app-side (D5) since `/schedule` Windows behavior unverified.

## Not verified
Electron/Node version compat (engine needs Node >=24, runs separate so likely fine), env inheritance to bot child, `API_CORS_ORIGIN` behavior, exact `/history` and `/status.run` field names for Finished\|\|Failed and Section/Detail, whether `.env` loader overrides existing env.

## Approvals needed from you
1. Electron + TypeScript + React (yes/no).
2. Engine = pinned submodule, unmodified, separate process (yes/no).
3. Enable `API_ALLOW_CONFIG_WRITE` for the app's private API (yes/no).
4. App license GPL-3.0-or-later (yes/no, lawyer check later).
5. Node 24 runtime: bundle `node.exe` in installer (recommended) or require system Node.
6. Accounts `.env`: Option 1 env-injection (spike first) or Option 2 copy.
7. Log emails: show full, or mask partly (a***@x.com)?

## Files
`docs/architecture.md`, `docs/integration-contract.md`, `docs/threat-model.md`, `reports/phase-03-architecture.md`

## STOP
Phase 4 NOT started. Say approvals, then `NEXT PHASE`.

## UPDATE: approvals received
1 OK, 2 OK, 3 OK, 4 OK, 5 OK (read as: bundle node.exe), 6 BOTH (Option 1 primary + Option 2 fallback), 7 full emails.
Details in `docs/requirements-matrix.md`.

## UPDATE: logging requirement
User wants all app work in log files: what, when, which account, which action. Added `docs/architecture.md` section 13 (7 log types, JSONL format, correlation ids, redaction, rotation, failure handling) and requirement B10 / AC7.
Not verified: how well upstream log lines parse into per-account timelines. Test in Phase 10.

## Gate
Phase 3 approved. Phase 4 NOT started. Waiting `NEXT PHASE`.
