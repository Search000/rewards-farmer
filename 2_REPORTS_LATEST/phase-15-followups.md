# Phase 15 follow-ups (3 jinis, ar kichu na)

Phase 16 shuru kora hoy ni.

## Ki kora hoyeche
1. START.bat: engine folder adha thakle ekhon dhora porbe. Duto file dekhe: engine\package.json ar engine\scripts\api\server.js. Na thakle Git diye shudhu oi duto file ferot ane. config.json ar accounts ke chhoy na.
2. Health page: "Repair config.json" button (confirm dialog shoho). Broken config.json ke config.broken.json e copy kore rakhe (nam nile config.broken-2.json ...), notun config.json example theke banay, ar purano file er je setting thik chhilo seta rakhe. Code: src/main/configRepair.ts.
3. Accounts file auto-create: app prothom bar chalale userData folder e accounts.env nije banay (account chhara), path ta mone rakhe. Engine tokhon chalu hoy na jotokhon na ekta account lekha hoy. User nijer file choose korle seta kokhono overwrite hoy na.

## Ei session e ja pashapashi thik kora holo
- Ager session er START.bat edit e bug chhilo: notun subroutine (:check_engine_files) vul jaygay (step 3 er bhitore) boshe giyechhilo. Thik jaygay (:check_app er age) boshiyechi. CRLF thik ache.

## Test: kora jay ni
- Ei session e node_modules nai, internet nai, tai tsc/eslint/vitest/build chalano jay ni. Shudhu syntax check (tsc, parse-only) kora hoyeche: kono syntax error nai.
- Notun test file ache (tests/main/configRepair.test.ts, tests/main/accountsAuto.test.ts) kintu ei session e chalano hoy ni.
- Windows e START.bat chalano hoy ni.
- docs/troubleshooting.md ar guide.ts e Repair button / accounts.env er kotha jora hoy ni (guide er test prottek quote real run chay, ami run korte pari ni).

## Tomar kaj (Windows e)
TEST.bat chalao. Fail korle log pathiye dao, ami thik kore dibo.

## TEST.bat on Windows (user run, 2026-10-14)
- typecheck, lint: clean.
- prettier: 6 files need formatting (configRepair.ts, farmer.ts, HealthPage.tsx, accountsAuto.test.ts, configRepair.test.ts, helpers.ts). Fix: `npx prettier --write src tests`.
- vitest: 489 pass, 1 fail, 7 skip. The failing test (diagnostics "REAL permission denied") needs POSIX chmod; on Windows chmod does not block writes. Now skipped on win32 (same as the test in health-system.test.ts).
- 2 test workers crashed with exit code 3221226505 (accounts.integration, secrets.integration). Not diagnosed yet: needs logs from a Windows run.

## Follow-up session 2 (docs + format launcher)
Phase 16 shuru kora hoy ni.

### Ki kora holo
- docs/troubleshooting.md: "config.json content" section e ekhon age "Repair config.json" button er step (confirm, config.broken.json copy, setting rakha). Fix check: VERIFIED (real) -> tests/main/troubleshooting.fixes.test.ts "[config-valid] Repair config.json". Window e button chapa: NOT TESTED.
- docs/troubleshooting.md: "Accounts file" ar "Engine process" section e accounts.env auto-create er kotha. Fix check: VERIFIED (real) -> tests/main/accountsAuto.test.ts (first start test).
- docs/troubleshooting.md: "Engine files" e START.bat er notun check (engine\package.json + engine\scripts\api\server.js) lekha. Known gaps 1 ar 4 update (Windows e run hoy ni: NOT TESTED).
- tests/main/troubleshooting.fixes.test.ts: guide check ekhon accountsAuto.test.ts o dekhe (karon guide ta oi test er naam dey). Chalano hoy ni.
- FORMAT.bat (notun, double-click): `prettier --write src tests` chalay, logs\format.log e likhe, SUCCESS/FAILED dekhay, pause kore. Windows e test hoy ni.

### Test: kora jay ni (ei session e node_modules ar internet nai)
- Doc badlano guide test er sathe milche kina Windows e TEST.bat chalale jani jabe.
- Prettier chalano jay ni. Tumi FORMAT.bat chalao, tarpor TEST.bat.

### Ekhono baki
- accounts.integration / secrets.integration worker crash (exit code 3221226505): log chhara bujha jay na. Tumi `npx vitest run tests/main/accounts.integration.test.ts` er output dao, ba amake bolo ami ek-ta CRASHLOG.bat banai.
- GitHub (chiihero/Microsoft-Rewards-Script) ei session e khola jay ni (network bondho). Engine ager pinned commit (ENGINE_PIN) e ache, kono upstream change ane ni.
