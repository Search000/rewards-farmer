# Architecture (Phase 3 — proposal, needs your approval)

Evidence base: `V4-china` @ `e0c15a6`. Read: `scripts/api/README.md`, `scripts/api/server.js` (start of file, `/accounts` route), `scripts/api/accounts.js`, `scripts/env.js`, `src/interface/Config.ts`, `run.bat`. Nothing executed.

## 1. Choice summary
| Decision | Pick | Why |
|---|---|---|
| Shell | Electron + TypeScript | upstream is Node/TS (Node >=24), API is plain HTTP, Windows-first, one language. Chromium UI easy to match Material-style screenshots |
| UI | React + TypeScript + Vite; Material-style component lib (MUI candidate). Final lib choice in Phase 5 | screenshots show outlined floating-label fields, switches, FAB. NOT verified which lib original used |
| Engine | upstream `V4-china`, UNMODIFIED, own process | no patches = no fork to maintain; GPL boundary clearer |
| Engine link | upstream control API over `127.0.0.1` HTTP + SSE | documented, auth, no invented routes |
| Engine placement | git submodule pinned to commit, folder `engine/` | clean pin, update = bump pin (Phase 11) |

Rejected: **Tauri** (needs Rust toolchain + still needs Node 24 sidecar, more moving parts). **Direct import of upstream TS** (couples to internals, no stable interface, GPL entangles). **Python/Qt** (no benefit, upstream is Node).
Fork option: only if patch to upstream becomes unavoidable. Then personal fork, user approves, never push upstream without consent (rule 22).

## 2. Processes
```
 Renderer (React, sandboxed, no Node)
      │  typed IPC only (contextBridge preload)
 Main process (Electron, TS)
   ├─ EngineSupervisor ── spawns ──▶  node engine/scripts/api/server.js   (API child, 127.0.0.1:<random port>)
   │        │ HTTP+SSE (token)                    │ spawns on POST /start
   │        └────────────────────────────────────▶ node engine/dist/index.js (bot run)
   ├─ ApiClient   (typed wrapper, only documented routes)
   ├─ ConfigAdapter  (UI model <-> engine config.json via PATCH /config)
   ├─ AccountStore   (reads/writes user's chosen .env, backup first)
   ├─ Scheduler      (app-side timer -> POST /start)
   ├─ LogService     (SSE -> redact -> ring buffer -> renderer)
   └─ AppSettings    (%APPDATA%\<AppName>\app-settings.json, schemaVersion)
```
Renderer never talks to the API. Renderer never gets passwords, tokens, or raw `.env` text.

## 3. Data ownership
| Data | Owner | Location | Rule |
|---|---|---|---|
| Accounts + passwords + TOTP | user's `.env` (AccountStore) | path user picks (D4) | main process only. backup before write. never logged |
| Engine config | engine `config.json` | engine root | change only via PATCH `/config` (validated, applies next run) |
| App prefs (theme, timer, window) | app | `%APPDATA%\<AppName>\app-settings.json` | versioned, migrated |
| Sessions/cookies | engine | `engine/sessions` | never read by app, never exported, never in Git. delete only via DELETE `/sessions/:email` |
| API token | main memory | RAM only | random per launch, never shown, never on disk |
| Logs | engine ring buffer (RAM) + app log file | `%APPDATA%\<AppName>\logs` | redacted before write |
| Webhook tokens (Telegram/Discord) | engine `config.json` (plain, upstream behavior) | engine root | masked in UI after save |

## 4. Engine lifecycle
1. **Start app:** single-instance lock. Look for stale PID file from a crashed run, handle orphan API child.
2. Check `engine/dist/index.js` exists. If not: show "engine not built" state (build step belongs to Phase 4/14, not auto-run).
3. Pick free port, generate 32-byte token. Spawn API with env: `API_HOST=127.0.0.1`, `API_PORT`, `API_TOKEN`, `API_ALLOW_CONFIG_WRITE=true`. Everything else stays default-false (`ALLOW_CONFIG_REVEAL`, `ALLOW_ENV_OVERRIDES`, `ALLOW_SCHEDULE_WRITE`). Token goes by env var, not `--token` (command line is visible to other processes).
4. Poll `/health` until ok or timeout (state: "engine starting" / "engine failed").
5. Open `/events` SSE. Reconnect with backoff. Drop to polling `/logs?afterId` if SSE fails.
6. **Run:** UI Start -> POST `/start` (`accountIndex` or `excludedAccountIndexes`). Stop -> POST `/stop`.
7. **Quit app:** POST `/stop` if running, wait, POST `/shutdown`, then kill process tree (`taskkill /T`) as last resort. Never leave orphans.
8. **API crash:** show "engine down" + Restart button. No silent infinite restart loop (max 3 tries, then stop and tell user).
9. **Shutdown toggle (D7):** after run ends and no timer pending, run steps of "Quit app".

## 5. Accounts (key design issue, evidence-based)
- Engine reads `.env` from its own project root once at API start (`loadEnvFile(projectRoot)`, `server.js` line 35). `GET /accounts` rebuilds from `process.env` (`loadAccounts()`), no reload.
- Consequence A: after add/edit/remove account the API child **must be restarted**. Blocked while a run is active. UI says so.
- Consequence B: engine expects `.env` in ITS root. User picks a `.env` elsewhere (D4). Two ways:
  - **Option 1 (recommended, needs Phase 4 spike):** AccountStore parses the chosen `.env` in main process, spawns API child with those `ACCOUNT_*` vars in its environment. Engine root untouched. UNVERIFIED that the bot child inherits them and `loadEnvFile` does not override.
  - **Option 2 (fallback):** copy chosen `.env` into engine root with backup + your approval. Two copies = drift + secrets in two places.
- API has no account write route. AccountStore is NEW code, not an invented endpoint.

## 6. Settings
ConfigAdapter keeps a typed map `UI control -> config.json path` (only rows marked SUP in the matrix). Unsupported controls render disabled with reason. Save = PATCH `/config`; handles 403 (writes disabled), 422 (validation, show message), 200 (`appliesOnNextRun`). Reset to defaults = backup then PUT from `config.example.json`, confirmed by user.
Delay fields: UI uses same `{min,max}` strings as engine ("6min"). Screenshot's single number does not fit. Decide in Phase 8.
Not built (D1): Randomization, Typo %, User-Agent override, Geolocation, Collect cookies, Share data.

## 7. Timer (D5)
App-side Scheduler in main process: user picks time, app calls POST `/start` at that time. Works only while app runs. UI says so. Not using `/schedule` (Windows persistence unverified). Missed time (PC asleep) -> do not catch up silently, show notice.

## 8. IPC contract rules
- Channels named and typed in one shared `ipc-types.ts`. No generic "invoke anything" passthrough.
- Input validated in main (schema). Output typed. Errors = `AppError {code, message, httpStatus?, retryable}`.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP, block navigation and new windows, `shell.openExternal` allow-list.

## 9. Error mapping
API `{error, code}` + HTTP: 400 -> `BAD_REQUEST`, 401 -> `AUTH` (token mismatch = bug, restart engine), 403 -> `WRITE_DISABLED`, 404, 409 -> `RUN_ACTIVE`, 422 -> `CONFIG_INVALID` (show text), 500 -> `ENGINE_ERROR`. Network refused -> `ENGINE_DOWN`.

## 10. Offline / failure
Engine is local, so app UI works offline. Bot run fails with its own logs. Update check (Phase 11) fails soft. Missing engine, bad token, port taken, `.env` unreadable, config invalid: each gets a named UI state.

## 11. Update boundary
Engine pinned. Phase 11 only: check upstream, show commit diff, require your approval, backup, test, install, rollback. Never run latest blindly (rule 11).

## 12. License and compliance (not legal advice)
Upstream GPL-3.0-or-later. App + engine shipped together: license app GPL-3.0-or-later, ship LICENSE + source offer + upstream notices. Separate process over HTTP does not by itself remove obligations when distributed together. Lawyer check before any public release.
About page shows risk notice: automation may violate Microsoft terms, accounts may be restricted (upstream README says so). No promise of safety.

## 13. Logging and audit (user requirement, added after approvals)
Goal: every thing the app does is written to log files: what happened, when, which account, what action, result. Nothing important only on screen.

### Files (in `%APPDATA%\<AppName>\logs\`)
| File | Content |
|---|---|
| `app.log` | app lifecycle: start/quit, window, IPC errors, crashes, updates, engine supervisor events (spawn, port, health, restart, kill) |
| `audit.log` | every USER action: Start/Stop/Restart, account add/edit/remove (no password), settings save (changed keys + old/new non-secret values), reset to defaults, backup/restore, timer set/fire/miss, session delete, toggle changes, file picks |
| `engine.log` | engine stream from `/events` and `/logs`, redacted. all levels |
| `accounts/<email>.log` | per-account timeline: login, each task started/finished, points gained, balance, errors, warnings, run result. Built from parsed engine log fields (`user`, `platform`, `title`, `message`) |
| `runs/<runId>.log` | one file per run: start time, args (accountIndex/excluded), accounts seen, per-account result, total points, exit code/lastExit |
| `errors.log` | warn+error only from all sources (quick triage) |
| `diagnostics/` | copies of engine diagnostic capture metadata (not raw secrets) |

### Line format (JSON Lines, one object per line)
`{"ts":"ISO-8601 local+offset","level":"info","source":"app|audit|engine","component":"Scheduler","runId":"...","account":"user@x.com","platform":"DESKTOP","action":"SEARCH-BING","result":"ok","message":"pointsGained=3 | currentBalance=12483","corrId":"..."}`
Rules: UTC offset in every timestamp, monotonic id, `corrId` links a UI click to the API call and its result (click Start -> POST `/start` -> run). Human view in UI formats it (Phase 10), file stays machine-readable.

### Account visibility (your decision 7: full emails)
Emails full in logs and UI. Still NEVER: passwords, TOTP secrets, recovery email, cookies, session contents, `Authorization`, API token, Telegram bot token, Discord webhook URL, proxy username/password. Redaction runs in main before any write.

### Mechanics
- Single `LogService` in main, async buffered writes, flush on quit and on crash handler.
- Rotation by size (default 10 MB) and age; keep N files (default 14 days). Defaults configurable later (Phase 10).
- Never delete logs without your consent (rule 10). Rotation = archive, `Clear logs` = confirm dialog + backup.
- Log write failure (disk full, locked): show UI warning, keep in-memory ring, do not crash, retry.
- Engine also writes its own files (`engine/logs`, e.g. `last-success.txt`). App leaves them alone, only reads when needed.
- Export: Phase 10 builds filter + export (selected range, account, level) with redaction re-applied.
- Gaps: engine log lines that don't parse (`parsed:false`) go to `engine.log` raw (redacted), not into account files. Account timeline quality depends on upstream log format, to test in Phase 10.
