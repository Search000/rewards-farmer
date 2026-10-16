# Integration Contract (Phase 3)

App <-> engine. Only routes documented in `scripts/api/README.md` @ pinned commit. Auth header: `Authorization: Bearer <token>` (SSE: header, not `?token=`, since main process is Node and can send headers).
Base: `http://127.0.0.1:<port>`. Max body 1,000,000 bytes. Errors: `{error, code?}`.

## Allowed routes
| Use | Route | Notes |
|---|---|---|
| Readiness | GET `/health` | poll at launch |
| Run state | GET `/status` | `state`, `pid`, `startedAt`, `lastExit`, `run.accounts[]`. Also pushed by SSE `status`/`hello` |
| Points widget | GET `/points` | `currentAccount`, `balance`, `collected`, `accountsTotal`, `accountsSeen`, `finished`, `accounts[]` |
| Logs | GET `/logs?limit&afterId&level` | fallback if SSE down |
| Live | GET `/events?replay=N` | events `hello`, `log`, `status`. keep-alive 15 s |
| Errors/History | GET `/errors`, `/history` | Finished\|\|Failed counts (field names to read in Phase 6) |
| Accounts list | GET `/accounts` | email, geoLocale, langCode, hasTotp, proxy (sanitized). read only |
| Sessions | GET `/sessions`, DELETE `/sessions/:email` | DELETE gives 409 while run active |
| Diagnostics | GET `/diagnostics`, `/diagnostics/<cap>/<file>` | read only |
| Config read | GET `/config` | redacted by default. `reveal` stays disabled |
| Config write | PATCH `/config` (deep merge, arrays replace), PUT `/config` (full) | needs `API_ALLOW_CONFIG_WRITE=true`. 403 if off, 422 invalid. applies next run |
| Run control | POST `/start` {accountIndex | excludedAccountIndexes}, `/stop`, `/restart`, `/shutdown` | 202. `accountIndex` and `excludedAccountIndexes` exclusive. `args` and `env` NOT used |

## Not used
`/schedule` (app-side timer instead), `args`/`env` overrides, `/config?reveal=1`, `PUT/PATCH /schedule`.

## Engine env set by app
`API_HOST=127.0.0.1`, `API_PORT=<free>`, `API_TOKEN=<random>`, `API_ALLOW_CONFIG_WRITE=true`, `API_CORS_ORIGIN=<non-browser value; verify behavior in Phase 4>`. Account vars per Section 5 of architecture (Option 1) if approved.

## Gaps = adapter work, not invented API
| Gap | Adapter |
|---|---|
| Account add/edit/remove | AccountStore edits user's `.env`, restart API child |
| `.env` location | env injection (Opt 1) or copy (Opt 2) |
| Home "Section", "Detail" | find in `/status.run` in Phase 6, else show "-" |
| Locked, Suspended | no source. show "unknown" |
| Timer | app Scheduler |
| Settings without upstream field | disabled + reason |
| Delay format | keep engine `{min,max}` strings |

## Versioning
App records engine commit + `package.json` version at launch. If `GET /` or `/status` version differs from pinned, show warning and disable config writes until reviewed. Routes pinned by contract test (Phase 4/12): a test hits each allowed route against a real engine in an isolated temp dir with FAKE test accounts (fixtures only in tests, never in real store).
