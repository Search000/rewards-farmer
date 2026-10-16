# Branch Comparison: main vs V4-china (Phase 1)

Source: `git clone https://github.com/chiihero/Microsoft-Rewards-Script.git` (local clone, default branch = V4-china). All values below observed from that clone.

| Item | main | V4-china |
|------|------|----------|
| Latest commit | `ad1b52f` 2026-08-18 | `e0c15a6` 2026-09-29 |
| package.json version | 3.1.6.4 | 4.3.2.4 |
| Divergence | 146 commits main-only | 116 commits V4-china-only |
| License field | GPL-3.0-or-later | GPL-3.0-or-later |
| Node engine | >=24.0.0 | >=24.0.0 |
| Browser engine | patchright (chromium) | patchright (chromium) |
| Control HTTP API (`scripts/api/`) | not present | present, `npm run api` |
| Test files | 0 found by name match | `scripts/api/logParser.test.js`, `scripts/tests/smokeClawbot.cjs` |
| Test scripts | none | `test:log-parser`, `test:clawbot-smoke` |
| Config example | `config.example.json` | `config.example.json` |
| Windows scripts | `setup.bat`, `run.bat` | `setup.bat`, `run.bat` |
| Docker | Dockerfile, compose.yaml | Dockerfile, compose.yaml |
| Extra | `.agents/`, `AGENTS.md`, `diagnose-cron.sh` | `manual-login`, `clawbot:login`, `copyAssets` build step |
| README language | not read in full | Chinese |

## V4-china control API (scripts/api/server.js, route list grepped)
GET `/` `/health` `/status` `/points` `/logs` `/errors` `/history` `/accounts` `/sessions` `/diagnostics` `/config` `/config/diff` `/schedule` `/events` (SSE).
POST `/start` `/stop` `/restart` `/shutdown` `/config/sync`.
PUT/PATCH `/config`, `/schedule`. DELETE `/sessions`.
Enabled by `API_MODE=true` + `API_TOKEN` (per README). Full contract in `scripts/api/README.md` — **only skimmed, not fully read**.

## Not verified
- No build, install, lint, or test run. Nothing executed beyond git/grep/cat.
- `main` API absence inferred from file listing, not a full tree audit.
- Release/tag list not checked. Upstream relationship to original author (package.json author "Netsky") not traced.

## Early lean (evidence only, not decision)
V4-china has the HTTP API a desktop shell can drive without inventing endpoints (rule 5). main has none. Decision belongs to Phase 3 with user approval.
