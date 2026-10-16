# MASTER BUILD PROMPT — Microsoft Rewards Farmer Desktop App
## 15-Phase, Approval-Gated, Screenshot-Driven, Real Upstream Integration

**Project:** Microsoft Rewards Farmer desktop application  
**Upstream repository:** https://github.com/chiihero/Microsoft-Rewards-Script  
**Branches to compare:** `main` and `V4-china`  
**Primary platform:** Windows desktop  
**Reference material:** the user's supplied ZIP containing seven screenshots  
**Working rule:** finish and verify one phase, produce its report, then STOP. Never start the next phase unless the user explicitly says `NEXT PHASE` or otherwise clearly authorizes it.

---

# A. Mission

Build a real Windows desktop app whose UI closely matches the seven supplied reference screenshots and whose functionality is connected to the actual supported features of `chiihero/Microsoft-Rewards-Script`.

The app must use real configuration, real processes, real logs, and actual upstream-supported behavior. It must not be a static mockup or a fake demo. If the upstream repository does not support a screenshot feature, do not simulate it. Record the gap and either implement a legitimate integration or mark the feature unavailable until the user approves a real implementation.

This prompt is a work specification, not proof that the app has been built. The coding agent must inspect source, edit files, run commands, and report actual observed results.

# B. Absolute rules — apply to all 15 phases

1. **Strict phase gate:** Work on exactly one phase at a time. Do not inspectively begin implementation for later phases while a current phase is in progress.
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

# C. Required first response

Start at **Phase 1 only**. Do not implement the app yet. Confirm the screenshot archive is accessible, enumerate and inspect all seven images, inspect the repository and compare `main` with `V4-china`, and write the Phase 1 inventory report. If the environment cannot access GitHub or image files, state the exact limitation and provide a reproducible local command. At the end, stop and ask the user to approve Phase 2.

# D. What can be added — feature backlog to evaluate, not blindly promise

Evaluate each item against the screenshots and upstream code. Do not add every item automatically. Label each as:
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
- Actual points/status retrieved from the supported engine, with “unknown” shown when unavailable
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
- Optional auto-start with Windows only after explicit opt-in
- Optional local-only API only when necessary and protected

Do not add cloud sync, remote control, telemetry, analytics, automatic credential harvesting, account selling, or public API exposure unless there is a clear, safe, user-approved design and legal basis. Default to no telemetry and local-only data.

# E. Fifteen phases — do not proceed without explicit approval

## PHASE 1 — Screenshot inventory, repository reconnaissance, branch and license audit

### Goals
Establish the factual baseline. No app implementation yet.

### Tasks
- Confirm and list all seven screenshot files from the user ZIP.
- Inspect each at original resolution. Record dimensions, page name, sidebar, labels, fields, toggles, icons, spacing, color, visible states, and unclear areas.
- Create a screenshot-to-screen matrix.
- Inspect the upstream repository's current README and docs.
- Compare `main` and `V4-china`, including latest commit, history, package files, folder layout, config examples, API docs, releases, tests and build scripts.
- Identify project license and attribution/redistribution obligations.
- Identify actual language/runtime/dependencies and documented Windows requirements.
- Note source paths for all evidence.
- Identify any inaccessible pages/files honestly.

### Deliverables
- `reports/phase-01-repository-and-screenshot-audit.md`
- `reports/screenshot-inventory.md`
- `reports/branch-comparison.md`

### Acceptance
All seven images accounted for; branches compared using real evidence; license and runtime risks documented; no implementation started.

### Stop condition
Report and STOP. Ask for `NEXT PHASE`.

## PHASE 2 — Feature map and requirements freeze

### Goals
Translate screenshots and repository facts into a precise feature list.

### Tasks
- For every visible control, record label, page, expected action, data source, validation, loading/error/disabled state, and test.
- Classify each feature: screenshot-required, upstream-supported, needs implementation, unsafe/not appropriate, or user decision.
- Separate visual requirements from behavior requirements.
- Identify unknown behaviors that screenshots cannot prove.
- Define acceptance criteria and measurable UI matching criteria.
- Propose optional additions separately; do not add unrequested scope silently.

### Deliverables
- `docs/requirements-matrix.md`
- `docs/feature-support-matrix.md`
- `reports/phase-02-requirements.md`

### Acceptance
Every visible screenshot control is mapped or explicitly marked unresolved; no invented capabilities.

### Stop
Report and STOP for `NEXT PHASE`.

## PHASE 3 — Architecture and integration design

### Goals
Design a maintainable desktop shell connected to the real engine.

### Tasks
- Select framework after Phase 1 evidence. Consider Electron + TypeScript only if justified by upstream stack and packaging.
- Define UI/main-process separation, process lifecycle, typed IPC or documented local API, data ownership, error contracts, logging and update boundaries.
- Reuse upstream code via a clean pinned dependency, a maintained fork, or an isolated process only after comparing tradeoffs.
- Never invent API endpoints. If no suitable stable interface exists, document the required integration adapter.
- Define configuration schema/versioning and migrations.
- Define offline behavior, startup behavior and safe shutdown.
- Produce architecture diagram and threat model.

### Deliverables
- `docs/architecture.md`
- `docs/integration-contract.md`
- `docs/threat-model.md`
- `reports/phase-03-architecture.md`

### Acceptance
Architecture is supported by source evidence, and the user approves the integration plan before coding.

### Stop
Report and STOP.

## PHASE 4 — Development environment and reproducible project scaffold

### Goals
Prepare the real build environment without losing user files.

### Tasks
- Check OS, shell, Git, runtime, package manager and required compiler/build tools.
- Document exact prerequisites and versions.
- Create project structure, scripts, lockfile strategy, lint/type-check/test commands, `.editorconfig`, `.gitignore`, and environment examples.
- Keep upstream source in a clear directory/submodule/fork strategy; document why.
- Ensure secrets, sessions, build artifacts and local databases are ignored by Git.
- Do not globally install tools or modify system policy without permission.
- Verify a clean baseline build/test where possible.

### Deliverables
- Scaffold and config files
- `SETUP_WINDOWS.md`
- `reports/phase-04-environment.md`

### Acceptance
Reproducible setup commands documented and scaffold checks pass.

### Stop
Report and STOP.

## PHASE 5 — Desktop shell and visual design system

### Goals
Create the common window and shared visual components only.

### Tasks
- Implement window shell, sidebar, page routing, dark theme, typography, spacing, icons, cards, inputs, dropdowns, toggles, tooltips, modals and notifications.
- Match dimensions and spacing from the actual screenshots.
- Include keyboard focus, accessible labels, high-DPI handling, resizing, loading, error and disabled styles.
- Do not wire fake data or fake backend behavior.
- Use a truthful “not connected yet” development state only during this phase; do not present it as a released feature.

### Deliverables
- Reusable UI components and theme
- `reports/phase-05-shell.md`
- Actual running-app screenshots

### Acceptance
Common shell matches reference style and passes UI component tests.

### Stop
Report and STOP.

## PHASE 6 — Home / Farmer screen

### Goals
Implement screenshot 1 using real supported data and controls.

### Tasks
- Implement actual account path picker where appropriate.
- Implement alternate proxy configuration only if source supports it and it is safe.
- Connect Start/Stop to real process lifecycle.
- Show actual current/total account status and genuine engine state.
- Add honest idle, loading, running, stopped, error and unavailable states.
- Prevent duplicate start operations and handle process termination.
- Do not invent account counts, points, progress, or success.
- Test path errors, missing config, start failure, stop, restart, and unexpected process exit.

### Deliverables
- Home page implementation
- Integration tests
- `reports/phase-06-home.md`

### Acceptance
Every enabled control works against the actual engine and test evidence is included.

### Stop
Report and STOP.

## PHASE 7 — Accounts screen and account data lifecycle

### Goals
Implement screenshot 2 using the real account/session model.

### Tasks
- Inspect actual account storage format before modifying it.
- Implement account listing and details from real data.
- Add/import/remove only if safely supported; confirm destructive actions.
- Preserve session data and permissions.
- Implement empty, loading, error and selected states.
- Avoid leaking account identifiers or secrets in logs.
- Add safe backup/restore if appropriate.
- Never create fake production accounts to fill the screen.

### Deliverables
- Accounts screen
- Account lifecycle tests
- `reports/phase-07-accounts.md`

### Acceptance
Displayed accounts match real local/upstream records; destructive operations are guarded.

### Stop
Report and STOP.

## PHASE 8 — Settings and task settings

### Goals
Implement screenshots 3–4 and persist real configuration.

### Tasks
- Extract the exact configuration schema from source.
- Map each visible field to a real config property and document default, type, validation and restart requirement.
- Implement save/cancel/reset and unsaved-change warnings.
- Implement language, browser, device, proxy and task options only when supported.
- Map task toggles to valid task IDs; no invented toggles.
- Back up config before schema migration.
- Test invalid values, missing values, config write failure and restart persistence.

### Deliverables
- Settings/task settings screens
- `docs/configuration-reference.md`
- Tests and `reports/phase-08-settings.md`

### Acceptance
Settings persist and affect the actual engine as documented.

### Stop
Report and STOP.

## PHASE 9 — Advanced settings and secret handling

### Goals
Implement screenshots 5–7 without adding unsafe behavior.

### Tasks
- Map login/check-in options to actual supported fields.
- Map timezone/location fields only if their meaning and use are clear.
- Implement API key fields using OS credential storage where feasible or a local environment file with restrictive permissions.
- Mask secrets and never write them into normal logs.
- Map cooldown/timing/search settings to real supported configuration only.
- Exclude anti-bot evasion, CAPTCHA bypass, fingerprint spoofing and rate-limit circumvention.
- Add secret-redaction tests and config migration tests.

### Deliverables
- Advanced settings screen
- Security tests
- `reports/phase-09-advanced-settings.md`

### Acceptance
Secrets remain protected and every enabled field has a verified effect.

### Stop
Report and STOP.

## PHASE 10 — Real logs, status, diagnostics and notifications

### Goals
Make operational information truthful and useful.

### Tasks
- Integrate real engine logs and status/events.
- Add filtering, timestamps, severity, safe copy/export and refresh.
- Redact secrets and sensitive session data.
- Show unknown/unavailable rather than guessing status or points.
- Implement notifications only when supported and explicitly configured.
- Handle log volume, rotation, permission errors and disconnected event streams.
- Never fabricate a log line or claim a task succeeded without engine evidence.

### Deliverables
- Log/status/diagnostic UI
- `docs/troubleshooting.md`
- Tests and `reports/phase-10-observability.md`

### Acceptance
Logs/status match real engine events; sensitive values are redacted.

### Stop
Report and STOP.

## PHASE 11 — GitHub upstream update checker and safe update installer

### Goals
Support updates from the real upstream without breaking user data.

### Tasks
- Configure upstream URL and selected branch explicitly.
- Display installed commit, latest available commit/release, release notes and check time.
- Handle offline mode, GitHub API rate limits, authentication requirements and repository errors.
- Show changed files and dependency/configuration changes.
- Check branch compatibility, license notices, tests and migration requirements.
- Build/test update in a staging directory, never directly over the running install.
- Back up user data and config before applying an approved update.
- Apply atomically where possible and keep a rollback target.
- Preserve `.env`, accounts, sessions, settings and user modifications.
- Default to automatic checking but user-approved installation.
- If build/test/migration fails, keep the current version and show exact reason.
- Never run blind `git pull` over a modified tree or execute unreviewed arbitrary code.
- Test no update, valid update, incompatible update, failed build, interrupted update, rollback and offline states.

### Deliverables
- Update UI/service
- `docs/updating-and-rollback.md`
- Tests and `reports/phase-11-updates.md`

### Acceptance
A test update can be staged, validated, approved, applied and rolled back without data loss.

### Stop
Report and STOP.

## PHASE 12 — Security, privacy, reliability and failure recovery

### Goals
Review the integrated app as a whole.

### Tasks
- Review IPC/API authorization, input validation, filesystem access, process spawning, dependency risks and secrets handling.
- Bind local-only services to loopback unless a separately approved secured design requires otherwise.
- Check dependency audit output and license compatibility.
- Test malformed config, corrupted session metadata, process crash, power interruption, permission denied, low disk space, network outage, invalid token and failed update.
- Add safe recovery and actionable error messages.
- Disable telemetry by default; disclose any opt-in telemetry clearly.
- Do not expose a public remote control endpoint by default.
- Do not disable antivirus or OS security protections.

### Deliverables
- `SECURITY.md`
- `PRIVACY.md`
- `reports/phase-12-security-reliability.md`

### Acceptance
Critical/high findings are fixed or clearly block release; recovery tests pass.

### Stop
Report and STOP.

## PHASE 13 — Full screenshot fidelity and UI acceptance

### Goals
Compare the real running app with all seven original screenshots.

### Tasks
- Capture each app screen at matching dimensions and scale.
- Compare sidebar, spacing, typography, field order, labels, colors, controls, alignment and page density.
- Use image-diff tools only as evidence; do not optimize solely for pixel similarity at the cost of usability or accessibility.
- Check dark theme, high-DPI, resized window, keyboard navigation, focus, validation, empty states, error states and loading states.
- Document each difference and fix the important mismatches.
- Do not claim “exact same” if measurable differences remain.
- Verify every visible control works or is explicitly disabled with an explanation.

### Deliverables
- `reports/phase-13-visual-acceptance.md`
- Before/after screenshots
- Feature-to-screenshot acceptance matrix

### Acceptance
All seven screenshots have documented comparisons and all visible controls are accounted for.

### Stop
Report and STOP.

## PHASE 14 — Windows packaging, installation and upgrade testing

### Goals
Create a reproducible Windows deliverable.

### Tasks
- Select installer or portable packaging based on framework and user requirements.
- Build from a clean checkout with locked dependencies.
- Avoid bundling credentials or sessions.
- Test install, launch, close, restart, uninstall behavior, upgrade, rollback and preservation of user data.
- Document signing status accurately; do not pretend an unsigned app is signed.
- Provide checksum and build version/commit information.
- Test clean Windows setup and explain any genuine prerequisites.
- Handle antivirus warnings honestly; never tell users to disable protections as a routine workaround.

### Deliverables
- Installer/portable artifact where environment permits
- `SETUP_WINDOWS.txt`
- `reports/phase-14-packaging.md`

### Acceptance
Fresh install and upgrade tests pass in a documented environment.

### Stop
Report and STOP.

## PHASE 15 — Final audit, documentation and handover

### Goals
Deliver all source, instructions and evidence.

### Tasks
- Run all project checks from a clean checkout.
- Review all 15 phase reports and resolve missing evidence.
- Verify every screenshot requirement against implementation and test results.
- Verify update/rollback behavior and preservation of user data.
- Produce a complete feature matrix with one of: verified, partially verified, unsupported, blocked.
- Document known limitations, unsupported screenshot features, upstream branch choice, license notices, exact runtime versions, installation, first run, backup, updates, rollback, troubleshooting and uninstall.
- Provide exact commands for the user's actual shell (CMD or PowerShell clearly labeled).
- Do not claim production-ready unless release criteria truly pass.

### Deliverables
- Complete source project
- `README.md`
- `SETUP_WINDOWS.txt`
- `UPSTREAM_UPDATES.md`
- `SECURITY.md`
- `PRIVACY.md`
- `docs/requirements-matrix.md`
- `docs/feature-support-matrix.md`
- `reports/phase-01...phase-15...`
- Installer/portable build if successfully generated
- Final test report and artifact checksum

### Acceptance
All promised deliverables exist, tests have actual evidence, and unresolved gaps are explicit.

### Stop
Present the final handover and STOP. No new phase exists after Phase 15 unless the user requests a separately scoped task.

# F. Required report template for every phase

Use this exact outline in `reports/phase-NN-....md`:

1. **Phase and date**
2. **Objective**
3. **Files inspected**
4. **Files created/modified**
5. **Implementation summary**
6. **Commands actually run**
7. **Actual command outputs / test evidence**
8. **Acceptance criteria checklist**
9. **Known issues and unresolved questions**
10. **Security/data impact**
11. **Verdict:** PASS / PARTIAL / BLOCKED / FAIL
12. **User decision required**
13. **Explicit stop notice:** “I have not started the next phase. Waiting for the user's explicit `NEXT PHASE` approval.”

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

# H. First action — Phase 1 only

Now begin Phase 1 only:
1. Verify access to the user's seven-image ZIP and inspect every image.
2. Inspect the live upstream repository and compare `main` and `V4-china`.
3. Record evidence-backed architecture, feature support, dependencies, branch and license risks.
4. Write the Phase 1 reports.
5. Do not scaffold, code the app, or start Phase 2.
6. Ask the user to explicitly say `NEXT PHASE` before proceeding.

If you cannot access the ZIP or live repository, stop and explain exactly what is inaccessible. Do not invent findings or claim the images/code were inspected.
