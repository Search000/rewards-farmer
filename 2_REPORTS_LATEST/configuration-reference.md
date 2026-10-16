# Configuration reference (Phase 8 and 9)

Source of truth: `src/shared/engine-settings-rules.ts` (`FIELDS`). Defaults are read from the engine's own
`engine/config.example.json`. This app never edits `config.json` directly: it reads it with `GET /config` and writes
only changed fields with the engine's validated `PATCH /config`.

| Screen control | config.json path | Type | Default (example config) | Allowed values | Takes effect |
| --- | --- | --- | --- | --- | --- |
| Log level | `debugLogs` | bool (shown as Info / Debug) | `true` (Debug) | Info = `false`, Debug = `true` | next run |
| Browser | `browserChannel` | string | `"chromium"` | `chromium`, `msedge` | next run |
| Headless | `headless` | bool | `false` | true / false | next run |
| Use proxy for search queries | `proxy.queryEngine` | bool | `false` | true / false | next run |
| Disable images | `experimental.blockMedia` | bool | `false` | true / false | next run |
| Parallel mode (search) | `searchSettings.parallelSearching` | bool | `false` | true / false | next run |
| Daily quests | `workers.doDailySet` | bool | `true` | true / false | next run |
| Punch cards | `workers.doPunchCards` | bool | `true` | true / false | next run |
| More activities | `workers.doMorePromotions` | bool | `true` | true / false | next run |
| Explore on Bing | `activities.searchOnBing` | bool | `true` | true / false | next run |
| PC search | `workers.doDesktopSearch` | bool | `true` | true / false | next run |
| Mobile search | `workers.doMobileSearch` | bool | `true` | true / false | next run |
| Read to earn | `workers.doReadToEarn` | bool | `true` | true / false | next run |
| Visual Search | `workers.doVisualSearch` | bool | `false` | true / false | next run |

## Behavior

- **Validation.** The renderer is untrusted. The main process accepts only an object with exactly the 41 keys of the two
  tables (14 from Phase 8, 27 from Phase 9) with the right types and inside the limits below. Anything else is refused and nothing is written.
- **Missing field.** If a field is absent from `config.json`, the engine example value is shown, the screen says so, and
  nothing is written until the user saves.
- **Wrong type in config.json.** The screen shows an error. The value is never silently fixed.
- **Save.** Only changed fields are sent. A backup copy of `config.json` is made first; if the backup fails, nothing is
  written. The values are read back after the write. An audit line lists the changed field names (no secret values).
- **Engine rejects (HTTP 422).** Nothing changes; the engine's reason is shown.
- **Reset to defaults.** Restores all 41 fields to the example values (with a backup). Other fields (webhooks,
  accounts, anything not in this table) are kept. Disabled if the example config cannot be read.
- **During a run.** Save and Reset are disabled with the reason. The file stays as it was.
- **Unsaved changes.** Leaving the Settings page with unsaved changes asks for confirmation.

## App setting (not an engine field): Shutdown

| Screen control | Stored in | Type | Default | Takes effect |
| --- | --- | --- | --- | --- |
| Shutdown | `<userData>/app-settings.json` -> `shutdownAfterRun` | bool | `false` | at once (no Save needed) |

- Meaning: **close this app** after a run. It does not shut down the PC.
- It closes the app only after a run that **finished without errors** (exit code 0). If the user pressed Stop, or the run
  ended with an error, the app stays open so the result can be read. The engine is stopped cleanly by the normal quit path.
- `app-settings.json` is now schema 2. A schema 1 file is copied to `app-settings.schema1-<time>.json` first, then
  upgraded with the old values kept. If the copy fails, the old file is not touched.
- Each switch change and each close request is written to the audit log (`set-shutdown`, `shutdown-after-run`).

## Controls in the reference screenshots that are NOT built

| Control | Reason |
| --- | --- |
| PC / Mobile User Agent, Randomization, Collect cookies, Share data | Protection-evasion or data-harvesting behavior (rule 9, decision D1) |
| Device name, Session, Refresh proxy, Check Bing, Check restriction, Check status of accounts | The engine has no such setting |
| Logs in excel, Point target, Gift card URL | The engine has no such setting |
| Speed, Search method, Tasks method, completion modes | The engine has no such setting |

Secrets (webhook tokens, API keys, `chinaApi.appkey`) are Phase 10.

# Phase 9: login, check-in, timing and search options

Same rules as above (read with `GET /config`, write only changed fields with `PATCH /config`, backup first, read back,
audit line, disabled during a run). All of these take effect **from the next run**. "Engine use" is the place in the pinned
engine source (`e0c15a6`) that reads the field, so each switch has a real effect.

## Login, check-in and rewards (switches)

| Screen control | config.json path | Default (example) | Engine use |
| --- | --- | --- | --- |
| Prewarm desktop login | `prewarmDesktopLogin` | `false` | `src/index.ts:777` |
| Daily check-in | `workers.doDailyCheckIn` | `true` | `src/index.ts:979` |
| Streak protection | `ensureStreakProtection` | `true` | `src/index.ts:940`, `Activities.ts:87` |
| Claim bonus points | `workers.doClaimBonusPoints` | `true` | `src/index.ts:1100` |
| Activate search perk | `workers.doActivateSearchPerk` | `true` | `src/index.ts:947` |
| App promotions | `workers.doAppPromotions` | `true` | `src/index.ts:983` |
| URL rewards | `activities.urlReward` | `true` | `PromotionActivityRunner.ts:51` |
| Auto-claim punch cards | `autoClaimPunchcardRewards` | `false` | `PunchCards.ts:181` |
| Skip tasks without points | `skipNonPointTasks` | `true` | `PunchCards.ts:58`, `UrlReward.ts:41` |

## Timing

Text with a **required unit**: `ms`, `s`/`sec`, `m`/`min`, `h`/`hr`, `d`/`day` (decimals allowed, for example `1.5h`). The
engine reads the same text with the `ms` library; a test compares both parsers. A number already in `config.json` is
milliseconds: the screen shows it as `50000ms` and does not rewrite it unless you edit that field.

| Screen control | config.json path | Default | App limit | Engine use |
| --- | --- | --- | --- | --- |
| Between accounts: min / max | `accountDelay.min` / `.max` | `1min` / `3min` | 0 to 24 h, max >= min | `src/index.ts:665` |
| Between searches: min / max | `searchSettings.searchDelay.min` / `.max` | `6min` / `12min` | min at least 1 sec, up to 24 h, max >= min | `BrowserSearch.ts:188` |
| Read to earn delay: min / max | `searchSettings.readDelay.min` / `.max` | `6min` / `11min` | min at least 1 sec, up to 24 h, max >= min | `ReadToEarn.ts:19` |
| Page timeout | `globalTimeout` | `50sec` | 1 sec to 24 h | `Browser.ts:229` |
| Result page stay time | `searchSettings.searchResultVisitTime` | `20sec` | 0 to 24 h | `BrowserSearch.ts:225` |

- The engine itself only needs a non-negative duration and max >= min. **Stricter app limits**: a unit is required, at
  most 24 h, and Page timeout at least 1 sec (0 would mean "no timeout" for the browser). Tested against the engine's real
  zod schema (`tests/engine-validator.parity.test.ts`).
- **Floor (your decision 2, my choice):** the minimum of Between searches and of Read to earn delay is at least 1 sec, so
  a search or article never repeats at once. Between accounts has no floor (0 is fine for one account).
- A delay shorter than the engine example value shows a note ("Shorter than the engine default. Faster runs can raise the
  chance of account restrictions."). It is a note, not an error: the user decides. Nothing here helps to get around a
  limit of Microsoft; it only changes how long this program waits.
- A `config.json` that already has max < min is shown with the error and cannot be saved until both values are fixed
  (the engine would refuse that file too).

## Search options

| Screen control | config.json path | Type | Default | App limit | Engine use |
| --- | --- | --- | --- | --- | --- |
| Bonus searches | `workers.doBonusSearches` | bool | `false` | | `src/index.ts:915` |
| Max bonus searches | `searchSettings.maxBonusSearches` | whole number | `110` | 0 to 1000 (engine: any number) | `BonusTracker.ts:27` |
| Search when 0 points left | `searchSettings.runOnZeroPoints` | bool | `false` | | `BrowserSearch.ts:283` |
| Related searches | `searchSettings.clusterSearch` | bool | `true` | | `QueryEngine.ts` (`getSearchCluster`) |
| Local words for Explore on Bing | `searchOnBingLocalQueries` | bool | `false` | | `SearchOnBingShared.ts:78` |
| Search word sources | `searchSettings.queryEngines` | list, order matters | `china`, `local` | at least one, no repeats | `QueryEngine.ts:198` |

- Sources the page offers: `china`, `local`, `google`, `wikipedia`, `wikirandom`, `hackernews`, `reddit`. The engine also
  accepts `rss`, `rss.<site>`, `rss.<site>.<feed>`: if they are already in `config.json` they are kept and shown ("Kept from
  config.json"), but the page does not offer them. A save sends the whole list (the engine replaces arrays, it does not merge).
- The order is the order in which a source was ticked; a source ticked later goes to the end.

## Advanced and experimental (your decision 3)

| Screen control | config.json path | Type | Default | App limit | Engine use |
| --- | --- | --- | --- | --- | --- |
| Accounts at the same time | `clusters` | whole number | `1` | 1 to 8 (engine: any whole number from 0) | `src/index.ts:160`, `:306` |
| Search over HTTP (experimental) | `experimental.apiSearch` | bool | `false` | | `Activities.ts:39` |
| Explore on Bing over HTTP (experimental) | `experimental.apiSearchOnBing` | bool | `false` | | `Activities.ts:53` |
| Ignore proxy certificate errors | `proxy.ignoreCertificateErrors` | bool | `false` | | `Browser.ts:58` (only when an account uses a proxy) |

- Ignore proxy certificate errors turns the TLS check off for proxy connections. A warning is shown next to it. Use only
  with a proxy you trust.
- `experimental.edgeBrowsing` is **not built**: the engine uses it to report Edge browsing that did not happen in a browser
  (`src/index.ts:266`). That is made-up activity, so it is left out.

## Phase 9 fields that were checked and NOT built

| Field | Reason |
| --- | --- |
| `contintueOnBotWarning` | Makes the engine keep going after Microsoft reports a bot-score warning. Protection circumvention (rule 9). Left at the file value. |
| `searchSettings.scrollRandomResults`, `clickRandomResults` | You asked for it to look human. Declined (rule 9, same as D1): imitating human behaviour to avoid bot detection is evasion. The screenshot control stays greyed out. |
| `humanize.*` (quiet hours, target ratio, article counts) | Human-imitation / anti-detection scheduling (decision D1). |
| `experimental.edgeBrowsing` | Reports browsing that did not happen (see above). |
| `errorDiagnostics`, `consoleLogFilter` | Phase 11 / 12 (logs and diagnostics). |
| `webhook.*` (tokens, URLs, chat IDs) | Secret fields: Phase 10, see the last section. The `enabled` switch of the four supported channels is handled by the notification service (Phase 16, see "Notifications (Phase 16)" below). The Notifications page (Phase 17) shows them; the message title and the log filter are NOT editable in this app (see "Notifications (Phase 17)" below). |
| `searchSettings.chinaApi.appkey` | Secret: Phase 10, see the last section. |
| `sessionPath` | Not a user setting here. |

## Screenshot controls of screenshots 5-7 and what happened to them

| Control | Result |
| --- | --- |
| Delay after search | Greyed out: the engine uses a minimum and a maximum, see "Between searches" |
| Delay after task, Cooldown mode | Greyed out: no engine setting |
| Search count method, Search words setting | Greyed out: no engine setting (the sources and the bonus limit are above) |
| Open search results | Greyed out: declined (rule 9, see table above) |
| Probability of typo | Not built (decision D1) |
| Timezone, Latitude, Longitude | Not built (decision D1); the engine has no such setting |
| Point target, Gift card URL, OpenRouter API key | Greyed out: no engine setting |

# Phase 10: secrets and API keys

These fields are secret. The app saves them in the engine `config.json` (the only place the bot reads them from),
never shows a saved value again, and never writes a value to a log. Where: Settings, card "Secrets & API keys".

| Field on screen | config.json path | Format checked by the app | Engine GET /config hides it |
| --- | --- | --- | --- |
| Discord webhook URL | `webhook.discord.url` | `https://discord.com/api/webhooks/<id>/<token>` (also discordapp, ptb, canary) | yes |
| ntfy server URL | `webhook.ntfy.url` | http(s) address, no user name or password inside | yes |
| ntfy access token | `webhook.ntfy.token` | 8 to 200 characters, no spaces | yes |
| Telegram bot token | `webhook.telegram.botToken` | `123456789:AA...` | yes |
| Telegram chat ID | `webhook.telegram.chatId` | number (may start with -) or `@channelname` | yes |
| PushPlus token | `webhook.pushplus.token` | 8 to 200 characters, no spaces | **no** |
| ServerChan SendKey | `webhook.serverchan.sendKey` | 8 to 200 characters, no spaces | **no** |
| China search API appkey | `searchSettings.chinaApi.appkey` | 4 to 200 characters, no spaces | **no** |

All: at most 512 characters, no line breaks. Apply from the next run. Edits are refused while a run is active.

## Why not the Windows credential store

The bot (engine) reads these values only from `config.json`. It has no environment or credential-store input for them
(`CONFIG_*` environment overrides exist only for the CLI helper and the manual login script, not for the bot). A second
store would only be a copy, so it would add a place for secrets to leak and protect nothing. Instead the one real file
is protected:

- Write-only. The screen gets "Saved" or "Not set" only. There is no reveal button and no copy button.
- Windows user only. `config.json`, the folder of its backup copies and every backup copy are limited to the current
  user (POSIX: mode 600 / 700; Windows: `icacls` with inheritance removed). Account backups the same way.
- Every value is registered in the log redactor before it is sent to the engine, so an error text that repeats it is
  masked. Telegram bot tokens inside API addresses (`.../bot<token>/...`) are masked too.
- A backup copy of `config.json` is made before each change. If the backup fails, nothing is changed.
- The change goes through the engine's own validated `PATCH /config`. The value is then checked in the file itself,
  because the engine hides some secrets in its own read-back.
- The engine's `GET /config` does NOT hide the PushPlus token, the ServerChan SendKey or the China appkey. The app reads
  that answer in the main process only and passes on set / not set. Do not send the config response to the screen.

## Not covered (known limits)

- Account passwords and TOTP secrets are in the accounts `.env` file (Phase 7). They are not on this card.
- Values pasted in this card stay in the typed field until Save succeeds or the page is left.
- The ClawBot `authFile` is a path, not a secret. It is not built (needs a QR login that this app does not offer).
- Anyone who can read your Windows user files can read `config.json`. Disk encryption (BitLocker) is the protection for that.

## Notifications (Phase 16)

Service. The settings screen and the "Send test message" button are described in "Notifications (Phase 17)" below.

Channels the engine really delivers at the pinned commit (`ENGINE_PIN`): Discord, ntfy, Telegram (live log lines while a
run is going) and PushPlus (one summary when a run ends). The addresses and tokens are the Phase 10 secret fields.
ServerChan is listed but not offered: the engine's config check has no entry for it, so the engine drops that part of
`config.json` when it loads it. WeChat ClawBot is listed but not offered: it needs a QR login on the phone that the
engine starts itself.

| Action | What happens |
| --- | --- |
| Read state | Reads `config.json` only. No network request. Gives on / off / ready-off / misconfigured / not-set-up and plain problem text. Never an address or token. |
| Switch on / off | Only the `enabled` flag, through the engine's own `PATCH /config`. Backup copy first. Read back from the file afterwards. Refused while a run is active. Switching ON an incomplete channel is refused. Switching OFF always works. |
| Send test | Only when the user asks. One fixed message. Needs the saved values to be complete and valid, otherwise NO request is made. 10 second time limit. Same channel again within 5 seconds, or while one test is still running, is refused with no request. |

Test outcomes: `sent`, `not-configured`, `misconfigured`, `permission-denied`, `too-soon`, `offline`, `unreachable`,
`timeout`, `rejected`, `failed`. Telegram and PushPlus answer HTTP 200 even when they refuse, so their answer body is
checked too. Redirects are not followed. No message is sent at start-up, on a timer, or by the engine because of this
service.

## Notifications (Phase 17)

Page: sidebar item **Notifications** (right after Secrets & API keys). It is the screen for the Phase 16 service. Nothing
is sent when the page opens: it only reads `config.json`.

| Control | What it really does |
| --- | --- |
| Switch "Send <channel> notifications during runs" | Calls the Phase 16 service `setEnabled`: writes only `webhook.<channel>.enabled` through the engine `PATCH /config`, backup first, read back from the file. Saved at once. |
| Button "Send test message to <channel>" | Calls the Phase 16 service `sendTest`: one real request with a fixed plain-text message. The result (title, the exact service text, and whether a request was started) stays on the card until the next test. |
| Button "Check again" / "Try again" | Reads the state again. Sends nothing. |
| Link "Open Secrets & API keys" | Opens the page where addresses and tokens are saved. They are never shown on the Notifications page. |

Disabled controls always say why: channel not set up (first missing field), engine not ready, run active, a change or
test still going out. ServerChan and WeChat ClawBot are listed under "Not available" with a disabled switch and the reason.

Page states: `config.json` missing, permission denied, not valid JSON, unreadable, state could not be read at all
(Try again), and an "offline" hint when the window reports no network (a test is still allowed and reports the real result).

Log filter (checked in the engine source, `Logger.shouldPassFilter`): the engine only limits what Discord, ntfy and
Telegram receive when `webhook.webhookLogFilter.enabled` is `true`. When it is `false` (the example default) the engine
posts EVERY non-debug log line, and those lines can contain account e-mail addresses. The page reads the flag and says
which case you are in. PushPlus sends one run summary and is not affected.

Not built, on purpose: editing the message title and the log filter. The Phase 16 service has no option for them and
a safe edit needs new service code (validated write, backup, read-back). Listed in the Phase 17 report as a user decision.

## Backups (Phase 18 service, Phase 19 check and screen)

Phase 18 built the service. Phase 19 connected it to the **Backups** page (sidebar, after Health) and added the check
after writing. Nothing runs on its own: only the **Create backup** button starts a backup.

**What one backup holds** (folder `<app data>/backups/full/backup-YYYYMMDD-HHMMSS-mmm/`):

| File in the backup | Copy of | Holds secrets |
| --- | --- | --- |
| `engine-config.json` | the engine's `config.json` | yes (webhook tokens, API key) |
| `accounts.env` | the accounts file you chose on Home | yes (passwords, 2FA secrets, proxy logins) |
| `app-settings.json` | the app settings | no |
| `manifest.json` | (written by the service) | no |

Not in a backup: browser sessions, logs, the engine program, `node_modules`. A source that does not exist yet (or no
accounts file chosen) is skipped and the manifest says so. Any OTHER problem reading a source (permission denied, a
folder instead of a file, a file over 20 MB) stops the whole backup, so a gap can never look like a complete backup.

**Manifest** (`manifest.json`, version 1): app version, time, platform, per file the fixed name, size, SHA-256 and
"contains secrets", the skipped list with reasons, total size, and the NUMBER of accounts. It never holds a value, an
e-mail address or a folder path of yours.

**How a backup is made safe**
1. The sources are read once, in memory. The originals are never changed.
2. The backup folder and a hidden `.tmp-...` folder are made private to the current user first, then the files are written.
3. Each file is flushed to disk and read back; its checksum must equal the original's.
4. The manifest is written last and read back through a strict check.
5. One rename turns `.tmp-...` into `backup-...`. If anything fails before that, the temporary folder is removed. If it
   cannot be removed it stays hidden and is counted as "unfinished"; it is never listed or used as a backup.

The backup is NOT encrypted. It is a plain copy in a folder only your Windows account can open. Keep it off shared or
synced folders. Restore comes in Phases 20 and 21.

### Backups (Phase 19): the check, the page and the failure messages

**The check (verification).** One check reads a backup folder as it is on the disk NOW and trusts nothing from memory:
1. `manifest.json` exists, passes the strict parser and carries the same id as the folder name.
2. Every file the manifest lists is present, is a file, has the listed size and the listed SHA-256.
Items in the folder that the manifest does not list are only a note (a restore will use the listed files only).

| When the check runs | What happens on a problem |
| --- | --- |
| Right after a backup got its final name | The backup is reported as FAILED. The folder is renamed to a hidden `.tmp-failed-...` name (never deleted, rule 10), so it can never look like a good backup. If even that rename fails, the page lists it as **Damaged**. |
| Every time the Backups page reads the list (page opens, **Check again**, after **Create backup**) | A backup with a valid manifest but a missing or changed file is listed as **Damaged: do not use**. A folder with no usable manifest is not a backup at all: it is only counted as "unfinished". |
| **Inspect** | Same check, plus the details of that one backup. |

Problem kinds shown to the user (plain words, never a path, never a checksum value): manifest missing / invalid / belongs to
another backup; file missing; not a file any more; size differs; checksum differs ("was changed after the backup was made");
file could not be read (with the reason, for example permission denied).

**Free space.** Before anything is written the service asks the drive how much is free. A backup needs its files plus 1 MB.
Less than that: refused, nothing written, not even the folder. If the free space cannot be read, the backup is not blocked
(a really full disk is still caught while writing).

**Failure messages.** Every failed backup returns the exact reason, a machine reason and a "What to do" text:

| Reason | Typical cause | The page tells the user to |
| --- | --- | --- |
| `low-space`, `disk-full` | free space below the need, or `ENOSPC` while writing | free space, press **Create backup** again, see the Health row "Free disk space" |
| `permission-denied` | `EACCES` / `EPERM` writing the backup folder | close programs that hold the file (sync, antivirus), try again, see Health row "App data folder (read and write)" |
| `read-only` | `EROFS` | check the drive is not write-protected or full |
| `source-unreadable` | one of the user's own files cannot be read | close the program using it, try again (nothing is saved: no silent gap) |
| `source-not-file`, `source-too-large` | a folder or a huge file where a file is expected | check the accounts file chosen on Home |
| `nothing-to-back-up` | no source exists yet | choose the accounts file / press Create config on Home |
| `copy-differs` | a copy did not match its original | try again, try another drive |
| `verify-failed` | the check after writing found a problem | try again; the bad folder was set aside |

A missing file is NOT always a failure: a source that does not exist yet is skipped, the result and the list say so
("Not included: ..."), and the backup is still checked and listed.

**The Backups page** (`#/backups`): intro and a permanent security note (not encrypted, only your Windows account can open
the folder); **Create backup**; **Open backup folder** (main opens the fixed folder, the page sends no path; disabled
until a folder exists); **Check again**; the list (time, app version, number of files, size, status chip, **Inspect**);
the "unfinished or set-aside" count. NOT on the page, on purpose: Restore (Phases 20 and 21), Delete (needs your
approval, rule 10), a different backup folder, encryption.

**Bridge** (`farmerShell`): `getBackupsState()`, `createBackup()`, `inspectBackup(id)`, `openBackupFolder()`. No method takes a
path. `inspectBackup` takes one id that main checks against the strict format `backup-YYYYMMDD-HHMMSS-mmm[-n]` before it
touches the disk (so `..`, slashes, drive letters and `.tmp-` names are refused).

