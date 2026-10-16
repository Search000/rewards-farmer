# Phase 01 Report — Repository & Screenshot Audit

## Verdict: Inventory COMPLETE. Two user decisions open. Phase 1 acceptance met for evidence; gate waits on you.

## Done
- Cloned upstream, compared `main` and `V4-china` (see `branch-comparison.md`).
- License read: GNU GPL v3 (LICENSE file), package.json `GPL-3.0-or-later`.
- Runtime: Node >=24, TypeScript, patchright. Windows helpers `setup.bat` / `run.bat` exist.
- Listed V4-china control API routes from `scripts/api/server.js`.

## Screenshots
- ZIP received. 7 of 7 images opened and viewed (1280x679-720 JPG). See `screenshot-inventory.md`.
- Pages visible: Home, Accounts (empty), Settings (4 scroll positions). Parallel farming, Telegram, Discord, About: sidebar only, no image.

## Not done
- No code run. No Windows requirements verified beyond file names.
- Pixel measurements (spacing, exact colors) not taken yet; only visual read.

## Key finding
Many screenshot controls have no obvious counterpart in this upstream's `Config.ts` (Parallel farming, Excel logs, Gift card URL, OpenRouter key, Typo %, Point target, Timer, geolocation). Screenshots look like a different engine's app. Per rules 3, 5, 7: no faking those. Phase 2 must mark each unsupported/unresolved.

## License obligations (not legal advice)
GPL-3.0: a desktop app that bundles or links upstream code likely becomes GPL-3.0 too. Must ship license text, keep copyright notices, offer source. Embedding vs. separate process changes analysis. Check with a lawyer before redistribution. Decision needed Phase 3.

## RISK FLAGS — need user decision
1. **Rule 9 conflict.** Master prompt forbids "stealth or fingerprint spoofing, anti-bot evasion". Upstream engine itself uses `patchright` (patched automation browser), `fingerprint-injector`, `fingerprint-generator` (`src/browser/Browser.ts`), plus a `humanize` module (`src/util/Humanize.ts`). Wrapping upstream means shipping that behavior. Options: (a) wrap as-is and tell user plainly it conflicts with rule 9, (b) wrap but keep those features off/not exposed in UI, (c) drop project. I will not add new evasion code myself either way.
2. **ToS / account risk.** Automating Microsoft Rewards likely violates Microsoft terms. Upstream README disclaimer says accounts may be suspended or banned, use at own risk. App UI should state this, not hide it.
3. **Control API exposes config write + shutdown.** If used, local-only bind + token required (rule 8, threat model Phase 3).

4. Screenshot controls Randomization, Typo probability, UA override, Geolocation, Alternate proxies look like human-mimic or evasion features. Same decision as flag 1, per control.

## Needs from you before Phase 2
1. Pick (a), (b), or (c) for flag 1.
2. Confirm engine: build on `V4-china` (has API) — yes/no.
3. Confirm: controls with no upstream support get disabled + labeled, not faked — yes/no.

## Files
- `reports/screenshot-inventory.md`
- `reports/branch-comparison.md`
- `reports/phase-01-repository-and-screenshot-audit.md`

## STOP
Phase gate held. Phase 2 NOT started. Say `NEXT PHASE` after answering the three items above.
