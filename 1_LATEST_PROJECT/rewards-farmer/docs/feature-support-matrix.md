# Feature Support Matrix (Phase 2)

Basis: upstream `chiihero/Microsoft-Rewards-Script`, branch `V4-china` (ASSUMED, not yet approved). Evidence: `src/interface/Config.ts`, `config.example.json`, `env.example`, `scripts/api/README.md`, `scripts/api/accounts.js`, plus keyword grep over `src/` and `scripts/`.
Only file/doc reading. Nothing run. "Supported" = a matching field/endpoint exists on paper, not tested.

Labels: REQ = required by screenshot. SUP = supported upstream. NEW = needs new implementation. UNSAFE = not appropriate / not built. DEC = needs user decision.

## Engine interface (what the app may call, no invented routes)
GET `/health /status /points /logs /errors /history /accounts /sessions /diagnostics /config /schedule /events`
POST `/start` (`accountIndex` | `excludedAccountIndexes`) `/stop /restart /shutdown`
PATCH/PUT `/config` (needs `API_ALLOW_CONFIG_WRITE=true`, validated, applies next run only)
PUT/PATCH `/schedule` (needs `API_ALLOW_SCHEDULE_WRITE=true`; README ties persistence to Docker API mode — Windows behavior UNVERIFIED)
DELETE `/sessions/:email`. Auth: Bearer token / X-API-Key. Config secrets redacted unless `API_ALLOW_CONFIG_REVEAL=true`.
Accounts: only via `.env` `ACCOUNT_N_*`. API has NO account write endpoint.

## Home
| Control | Class | Upstream mapping / note |
|---|---|---|
| Start | REQ + SUP | POST `/start` |
| Stop | REQ + SUP | POST `/stop` |
| Current account | SUP | `/points.currentAccount` |
| Current point | SUP | `/points.balance` |
| Section, Detail | DEC | no clear field; maybe parsed from `/status` run state. UNVERIFIED |
| Proxy (current) | SUP | `/accounts` proxy summary (credentials stripped) |
| All | SUP | `/points.accountsTotal` |
| Finished \|\| Failed | SUP (partial) | `/history`, `/errors`. exact fields UNVERIFIED |
| Locked, Suspended | DEC | no upstream field found. show "unknown", never 0 |
| Accounts Path + Open | NEW + DEC | accounts live in `.env`, not a path field. choose: pick `.env` file, or pick repo dir |
| Alternate proxies + Open | NEW + DEC | upstream has per-account proxy in `.env`, no alternates file |
| Start at + Timer | NEW + DEC | `/schedule` is cron, Windows persistence unclear. else app-side timer (new) |
| Theme sun / palette / spinner / kebab | REQ, NEW | app-only UI. kebab and palette contents unknown |

## Accounts
| Control | Class | Note |
|---|---|---|
| List accounts | SUP | GET `/accounts` (email, geoLocale, langCode, hasTotp, proxy sanitized) |
| Add account | NEW + DEC | must write `.env` locally with backup + approval. passwords never in UI logs |
| Edit/remove | NEW + DEC | same. not visible in screenshots |
| Empty-state text | REQ | text only |

## Settings: top card
| Control | Class | Note |
|---|---|---|
| PC / Mobile User Agent fields | UNSAFE + DEC | no upstream field (upstream generates fingerprints, `src/browser/UserAgent.ts`). UA override = spoofing. not built |
| Reset to defaults | NEW | reset to `config.example.json` values, with backup |
| Save | SUP | PATCH `/config` (needs write flag) |

## Settings: App & browser
| Control | Class | Note |
|---|---|---|
| Device name | NEW + DEC | no upstream field |
| Log level | SUP (partial) | `consoleLogFilter.levels`, `debugLogs`. not 1:1 with "Info" |
| Browser "Google Chrome" | DEC | `browserChannel` allows only `chromium` \| `msedge`. Chrome not supported |
| Headless | SUP | `headless` |
| Session | DEC | `sessionPath` + `/sessions`; meaning of toggle unknown |
| Refresh proxy / Use proxy | DEC | proxy is per-account `.env`; `proxy.queryEngine` exists. toggles unclear |
| Shutdown | DEC | unknown meaning (shutdown PC?). if PC shutdown: needs explicit consent design |
| Disable images | SUP (candidate) | `experimental.blockMedia` |
| Randomization | UNSAFE + DEC | human-mimic. maps near `humanize` |
| Check Bing | DEC | no field found |
| Logs in excel | NEW + DEC | no upstream Excel (grep: none) |
| Share data | UNSAFE-ish + DEC | no field. default no telemetry (prompt rule) |
| Check restriction | DEC | no field found |
| Gift card URL | NEW + DEC | only `DashboardData.ts` mentions gift. no config |
| Parallel mode | SUP (candidate) | `searchSettings.parallelSearching`, `clusters`. unclear |
| Timezone | DEC | upstream reads TZ in code; no config field |
| Latitude/Longitude, Reset/Save Geolocation | UNSAFE | no upstream (grep: none). location spoof. not built |
| Point target | NEW | only used for Excel coloring in screenshot. no Excel, so drop or DEC |

## Settings: Task
| Control | Class | Note |
|---|---|---|
| Daily quests | SUP | `workers.doDailySet` |
| More activities | SUP | `workers.doMorePromotions` |
| Punch cards | SUP | `workers.doPunchCards` |
| PC search | SUP | `workers.doDesktopSearch` |
| Mobile search | SUP | `workers.doMobileSearch` |
| Read to earn | SUP | `workers.doReadToEarn` |
| Visual Search | SUP | `workers.doVisualSearch` |
| Explore on Bing | SUP (candidate) | `activities.searchOnBing` |
| Speed, Search method, Tasks method | DEC | no matching fields |
| Check status of accounts | DEC | no field |
| Collect cookies | UNSAFE-ish + DEC | no field (grep none). cookie harvesting banned by prompt |
| Daily set / More activities / Read-to-earn "completion mode" | DEC | no fields |
| Visual search Images path / Open / Clear dir | NEW + DEC | no field |
| OpenRouter API key | NEW + DEC | no OpenRouter in upstream (grep none). secret handling needed |
| Cooldown mode | DEC | no field |
| Delay after search | SUP (format differs) | `searchSettings.searchDelay` is {min,max} strings like "6min"; screenshot has one number |
| Delay after task | DEC | maybe `accountDelay`/`readDelay`. unclear |
| Search words setting | DEC | upstream has `queryEngines`, JSON query files. dialog unseen |
| Search count method | DEC | maybe `maxBonusSearches`. unclear |
| Open search results | SUP (candidate) | `clickRandomResults`/`scrollRandomResults` |
| Typo probability slider | UNSAFE | no upstream (grep none). human-mimic. not built |

## Sidebar pages
| Page | Class | Note |
|---|---|---|
| Telegram | SUP. Tokens on the "Secrets & API keys" page (no own sidebar item) | `webhook.telegram {enabled, botToken, chatId}` |
| Discord | SUP. Webhook URL on the "Secrets & API keys" page (no own sidebar item) | `webhook.discord {enabled, url}` |
| Parallel farming | DEC (no screenshot) | unknown scope |
| About | NEW (no screenshot) | version, GPL-3.0 notice, risk notice |
| Health: Export diagnostics | NEW (no screenshot, master prompt Phase 14) | one ZIP: versions, engine config with secrets hidden, health results, newest lines of app/engine/errors logs. Not an upstream route: the app builds it itself from its own files. Safety check blocks the save if anything secret is found |
| Health: Open guide | NEW (no screenshot, master prompt Phase 15) | Each warning, error or unknown row on the Health page has an "Open guide" button. It opens the matching section of `docs/troubleshooting.md` in a window. The app reads the guide file itself (nothing is typed in the app), so the page and the file cannot disagree. Not an upstream feature. |
| Backup service | NEW (no screenshot, master prompt Phase 18) | Service from Phase 18, connected to the Backups page in Phase 19 (see the next row). One backup = copies of `config.json`, the accounts file and the app settings, plus `manifest.json` (app version, time, SHA-256 per file, skipped list, account count). Written in a hidden temp folder, flushed, read back, manifest last, ONE rename. Folder private to the current user. Not an upstream feature; the app builds it from its own files. Holds secrets, not encrypted. |
| Backups page: create, list, inspect, check after writing, open folder | NEW (no screenshot, master prompt Phase 19) | Every backup is checked after writing and again on every list / inspect (manifest, id, files present, size, SHA-256); damaged = shown as Damaged, failed = set aside under a hidden name. Free space is checked before writing. Failures give the exact reason and a "What to do". No Restore, Delete, encryption or folder choice yet. Page code in `src/renderer/pages/BackupsPage.tsx`, service in `src/main/backupService.ts`. |

## Counts
Rows classed SUP (full or candidate): about 17. UNSAFE: 6 (UA override, Randomization, geolocation, typo, plus Share data / Collect cookies as unsafe-ish). DEC or NEW without upstream: the rest. Approx; matrix is the source, not this line.
