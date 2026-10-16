# Phase 02 Report — Requirements & Feature Map

## Verdict: DONE with open decisions. Matrix complete; many rows marked DEC.

## What me did
- Read: `Config.ts`, `config.example.json`, `env.example`, `scripts/api/README.md` (endpoints, env vars, start/config/status/points), `scripts/api/accounts.js`. Keyword grep for openrouter, typo, excel, gift, geolocation, timezone, point target, cookies, share data, restriction.
- Mapped every visible control from 7 screenshots. See `docs/feature-support-matrix.md`, `docs/requirements-matrix.md`.

## Key facts
1. Accounts live in `.env` (`ACCOUNT_N_*`). API cannot add/remove accounts. Accounts page add/edit needs NEW local `.env` writer.
2. `browserChannel` = `chromium` | `msedge` only. Screenshot "Google Chrome" unsupported.
3. No upstream hits for: OpenRouter, typo probability, Excel logs, geolocation, point target, share data, collect cookies, restriction. Not faked.
4. Config write needs `API_ALLOW_CONFIG_WRITE=true`; applies next run only.
5. `/schedule` write needs flag; README ties persistence to Docker API mode. Windows timer: UNVERIFIED.

## Not verified
Nothing executed. Mappings marked "candidate" are name guesses, not code-path reads. `Section`/`Detail` fields not found. `/history` exact fields not read. Delay units differ (screenshot number vs "6min" strings).

## Still open (need you)
1. Phase 1 flag 1: (a) wrap as-is / (b) hide evasion / (c) drop. Me assumed (b).
2. Engine `V4-china`: assumed yes.
3. Unsupported controls disabled+labeled: assumed yes.
4. Accounts Path button: choose `.env` file or repo folder.
5. Timer: app-side timer (new) or skip.
6. Browser: Chrome unsupported — use Edge/Chromium dropdown instead?
7. "Shutdown" toggle: PC shutdown? If yes, needs consent design.
8. Visual match rule V8 OK?

## Files
`docs/requirements-matrix.md`, `docs/feature-support-matrix.md`, `reports/phase-02-requirements.md`

## STOP
Phase 3 NOT started. Say `NEXT PHASE` for architecture. Better: answer open items first.

## UPDATE: user answers
Items 2-8 answered, see `docs/requirements-matrix.md` section "DECISIONS RECORDED" (D2-D8).
Item 1: user wants human-mimic controls. Assistant declines Randomization, Typo %, UA override, Geolocation. Rest of project proceeds without them. Phase 1 flag 1 stays at (b).
Open: none blocking. Phase 3 NOT started. Waiting `NEXT PHASE`.
