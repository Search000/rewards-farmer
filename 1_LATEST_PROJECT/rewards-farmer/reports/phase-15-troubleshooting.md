# Phase 15 report: troubleshooting guide

1. **Phase and date:** Phase 15, 2026-10-14. Started after the user wrote "continue Phase 15 from where it stopped, do not do any other phase". Phase 16 is NOT started.

2. **Objective:** Give the user a real troubleshooting guide based on failures that were actually observed, link every Health-page failure message to its matching section, and check every documented fix (really tried, or marked `NOT TESTED`).

3. **Files inspected and how the code was recovered:** the master prompt (Phase 15 section and rules), the Phase 14 project ZIP (`rewards-farmer-MASTER-phase14.zip`), and the session transcript (`New_Text_Document.txt`). The Phase 14 ZIP held **no Phase 15 work** (it was lost with the earlier session, which stopped before the tests, the report and the ZIP). The files that the transcript recorded in full (the guide, the parser, the dialog, the Health page edit, the five fix-text changes, the two new test files) were put back exactly as recorded. The real-evidence script was run again on this machine (section 7). Nothing was invented that the transcript did not describe, except what is listed under "found and fixed in this session" below.

4. **Files created/modified:**
   - New: `docs/troubleshooting.md` (19 sections: 16 Health-row sections, "Rows that say Unknown", 2 launcher problems seen on the user's PC; plus "How to read each section" and "Known gaps"), `src/shared/troubleshooting-rules.ts` (guide parser, `guideIdFor`, `findSection`), `src/renderer/guide.ts` (reads the guide file at build time), `src/renderer/components/GuideDialog.tsx`, `tests/main/troubleshooting.fixes.test.ts` (21 tests), `tests/renderer/troubleshooting.test.tsx` (4 tests), `scripts/capture-guide-15.mjs`, `reports/phase-15-evidence.txt`, `reports/phase-15-screenshots/`.
   - Changed: `src/main/healthService.ts` (5 "What to do" texts replaced, see section 5), `src/renderer/pages/HealthPage.tsx` ("Open guide" button on warning, error and unknown rows), `tests/main/health.test.ts` (2 assertions follow the new texts), `tests/no-typed-commands.test.ts` (also scans the guide, rule 27), `docs/feature-support-matrix.md` (1 row).
   - No other phase changed. `START.bat` and `TEST.bat` were NOT changed.

5. **Implementation summary:**
   - **The guide** has, per section: "You see" (the exact app text), "What to do" (clicks only, no typed commands), "Evidence" (`OBSERVED ON YOUR PC`, `OBSERVED HERE` or `REPRODUCED IN TESTS`), "Fix check" (`VERIFIED (real)`, `VERIFIED (real run)`, `VERIFIED (stand-in)` or `NOT TESTED` with the reason). Count of fix-check labels: 12 `VERIFIED (real)`, 5 `VERIFIED (real run)`, 13 `VERIFIED (stand-in)`, 23 `NOT TESTED` lines (mostly Windows).
   - **In-app links:** every Health row that is a warning, an error or unknown gets an "Open guide" button (`aria-label` "Open guide for <row>"). It opens a window with that section. The text comes from `docs/troubleshooting.md` (imported with `?raw`), so the page and the file cannot disagree. Rows that are OK have no button.
   - **Found by really trying the old advice, and fixed (5 texts in `healthService.ts`):** the Health page used to say "press Reset to defaults" for a broken `config.json`. With a broken file the Settings page is read-only and Reset fails (`config.json is invalid`). With a wrong value Reset fails with the same message as the row. For a missing setting the page said "press Save", but Save says "Nothing to change" and does not write it. The new texts are the paths that were really verified: rename `config.json` to `config.broken.json` and press "Create config" on Home; correct one value in Notepad; or leave a missing setting alone (the engine uses its default).
   - **Found and fixed in this session (real Electron window, not in the transcript):** the guide window showed raw Markdown characters (`**Home**`, backticks). `GuideDialog.tsx` now shows bold and code properly (`renderInline`). New test: no `**` or backtick in the dialog text. Screenshot before/after was taken from the real window.
   - **Known gaps** are written at the end of the guide (section "Known gaps", 5 items). They are NOT fixed in this phase.

6. **Commands actually run** (sandbox: Linux, Node v24.21.0 from the `node` npm package, runs as root):
   - `npm ci`, `npm --prefix engine ci --replace-registry-host=always --ignore-scripts`, `npm --prefix engine run build`, `npx tsc --noEmit`, `eslint .`, `prettier --check .`, `vitest run`, `npm run build`.
   - `/tmp/evidence.cjs` (real health service, real `node -v`, real DNS probe, real folders, real `npm ci`, real `npm run build`, real `git submodule update --init`), output saved in `reports/phase-15-evidence.txt`.
   - `node scripts/capture-guide-15.mjs reports/phase-15-screenshots` (REAL Electron window under Xvfb, built `dist/`).
   - `START.bat` and `TEST.bat`: **NOT TESTED** (no Windows here). Not changed.

7. **Test evidence (final run, exit code 0 for all):**
   - `tsc` 0 errors, `eslint` 0 problems, `prettier --check` "All matched files use Prettier code style!", `npm run build` ok.
   - `vitest run`: **Test Files 40 passed (40), Tests 496 passed, 3 skipped (499), exit 0.** Before this phase: 38 files / 470 passed / 3 skipped. New: **26 tests** (21 real fix tests, 4 renderer tests, 1 typed-command guard). The 3 skips are the root-only skips from Phases 13 and 14.
   - **Real fix tests (`tests/main/troubleshooting.fixes.test.ts`):** real app services and the real engine API. Each one makes the failure, shows the row, does the documented fix, and shows the row turn OK. Includes the proof that the OLD advice fails: "Reset to defaults" on a broken file, "Reset" with a wrong value, "Save" alone for a missing setting. One test checks that every message quoted in the guide appears in a real test run or in the evidence file, and that every `VERIFIED` line names a real test or evidence id.
   - **Real evidence run (`reports/phase-15-evidence.txt`, run again here):**
     ```
     E1 node (real command): [ok] Node.js 24.21.0
     E2 network (real probe): [error] The name rewards.bing.com could not be looked up (ENOTFOUND)...
     E3a/E3c folder-data missing / file in the way: [error] The app data folder does not exist: ...
     E4a/E4b before: [error] engine packages not installed / engine not built
     E4c/E4d after real npm ci (4296 ms) and real npm run build (7563 ms): [ok] [ok]
     E5b config-valid broken file: [error] config.json is not valid JSON. || FIX: ... rename config.json to config.broken.json ...
     E6a engine folder missing: [error] -> git submodule update --init -> E6b [ok]  (pinned commit e0c15a6)
     E7 Node 22.22.2: [error] too old ... -> Node 24.21.0 first on PATH: [ok]
     ```
   - **Real Electron window:** Health page showed 8 "Open guide" buttons (Engine config.json, config.json content, Accounts file, Engine process, Engine API answers, Engine reads its config, Engine version, Internet connection). The first one opened the matching section. **0 console problems.** Screenshots (wide, and 800 px narrow) and `evidence.json` in `reports/phase-15-screenshots/`.

8. **Acceptance check:**
   - "Guide matches failures actually observed; no invented failure modes": every section carries an Evidence label. Four sections are only `REPRODUCED IN TESTS` (Git, Engine API answers, Engine folder rows, Free disk space) and say so. Two sections are from the user's own Windows PC (earlier phase reports).
   - "No untested fixes presented as verified": every fix step is labelled. Where a fix was not tried, the line says `NOT TESTED` with the reason. A test checks that each `VERIFIED` label names a real test or evidence id.
   - "Link each health-panel failure message to its matching guide section": proven by the renderer test (every Health row except "app" has a section, and "unknown" has one) and by the real window (8 buttons, one opened).

9. **Known gaps:**
   - **Windows not tested:** `START.bat`, `TEST.bat`, installing Node.js and Git, Windows permissions, file locks, the Windows file dialog.
   - `START.bat` downloads the engine only when `engine\package.json` is missing. If only the API script is missing, the "Engine files" fix cannot be done with `START.bat`. Found by reading, not run. Not changed (needs a Windows test).
   - No "Repair" button for a broken `config.json`; only rename + Create config. Would be a new feature.
   - The folder rows say "does not exist" when a file has the same name (message is not wrong, but does not mention the file).
   - The Settings page does not name which setting is missing, and Save alone does not write it.
   - A real permission-denied folder, a real full drive and a real VPN or firewall change cannot be made on this machine (root, fixed network): those fixes are `NOT TESTED`.
   - Evidence timings and folder names in `phase-15-evidence.txt` come from the run on this machine today; the earlier session's run was lost, so this is a new run, not a copy.

10. **Security/data impact:** No user file is changed. The guide window only shows text from the guide file; it takes no input and runs nothing. No new IPC channel, no network call from the app. The evidence script ran in temporary folders and a temporary copy of the engine; it created no `config.json`, `.env` or account data in the project. No secrets appear in the guide, the evidence file or the screenshots.

11. **Verdict:** **PASS**, with the Windows items and the real-permission, real-full-disk and VPN items marked `NOT TESTED` above.

## Questions for you (decisions, not done without your answer)
- `START.bat` and an incomplete engine folder (known gap 1): do you want it changed so it also checks the API script? It needs a Windows test, which I cannot do.
- Do you want a "Repair" button for a broken `config.json` that keeps your settings? That is a new feature, outside Phase 15.

Phase 16 is NOT started. Say `NEXT PHASE` to continue.
