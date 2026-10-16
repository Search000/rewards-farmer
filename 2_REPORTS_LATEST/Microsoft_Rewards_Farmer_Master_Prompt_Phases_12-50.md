# MASTER BUILD PROMPT — Microsoft Rewards Farmer Desktop App
## 39-Phase (Phase 12 to Phase 50), Approval-Gated, Screenshot-Driven, Real Upstream Integration

**Project:** Microsoft Rewards Farmer desktop application  
**Upstream repository:** https://github.com/chiihero/Microsoft-Rewards-Script  
**Branches to compare:** `main` and `V4-china`  
**Primary platform:** Windows desktop  
**Reference material:** the user's supplied ZIP containing seven screenshots  
**Starting point:** This prompt begins at **Phase 12**. Phases 1–11 are treated as already completed by the user and must NOT be redone. Do not scaffold or rebuild anything from Phases 1–11; inspect the existing project and continue from it.  
**Working rule:** finish and verify one phase, produce its report, then STOP. Never start the next phase unless the user explicitly says `NEXT PHASE` or otherwise clearly authorizes it.

---

# A. Mission

Build a real Windows desktop app whose UI closely matches the seven supplied reference screenshots and whose functionality is connected to the actual supported features of `chiihero/Microsoft-Rewards-Script`.

The app must use real configuration, real processes, real logs, and actual upstream-supported behavior. It must not be a static mockup or a fake demo. If the upstream repository does not support a screenshot feature, do not simulate it. Record the gap and either implement a legitimate integration or mark the feature unavailable until the user approves a real implementation.

This prompt is a work specification, not proof that the app has been built. The coding agent must inspect source, edit files, run commands, and report actual observed results.

# B. Absolute rules — apply to all phases (12–50)

1. **Strict phase gate:** Work on exactly one phase at a time. Do not begin implementation for later phases while a current phase is in progress.
2. **No automatic phase advancement:** At the end of every phase, write the report, list test evidence and unresolved issues, then STOP. Do not start the next phase unless the user explicitly says `NEXT PHASE`.
3. **No fake functionality:** No mock backend in the shipped app, fake accounts, fake points, fabricated logs, simulated run states, dummy buttons, or false success messages.
4. **No unverified claims:** Never claim that a command, test, build, feature, update, or screenshot comparison passed unless it was actually run and its result was observed.
5. **Real upstream integration:** Read the source code and map every control to a real supported function, documented endpoint, or validated config field. Do not invent API routes.
6. **Screenshot evidence:** Inspect all seven original images at full resolution. Record which screenshot defines each page. Do not substitute illustrative internet images.
7. **Honest gaps:** If a feature cannot be supported safely or the upstream has no corresponding implementation, explain it and stop for a user decision; do not create a visual fake.
8. **Security:** Never expose passwords, cookies, session tokens, API keys, authorization headers, or secrets in UI logs, app logs, screenshots, reports, or Git.
9. **No protection evasion:** Do not implement CAPTCHA bypass, stealth or fingerprint spoofing, anti-bot evasion, rate-limit circumvention, or methods intended to defeat Microsoft Rewards protections. Do not promise accounts will never be restricted.
10. **User data safety:** Never delete or overwrite `.env`, accounts, sessions, configuration, logs, or local databases without an explicit backup and user approval.
11. **Safe upstream updates:** Check for updates automatically if configured, but do not blindly run latest code. Default to notify/check automatically and require user approval to install a validated update.
12. **No destructive commands without consent:** Explain commands that delete data, reset Git state, alter machine policy, install global packages, or change system settings before executing them.
13. **License compliance:** Inspect the repository license and preserve required notices. Do not assume that a license permits every form of redistribution.
14. **Maintainability:** Use typed interfaces, clear module boundaries, useful error handling, tests, reproducible builds, and documented configuration.
15. **Windows-first instructions:** Provide commands for the user's actual shell. Do not mix PowerShell and CMD syntax without labeling each.
16. **Do not demand secrets in chat:** Instruct the user to enter credentials locally and never ask them to paste passwords, cookies, or API keys into the conversation.
17. **No unsupported UI controls:** Every enabled button, toggle, dropdown, field, and menu item must perform a real action. Otherwise, disable it and explain why.
18. **Production/test separation:** Test fixtures may be used only in isolated automated tests and must never appear in the real account store.
19. **No phase skipping:** If a phase fails, fix the failure within that phase or document the blocker. Do not move on to hide it.
20. **Evidence-first reporting:** Reports must identify files inspected/changed, commands run, actual outputs, test results, known gaps, and a phase verdict.
21. **One approval per phase:** An approval for one phase does not authorize any later phase.
22. **Keep the upstream relationship clear:** Distinguish upstream repository, local working tree, and any personal fork. Never silently overwrite the upstream or push changes without explicit authorization.
23. **One-click launchers (user cannot use CMD):** The user will NOT type CMD/PowerShell commands and cannot remember them. Every action the user needs must be a double-clickable `.bat` file in the project root. Minimum set: `START.bat` (starts the app, installing project-local dependencies on first run if missing), `TEST.bat` (runs lint, type-check and all automated tests, then shows a clear PASS/FAIL summary), and `BUILD.bat` (from Phase 46). Later phases may add more (for example `UPDATE.bat`, `BACKUP.bat`) only when the matching feature exists.
24. **Launcher quality rules:** Each `.bat` must: (a) work when double-clicked from any location by switching to its own folder (`cd /d "%~dp0"`); (b) check that required tools (Node, Git, etc.) exist and, if missing, show a plain-language message with the exact download link instead of failing silently; (c) never install anything globally, change system policy, or delete user data without a clear on-screen prompt and user confirmation; (d) write its output to a log file in `logs/` with secrets redacted; (e) end with `pause` so the window never closes before the user reads the result; (f) show a clear final line: `SUCCESS` or `FAILED` plus the reason and the log file path; (g) never contain passwords, tokens or cookies.
25. **Launchers must be tested:** Whenever a phase adds or changes behavior, update `START.bat` and `TEST.bat` so they still work, actually run them, and record the real output in the phase report. Never claim a launcher works without running it. If the environment cannot run `.bat` files (for example no Windows), write `NOT TESTED` and state why.
26. **Final deliverable is one full ZIP:** At the end of Phase 50, deliver a single complete new ZIP file that contains everything from all phases combined (source, launchers, docs, all reports, screenshots, installer/portable build if generated, checksums). Never include secrets, sessions, `.env`, real account data, `node_modules` or other regenerable build junk unless the user asks. Interim ZIPs per phase are optional; the Phase 50 ZIP is mandatory.
27. **Plain-language instructions:** Explain every user step in simple language with exact file names to double-click. Do not tell the user to type commands; if a command is truly unavoidable, wrap it in a `.bat` file instead.

---

# C. Required first response

Start at **Phase 12 only**. Phases 1–11 are assumed done by the user; do not redo them.

1. Inspect the existing project state (source tree, config, launchers `START.bat` / `TEST.bat`, existing reports, the upstream checkout and the seven reference screenshots if they are present).
2. If the existing project or anything Phase 12 depends on is missing or broken, state exactly what is missing and STOP. Do not rebuild earlier phases and do not invent their results.
3. Otherwise complete Phase 12 only, write its report, and stop.
4. At the end, stop and ask the user to approve Phase 13.

# D. What can be added — feature backlog to evaluate, not blindly promise

Evaluate each item against the screenshots and upstream code (the feature map from the earlier phases already exists; reuse it and do not redo it). Do not add every item automatically. Label each as:
- **Required by screenshot**
- **Supported upstream**
- **Needs new implementation**
- **Not appropriate / unsafe**
- **Needs user decision**

Possible additions:
- Screenshot-faithful dark theme and layout
- Sidebar navigation and app-level status
- Account list, import/add/remove, status, and per-account details if supported
- Account directory/path selection
- Real start/stop/restart lifecycle
- Actual task settings mapped to upstream config
- Search and task progress only where supported
- Actual logs, filtering, timestamps, export, and secret redaction
- Actual points/status retrieved from the supported engine, with "unknown" shown when unavailable
- Configuration validation, save, reset, import/export and migration
- Proxy configuration only if genuinely supported and used lawfully; no evasion logic
- Language and browser settings only where implemented upstream
- API token management with secure local handling
- Notifications only if supported and explicitly configured by the user
- Health/status panel and error diagnostics
- Safe backup and restore
- First-run setup wizard
- Help, About, version, license notices, privacy/security page
- Update checker with branch/commit information
- Update review, tests, backup, installation, rollback
- Windows installer or portable package
- Keyboard navigation and accessibility
- Responsive resizing and high-DPI support
- Crash recovery and safe shutdown
- Offline/error states
- Test suite, security checklist, release checklist
- One-click `.bat` launchers (`START.bat`, `TEST.bat`, `BUILD.bat`) with log files and clear SUCCESS/FAILED output
- Single full ZIP handover containing all phases' work
- Optional auto-start with Windows only after explicit opt-in
- Optional local-only API only when necessary and protected

Do not add cloud sync, remote control, telemetry, analytics, automatic credential harvesting, account selling, or public API exposure unless there is a clear, safe, user-approved design and legal basis. Default to no telemetry and local-only data.

# E. Thirty-nine phases (12–50) — do not proceed without explicit approval

## PHASE 12 — Health panel: runtime, config and engine checks

### Goals
Show the user the real state of the runtime, configuration and engine.

### Tasks
- Build the health panel UI shell and check framework (one real check per row, with status, detail and timestamp).
- Implement real checks for runtime versions (Node, Git, app), configuration validity and engine reachability.
- Every failed check must show an actionable, plain-language message.
- Test misconfiguration and engine-unreachable states.

### Deliverables
- Health panel UI with runtime/config/engine checks
- Tests and `reports/phase-12-health-runtime-config-engine.md`

### Acceptance
Checks reflect real state, not static values; every failed check shows an actionable message.

### Stop
Report and STOP.

## PHASE 13 — Health panel: disk, permissions and offline states

### Goals
Complete the health panel with environment and resource checks.

### Tasks
- Add real checks for free disk space, folder read/write permissions and network/offline state.
- Add a manual "re-run checks" action and safe automatic re-check on relevant events.
- Test low-disk, permission-denied and offline states with isolated test fixtures only.

### Deliverables
- Extended health checks
- Tests and `reports/phase-13-health-disk-permissions-offline.md`

### Acceptance
Disk, permission and offline failures are detected from real state and shown with actionable messages.

### Stop
Report and STOP.

## PHASE 14 — Diagnostics bundle export

### Goals
Let the user export safe, redacted diagnostic information.

### Tasks
- Implement a diagnostics bundle export (versions, redacted config, health results, redacted recent logs).
- Verify the bundle contains no secrets, sessions, tokens, cookies or real account data.
- Test export with missing files, very large logs and permission-denied destinations.

### Deliverables
- Diagnostics bundle export (UI and service)
- Tests and `reports/phase-14-diagnostics-bundle.md`

### Acceptance
Exported bundle contains no secrets; export fails gracefully with a clear message in every error case.

### Stop
Report and STOP.

## PHASE 15 — Troubleshooting guide

### Goals
Give the user a real troubleshooting guide based on observed behavior.

### Tasks
- Write `docs/troubleshooting.md` from real observed failure modes only.
- Link each health-panel failure message to its matching guide section.
- Verify every documented fix step actually resolves the failure it describes, or mark it `NOT TESTED`.

### Deliverables
- `docs/troubleshooting.md`
- In-app links to the guide
- Tests and `reports/phase-15-troubleshooting.md`

### Acceptance
Guide matches failures actually observed; no invented failure modes or untested fixes presented as verified.

### Stop
Report and STOP.

## PHASE 16 — Notifications: service

### Goals
Build the notification backend; notify only when the user asks for it.

### Tasks
- Implement the notification service only for channels supported by the platform/upstream.
- Never send notifications or external requests unless explicitly configured by the user.
- Store any notification credentials/webhooks per the Phase 10 secret-handling rules.
- Test failure, permission-denied, misconfiguration and offline behavior at service level.

### Deliverables
- Notification service
- Tests and `reports/phase-16-notification-service.md`

### Acceptance
Notifications fire only when configured; no external request is made while notifications are unconfigured.

### Stop
Report and STOP.

## PHASE 17 — Notifications: settings UI and test action

### Goals
Let the user configure notifications and verify them.

### Tasks
- Build the notification settings UI mapped to real service options.
- Add a real test-notification action that reports the actual result (success or exact failure reason).
- Show clear states for permission denied, misconfiguration and offline.
- Disable and explain any control the service cannot support.

### Deliverables
- Notification settings UI
- Tests and `reports/phase-17-notification-ui.md`

### Acceptance
Settings persist; the test action reports the real outcome; all failure states are visible and understandable.

### Stop
Report and STOP.

## PHASE 18 — Backup: service and manifest

### Goals
Build the backup service that creates safe backups of user data.

### Tasks
- Implement backup of config, accounts metadata and settings (secrets handled per Phase 10 rules).
- Write a backup manifest with app version, timestamp and checksums.
- Write each backup to a temporary location and move it into place only when complete, so a half-written backup never looks valid.

### Deliverables
- Backup service
- Tests and `reports/phase-18-backup-service.md`

### Acceptance
A backup is created with a manifest and checksums; an incomplete backup is never presented as valid.

### Stop
Report and STOP.

## PHASE 19 — Backup: verification, UI and failure tests

### Goals
Verify backups after writing and give the user a real backup screen.

### Tasks
- Verify each backup after writing it (manifest, checksums, file presence).
- Build the backup UI: create, list and inspect backups (version, timestamp, size).
- Test missing-file, permission-denied and low-disk cases during backup and show clear, actionable messages.

### Deliverables
- Backup verification and UI
- Tests and `reports/phase-19-backup-verify-ui.md`

### Acceptance
Every backup is verified after writing; failures never leave a half-written backup that looks valid and are shown with clear messages.

### Stop
Report and STOP.

## PHASE 20 — Restore: verification and pre-restore safety

### Goals
Make sure a restore can never start from a bad backup and never starts without a safety net.

### Tasks
- Verify the backup (manifest, checksums, version compatibility) before any restore begins.
- Create a pre-restore snapshot of the current state to be used for undo.
- Build the restore UI up to the confirmation step, with a clear preview of what will change.
- Test corrupted-backup, wrong-version and missing-file cases: each must be rejected before anything is changed.

### Deliverables
- Restore verification service and UI preview
- Tests and `reports/phase-20-restore-verification.md`

### Acceptance
A corrupted or incompatible backup is rejected before anything is changed; the pre-restore snapshot exists before any change.

### Stop
Report and STOP.

## PHASE 21 — Restore: execution, undo and round-trip

### Goals
Restore user data safely from a verified backup and allow undo.

### Tasks
- Require explicit confirmation for the destructive step.
- Apply the restore and keep the pre-restore state; implement undo from that state.
- Test an interrupted (partial) restore and verify the app ends in a recoverable state.
- Test a full backup → change → restore round trip.

### Deliverables
- Restore execution and undo
- Tests and `reports/phase-21-restore-execute-undo.md`

### Acceptance
Backup/restore round-trips without data loss; an interrupted restore leaves a recoverable state; undo works.

### Stop
Report and STOP.

## PHASE 22 — First-run setup wizard: flow

### Goals
Guide a new user to a working configuration safely.

### Tasks
- Implement the first-run wizard steps (prerequisites, accounts location, basic settings, review).
- Never ask for secrets in chat; write only validated, real config.
- Test the happy path and invalid-input handling at every step.

### Deliverables
- First-run wizard flow
- Tests and `reports/phase-22-wizard-flow.md`

### Acceptance
Wizard produces a working config on the happy path; invalid input is rejected with a clear message.

### Stop
Report and STOP.

## PHASE 23 — First-run setup wizard: cancel, resume and edge cases

### Goals
Make the wizard safe to interrupt and re-run.

### Tasks
- Support cancel and resume without leaving half-written config.
- Handle already-configured, missing-file and corrupted-state cases.
- Provide a way to re-run the wizard without deleting user data.

### Deliverables
- Wizard cancel/resume logic
- Tests and `reports/phase-23-wizard-edge-cases.md`

### Acceptance
Cancelling at any step leaves the app in a clean state; resuming works; existing data is never overwritten.

### Stop
Report and STOP.

## PHASE 24 — Help, About and notices pages

### Goals
Provide accurate in-app information pages.

### Tasks
- Implement Help, About, version, upstream commit, license notices and privacy/security pages.
- Pull version and commit information from real build data, not hard-coded text.
- Test that every link and page renders and that license notices are accurate.

### Deliverables
- Help, About and notices pages
- Tests and `reports/phase-24-help-about.md`

### Acceptance
License notices displayed accurately; version and upstream commit match the real build.

### Stop
Report and STOP.

## PHASE 25 — Update checker: service and UI (read-only)

### Goals
Detect and display available updates without installing anything.

### Tasks
- Configure upstream URL and selected branch explicitly.
- Display installed commit, latest available commit/release, release notes and last check time.
- Default to automatic checking; never install in this phase.
- Test no-update and update-available states.

### Deliverables
- Update-check service and UI
- Tests and `reports/phase-25-update-checker.md`

### Acceptance
Update information matches the real upstream; nothing is modified on disk.

### Stop
Report and STOP.

## PHASE 26 — Update checker: error states and compatibility

### Goals
Make the update checker robust and informative in every situation.

### Tasks
- Handle offline mode, GitHub API rate limits, authentication requirements and repository errors.
- Show changed files and dependency/configuration changes.
- Check branch compatibility, license notice changes and migration requirements.
- Test incompatible update, rate limit, offline and repository-error states.

### Deliverables
- Extended update-check logic and UI states
- Tests and `reports/phase-26-update-checker-edge-cases.md`

### Acceptance
All error states are handled with clear messages; nothing is modified on disk.

### Stop
Report and STOP.

## PHASE 27 — Update staging: build in a staging directory

### Goals
Prepare a candidate update in an isolated staging directory so it can never touch the real install.

### Tasks
- Fetch the candidate update into a staging directory, never directly over the running install.
- Never run a blind `git pull` over a modified tree and never execute unreviewed arbitrary code.
- Show staging progress and location in the UI; keep the current install untouched throughout.

### Deliverables
- Update staging service and UI
- Tests and `reports/phase-27-update-staging.md`

### Acceptance
A test update can be staged in isolation; the current install is untouched.

### Stop
Report and STOP.

## PHASE 28 — Update validation and failure handling

### Goals
Validate a staged update with real checks before it can be applied.

### Tasks
- Run real build, test and migration checks on the staged update (dependency install in staging, lint, type-check, tests, config migration check).
- If any check fails, keep the current version and show the exact reason; clean up staging safely.
- Test a valid staged update and failed-build cases.

### Deliverables
- Update validation service and UI
- Tests and `reports/phase-28-update-validation.md`

### Acceptance
A valid staged update passes validation; a failing update is rejected with the exact reason and the install is untouched.

### Stop
Report and STOP.

## PHASE 29 — Update apply: safeguards (backup, approval, rollback target)

### Goals
Make sure an update can only be applied with approval, a verified backup and a recorded way back.

### Tasks
- Back up user data and config before applying an approved update (using the backup service).
- Require explicit user approval for installation and show what will change.
- Record the rollback target (previous version/commit) before any change is made.
- Test that apply is refused without approval and without a verified backup.

### Deliverables
- Pre-apply safeguards
- Tests and `reports/phase-29-update-apply-safeguards.md`

### Acceptance
Apply cannot start without approval and a verified backup; the rollback target is recorded first.

### Stop
Report and STOP.

## PHASE 30 — Update apply: atomic apply and data preservation

### Goals
Apply approved updates without breaking user data.

### Tasks
- Apply atomically where possible.
- Preserve `.env`, accounts, sessions, settings and user modifications.
- Test an interrupted update (simulated safely) and test data preservation.

### Deliverables
- Update apply service and UI
- Tests and `reports/phase-30-update-apply.md`

### Acceptance
An approved staged update applies without data loss; an interrupted update leaves a recoverable state.

### Stop
Report and STOP.

## PHASE 31 — Update rollback

### Goals
Allow the user to safely return to the previous version.

### Tasks
- Implement one-click rollback to the recorded previous version with explicit confirmation.
- Verify user data is unchanged after rollback.
- Test rollback after a successful update, after an interrupted update and when the rollback target is missing or corrupted.

### Deliverables
- Rollback service and UI
- Tests and `reports/phase-31-update-rollback.md`

### Acceptance
Rollback restores the previous version without data loss; a missing/corrupted target fails with a clear message and changes nothing.

### Stop
Report and STOP.

## PHASE 32 — Update end-to-end tests and documentation

### Goals
Prove the full update lifecycle works and document it.

### Tasks
- Run the full cycle end to end: check, stage, validate, approve, apply and roll back.
- Verify user data preservation across the full cycle.
- Write `docs/updating-and-rollback.md`.

### Deliverables
- End-to-end update tests
- `docs/updating-and-rollback.md`
- `reports/phase-32-update-e2e-docs.md`

### Acceptance
The full update lifecycle passes with real evidence; documentation matches actual behavior.

### Stop
Report and STOP.

## PHASE 33 — Security review: IPC, filesystem and process spawning

### Goals
Review the integrated app for weaknesses in inter-process, file and process handling.

### Tasks
- Review IPC/API authorization, input validation, filesystem access (including path traversal) and process spawning (including command injection).
- Record each finding with severity and evidence.
- Fix critical/high findings or list them as release blockers.

### Deliverables
- Findings list with severity and evidence
- `reports/phase-33-security-ipc-fs-process.md`

### Acceptance
Every finding is documented with severity; critical/high findings are fixed or listed as release blockers.

### Stop
Report and STOP.

## PHASE 34 — Security review: secrets, network and local services

### Goals
Review secret handling and network exposure.

### Tasks
- Review secrets handling and log redaction end to end.
- Bind any local-only service to loopback unless a separately approved secured design requires otherwise.
- Do not expose a public remote control endpoint by default; do not disable antivirus or OS protections.
- Update the threat model and record each finding with severity and evidence.

### Deliverables
- Updated threat model
- `reports/phase-34-security-secrets-network.md`

### Acceptance
Every finding is documented with severity; critical/high findings are fixed or listed as release blockers.

### Stop
Report and STOP.

## PHASE 35 — Security: dependency audit and licenses

### Goals
Review third-party risk with real tool output.

### Tasks
- Run the dependency audit and record the real output.
- Review license compatibility of all dependencies and of the upstream project.

### Deliverables
- Dependency audit output and license review
- `reports/phase-35-security-dependency-audit.md`

### Acceptance
Dependency audit and license review are documented with real output.

### Stop
Report and STOP.

## PHASE 36 — Security: fixes and SECURITY.md

### Goals
Close out security findings and document the security posture.

### Tasks
- Fix critical/high findings from Phases 33–35 or document them as release blockers.
- Write `SECURITY.md`.

### Deliverables
- `SECURITY.md`
- `reports/phase-36-security-md-fixes.md`

### Acceptance
No unaddressed critical/high findings; `SECURITY.md` matches actual behavior.

### Stop
Report and STOP.

## PHASE 37 — Privacy

### Goals
Make the app's data handling transparent and privacy-respecting.

### Tasks
- Disable telemetry by default; disclose any opt-in telemetry clearly.
- Write `PRIVACY.md` describing exactly what is stored locally and where.
- Verify the document against actual behavior by inspecting real files and network activity.

### Deliverables
- `PRIVACY.md`
- `reports/phase-37-privacy.md`

### Acceptance
Privacy document matches actual behavior; no telemetry is sent by default.

### Stop
Report and STOP.

## PHASE 38 — Reliability: data and process failure tests

### Goals
Test how the app behaves when data or processes fail.

### Tasks
- Test malformed config, corrupted session metadata, process crash, power interruption (simulated safely) and permission denied.
- Record the real behavior of each case; fix anything that corrupts data or leaves the app unusable.

### Deliverables
- Failure tests and fixes
- `reports/phase-38-reliability-data-process.md`

### Acceptance
Each failure case has a recorded result; none corrupts user data.

### Stop
Report and STOP.

## PHASE 39 — Reliability: environment failures and safe recovery

### Goals
Make the app recover safely from environment problems.

### Tasks
- Test low disk space, network outage, invalid token and failed update.
- Add safe recovery, crash recovery, safe shutdown and actionable error messages.
- Verify the app can always return to a usable state without deleting user data.

### Deliverables
- Recovery logic and tests
- `reports/phase-39-reliability-recovery.md`

### Acceptance
Recovery tests pass; no failure leaves the app in an unrecoverable state.

### Stop
Report and STOP.

## PHASE 40 — Screenshot fidelity: capture and compare

### Goals
Compare the real running app with all seven original screenshots.

### Tasks
- Capture each app screen at matching dimensions and scale.
- Compare sidebar, spacing, typography, field order, labels, colors, controls, alignment and page density.
- Use image-diff tools only as evidence; do not optimize solely for pixel similarity at the cost of usability or accessibility.
- Document every difference found.

### Deliverables
- Before screenshots
- Comparison notes for all seven screenshots
- `reports/phase-40-visual-capture-compare.md`

### Acceptance
All seven screenshots have documented comparisons.

### Stop
Report and STOP.

## PHASE 41 — Screenshot fidelity: fix mismatches and re-compare

### Goals
Fix the important visual mismatches found in Phase 40 and prove it.

### Tasks
- Fix the important mismatches (layout, labels, field order, colors, spacing).
- Re-capture and re-compare each affected screen; record before/after.
- Do not claim "exact same" if measurable differences remain.

### Deliverables
- After screenshots and updated comparison notes
- `reports/phase-41-visual-fixes.md`

### Acceptance
Important mismatches are fixed and re-verified; remaining differences are documented honestly.

### Stop
Report and STOP.

## PHASE 42 — Screenshot fidelity: states, accessibility and control audit

### Goals
Finish UI acceptance beyond static appearance.

### Tasks
- Check dark theme, high-DPI, resized window, keyboard navigation, focus, validation, empty, error and loading states.
- Verify every visible control works or is explicitly disabled with an explanation.
- Build the feature-to-screenshot acceptance matrix.

### Deliverables
- Feature-to-screenshot acceptance matrix
- `reports/phase-42-visual-acceptance.md`

### Acceptance
All visible controls are accounted for; the acceptance matrix is complete with real evidence.

### Stop
Report and STOP.

## PHASE 43 — Windows packaging: build

### Goals
Create a reproducible Windows deliverable.

### Tasks
- Select installer or portable packaging based on framework and user requirements.
- Build from a clean checkout with locked dependencies.
- Avoid bundling credentials or sessions.

### Deliverables
- Installer/portable artifact where environment permits
- `reports/phase-43-packaging-build.md`

### Acceptance
A clean-checkout build produces an artifact containing no secrets.

### Stop
Report and STOP.

## PHASE 44 — Windows packaging: checksum, version info and signing status

### Goals
Make the artifact traceable and honestly described.

### Tasks
- Provide a checksum and build version/commit information for the artifact.
- Inspect the artifact contents to confirm no secrets, sessions, `.env` or real account data are inside.
- Document signing status accurately; do not pretend an unsigned app is signed.

### Deliverables
- Checksum file and version/commit info
- `reports/phase-44-packaging-checksum-signing.md`

### Acceptance
The artifact has a checksum and version/commit info, contains no secrets, and its signing status is stated accurately.

### Stop
Report and STOP.

## PHASE 45 — Windows packaging: install, upgrade and uninstall testing

### Goals
Prove the package works on a clean Windows setup.

### Tasks
- Test install, launch, close, restart, uninstall, upgrade, rollback and preservation of user data.
- Test a clean Windows setup and explain any genuine prerequisites.
- Handle antivirus warnings honestly; never tell users to disable protections as a routine workaround.
- Write `SETUP_WINDOWS.txt`.

### Deliverables
- `SETUP_WINDOWS.txt`
- `reports/phase-45-packaging-install-tests.md`

### Acceptance
Fresh install and upgrade tests pass in a documented environment; uninstall behavior is documented accurately.

### Stop
Report and STOP.

## PHASE 46 — One-click build script: BUILD.bat

### Goals
Give the user a double-click script for building, since they cannot use CMD.

### Tasks
- Create `BUILD.bat` that builds the installer/portable package with one double-click, following rules 23–25, and prints the output path, version and checksum.
- Update and re-test `START.bat` and `TEST.bat`.

### Deliverables
- `BUILD.bat` (plus updated `START.bat`, `TEST.bat`)
- `reports/phase-46-build-bat.md`

### Acceptance
`BUILD.bat` works from a clean checkout with real recorded output.

### Stop
Report and STOP.

## PHASE 47 — One-click ZIP script: MAKE_ZIP.bat

### Goals
Give the user a double-click script that assembles the project ZIP.

### Tasks
- Create `MAKE_ZIP.bat` that assembles the full project ZIP (excluding secrets, sessions, `.env`, real account data, `node_modules`, caches) and prints its path and checksum.
- Re-test `START.bat`, `TEST.bat`, `BUILD.bat` and `MAKE_ZIP.bat` from a clean checkout.

### Deliverables
- `MAKE_ZIP.bat`
- `reports/phase-47-make-zip-bat.md`

### Acceptance
All four `.bat` files work from a clean checkout with real recorded output.

### Stop
Report and STOP.

## PHASE 48 — Final audit: verification and feature matrix

### Goals
Verify the whole project with real evidence before handover.

### Tasks
- Run all project checks from a clean checkout and run `TEST.bat`, recording the real output.
- Review all phase reports (Phases 12–50, plus any earlier-phase reports the user supplied) and resolve missing evidence.
- Verify every screenshot requirement against implementation and test results.
- Verify update/rollback behavior and preservation of user data.
- Produce `docs/requirements-matrix.md` and `docs/feature-support-matrix.md` with one of: verified, partially verified, unsupported, blocked.
- Do not claim production-ready unless release criteria truly pass.

### Deliverables
- `docs/requirements-matrix.md`
- `docs/feature-support-matrix.md`
- Final test report
- `reports/phase-48-final-audit.md`

### Acceptance
Every requirement has a status backed by real evidence; unresolved gaps are explicit.

### Stop
Report and STOP.

## PHASE 49 — Final documentation

### Goals
Write all final documentation.

### Tasks
- Write `README.md`, `UPSTREAM_UPDATES.md` and finalize `SETUP_WINDOWS.txt`, `SECURITY.md`, `PRIVACY.md`.
- Document known limitations, unsupported screenshot features, upstream branch choice, license notices, exact runtime versions, installation, first run, backup, updates, rollback, troubleshooting and uninstall.
- Provide exact commands for the user's actual shell (CMD or PowerShell clearly labeled), but only where a `.bat` cannot be used.

### Deliverables
- `README.md`, `SETUP_WINDOWS.txt`, `UPSTREAM_UPDATES.md`, `SECURITY.md`, `PRIVACY.md`
- `reports/phase-49-final-documentation.md`

### Acceptance
All documents exist, match actual behavior, and state unresolved gaps explicitly.

### Stop
Report and STOP.

## PHASE 50 — Final ZIP and handover

### Goals
Deliver all source, instructions and evidence as one complete ZIP.

### Tasks
- Build the final full ZIP (via `MAKE_ZIP.bat`) containing everything from all phases combined: source, launchers, docs, all reports, screenshots, installer/portable build if generated, checksums.
- Verify the ZIP by extracting it to a fresh folder, running `START.bat` and `TEST.bat` from there, and confirming no secrets, sessions or real account data are inside.
- Provide the ZIP filename, size, SHA-256 checksum and a plain-language "double-click this file first" guide.

### Deliverables
- **One complete new ZIP file** with the whole project and all earlier work (mandatory)
- `START.bat`, `TEST.bat`, `BUILD.bat`, `MAKE_ZIP.bat` (and any later launchers), all verified
- `docs/requirements-matrix.md`, `docs/feature-support-matrix.md`
- `reports/phase-12...phase-50...` (plus earlier-phase reports if present)
- Installer/portable build if successfully generated
- Final test report and artifact checksum

### Acceptance
All promised deliverables exist, the full ZIP extracts and runs correctly via its `.bat` files, tests have actual evidence, and unresolved gaps are explicit.

### Stop
Present the final handover and STOP. No new phase exists after Phase 50 unless the user requests a separately scoped task.

# F. Required report template for every phase

Use this exact outline in `reports/phase-NN-....md`:

1. **Phase and date**
2. **Objective**
3. **Files inspected**
4. **Files created/modified**
5. **Implementation summary**
6. **Commands actually run** (include the real output of `START.bat` and `TEST.bat` for this phase)
7. **Actual command outputs / test evidence**
8. **Acceptance criteria checklist**
9. **Known issues and unresolved questions**
10. **Security/data impact**
11. **Verdict:** PASS / PARTIAL / BLOCKED / FAIL
12. **User decision required**
13. **Explicit stop notice:** "I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval."

If an item was not tested, write `NOT TESTED` and why. Do not infer success from code inspection alone.

# G. Final feature matrix format

Create a table with:
- Screenshot number
- Screen/control
- Expected behavior
- Source/config/API mapping
- Test name or evidence
- Status
- Remaining limitation

Use `VERIFIED`, `PARTIAL`, `UNSUPPORTED`, or `BLOCKED`. Do not label anything VERIFIED without direct evidence.

# H. First action — Phase 12 only

Now begin Phase 12 only:
1. Inspect the existing project (Phases 1–11 are assumed done; do not redo them).
2. If something Phase 12 needs is missing, state exactly what and STOP; do not invent it.
3. Complete Phase 12 and write its report.
4. Do not start Phase 13.
5. Ask the user to explicitly say `NEXT PHASE` before proceeding.

If you cannot access the existing project, state exactly what is inaccessible. Do not invent findings or claim anything was inspected that was not.
