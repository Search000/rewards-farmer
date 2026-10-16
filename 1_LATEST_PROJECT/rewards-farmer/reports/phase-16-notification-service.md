# Phase 16: Notification service (backend only)

Verdict: DONE for the service. Windows run: NOT TESTED (done on Linux, Node 24.21.0). The settings screen and the "Send test" button are Phase 17.

## What was built
- `src/shared/notifications-types.ts`, `src/shared/notifications-rules.ts`, `src/main/notifications.ts`.
- Wiring: `src/main/main.ts`, `src/main/ipc.ts`, `src/preload/preload.ts`, `src/shared/ipc-types.ts` (3 IPC calls: get state, set enabled, send test).
- Channels the engine really delivers at `ENGINE_PIN`: Discord, ntfy, Telegram (live), PushPlus (summary).
- Listed but NOT offered: ServerChan (engine drops it on load), WeChat ClawBot (needs QR login).
- Addresses and tokens stay in the Phase 10 secret fields. The screen only ever gets on / off / problem text.
- Docs: new section "Notifications (Phase 16)" in `docs/configuration-reference.md`.

## Rules checked by tests
- Reading state makes no request. Nothing is sent at start-up or on a timer.
- Test message only on request; incomplete or invalid setup means NO request.
- Switch on/off: only the `enabled` flag via the engine `PATCH /config`, backup first, read back from the file, refused during a run, ON refused for an incomplete channel.
- Failure cases at service level: offline, unreachable, timeout, rejected (HTTP errors, Telegram `ok:false`, PushPlus wrong token with HTTP 200), permission denied, missing or invalid config.json, engine not ready.
- Secrets never appear in results, audit log or app log, even when an error text quotes them.
- 5 second limit per channel, also for failed tests.

## Bug found and fixed in this phase
Two tests started together both passed the 5 second guard and sent two requests. The channel is now claimed before any `await` (`sendTest` -> `runTest`). Test: "two tests started together send only one request".

## Commands really run (Linux, Node 24.21.0 from npm package `node@24`)
- `npx tsc --noEmit`: exit 0.
- `npx eslint .`: exit 0.
- `vitest`: tests/notifications-rules.test.ts 27 pass; tests/main/notifications.test.ts 33 pass, 1 skip (POSIX permission test). All other `tests/main/*` files pass one by one (accounts.integration 28, accountsAuto 5, configRepair 8, diagnostics 35+1 skip, engineSettings 19, envEdit 39, farmer.integration 25, health-system 18+1 skip, health.integration 2, health 27, logService 17, logs.integration 2, secrets.integration 14, shutdown 5, sse 5, stale-engine 4, troubleshooting.fixes 22, units 28+1 skip, zipWriter 4). `tests/*.test.ts` and `tests/renderer`: all pass except two files that need `engine/node_modules`; after `npm --prefix engine ci --ignore-scripts` both pass (22 tests).
- Not run as one single `vitest run`: it exceeded the sandbox time limit, so files were run in groups.
- On Node 22 many `tests/main` integration tests fail with "Node.js 24+ needed (version 22 found)". Not a Phase 16 problem.

## Known gaps
- Windows: `TEST.bat` not run on Windows. The earlier Windows worker crash (exit 3221226505, accounts.integration / secrets.integration) is still undiagnosed. Both pass here on Linux.
- Prettier flags 7 older files (Phase 15 follow-up files). Run `FORMAT.bat`. Phase 16 files are formatted.
- No real message was sent to Discord, ntfy, Telegram or PushPlus. All sending was tested with a recording stand-in for the network.
- Phase 17 not started.
