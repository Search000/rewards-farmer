# Troubleshooting guide

This guide covers the problems the **Health** page can show, plus two problems the launchers had on a real PC.
Every red or yellow row on the Health page has an **Open guide** button that opens the matching section here.

You never need to type a command. Every step is a click, a double-click on `START.bat`, or a file action in File Explorer.

## How to read each section

- **You see** is the exact text from the app (or the launcher). Parts that change (a folder name, a number) are left out.
- **Evidence** says where the problem was seen:
    - `OBSERVED ON YOUR PC` = seen on the user's Windows PC and written down in an earlier phase report.
    - `OBSERVED HERE` = seen in the Linux test machine with real files, real commands or the real engine.
    - `REPRODUCED IN TESTS` = made on purpose in an automated test with a stand-in. It has not been seen on a real machine.
- **Fix check** says whether the fix was really tried:
    - `VERIFIED (real)` = an automated test makes the problem, does the fix with the real app code, and the row turns OK.
    - `VERIFIED (real run)` = a one-off run on real files and real tools, recorded in `reports/phase-15-evidence.txt`.
    - `VERIFIED (stand-in)` = the row turns OK after the fix is simulated. The real action was not done.
    - `NOT TESTED` = not tried, with the reason.

After any fix, open the Health page and press **Re-run checks**.

<a id="node"></a>

## Node.js (runs the engine)

**Health row:** Node.js (runs the engine)

**You see:**

- Node.js was not found on this computer.
- Node.js was found but it could not run.
- is too old. The engine needs 24 or newer.

**What to do:**

1. Download Node.js 24 or newer from https://nodejs.org/ and install it with the default choices.
2. Close this app completely.
3. Double-click `START.bat` again.

**Evidence:** OBSERVED HERE: the test machine had Node.js 22.22.2 and the real row said it was too old.

**Fix check:**

- Step 1 to 3, effect on the row: VERIFIED (real run) E7 (the same machine, Node.js 24 first in the path, row OK).
- Step 1 to 3, effect on the row for all three messages: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[node] not found, broken and too old"
- Installing Node.js with the nodejs.org installer and the restart of the app: NOT TESTED (no Windows here).

<a id="git"></a>

## Git (downloads the engine)

**Health row:** Git (downloads the engine)

**You see:**

- Git was not found on this computer.
- Git was found but it could not run.

**What to do:**

1. If the engine files are already there, the row is only a warning. You can leave it: Git is needed only to download or update the engine.
2. To fix it, download Git from https://git-scm.com/download/win and install it with the default choices.
3. Close this app and double-click `START.bat` again.

**Evidence:** REPRODUCED IN TESTS.

**Fix check:**

- Warning with engine files, error without them, and OK after Git is available: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[git] not found"
- Installing Git on Windows: NOT TESTED (no Windows here).

<a id="engine-files"></a>

## Engine files

**Health row:** Engine files

**You see:**

- The engine folder is missing or incomplete.

**What to do:**

1. Close this app.
2. Double-click `START.bat`.
3. When it asks "Download the engine files now", press Y. This needs Git and an internet connection.

**Evidence:** OBSERVED HERE: with the engine folder removed, the real row said the folder was missing.

**Fix check:**

- The download that `START.bat` does (Git fetches the engine at the pinned commit), then the row: VERIFIED (real run) E6.
- The same row turns OK once the files are back: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[engine-files] missing"
- The yes/no question and the `START.bat` window itself: NOT TESTED (no Windows here).

**Known gap:** `START.bat` only looks for the file `engine\package.json`. If the engine folder exists but is incomplete (for example `engine\package.json` is there and the API script is missing), `START.bat` does not download again, so step 3 never appears. Found by reading `START.bat`; not run. See "Known gaps" at the end.

<a id="engine-packages"></a>

## Engine packages

**Health row:** Engine packages

**You see:**

- The engine packages are not installed (or the install did not finish).

**What to do:**

1. Close this app.
2. Double-click `START.bat`. It installs the engine packages. This needs internet and can take several minutes.
3. Do not close the black window while it works. Nothing is printed for a while.

**Evidence:** OBSERVED HERE: on the test machine the engine packages were missing and the real row said so.

**Fix check:**

- The install that `START.bat` runs, then the row: VERIFIED (real run) E4. The test machine ran it without the engine's own install scripts, so the browser download was not part of it.
- The row turns OK once the install marker exists: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[engine-packages] missing marker"
- The `START.bat` window and the time it takes on Windows: NOT TESTED (no Windows here).

<a id="engine-built"></a>

## Engine build

**Health row:** Engine build

**You see:**

- The engine is not built yet.

**What to do:**

1. Close this app.
2. Double-click `START.bat`. It builds the engine on first run.

**Evidence:** OBSERVED HERE: the engine had no build output until it was built on the test machine.

**Fix check:**

- The build that `START.bat` runs, then the row: VERIFIED (real run) E4.
- The row turns OK once the build output exists: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[engine-built] no dist"
- The `START.bat` window: NOT TESTED (no Windows here).

<a id="config-file"></a>

## Engine config.json (does not exist)

**Health row:** Engine config.json

**You see:**

- config.json does not exist yet.

**What to do:**

1. Open the **Home** page.
2. Press **Create config** in the yellow notice. It copies the engine example settings into a new `config.json`. It never replaces a file that already exists.

**Evidence:** OBSERVED HERE: with config.json deleted, the real row and the real engine both reported it missing.

**Fix check:**

- Step 1 and 2, with the real app code and the real engine: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[config-file] deleted"
- Pressing the button in the real window: NOT TESTED (the test calls the same app function the button calls).

<a id="config-valid"></a>

## config.json content

**Health row:** config.json content

**You see:**

- config.json is not valid JSON.
- config.json is much larger than a real config (over 1 MB).
- config.json could not be read (
- must be true or false in config.json.
- is valid JSON but 1 setting is missing.

**What to do:**

If the row says the file is **not valid JSON**, is **over 1 MB**, or the engine rejects it:

1. In File Explorer open the folder named `engine` inside the project folder.
2. Rename `config.json` to `config.broken.json`. This keeps your copy.
3. Open the **Home** page and press **Create config**.
4. Enter your settings again on the Settings and Secrets pages. Open `config.broken.json` in Notepad to read the old values.

If the row names **one setting that has a wrong value** (for example "headless must be true or false in config.json."):

1. Open `config.json` in the `engine` folder with Notepad.
2. Correct the setting named in the message, save the file, and press **Re-run checks**.
3. If you are not sure how, use the four steps above instead.

If the row says **a setting is missing** (yellow):

1. You can leave it. The engine uses its default value for that setting.
2. The warning goes away only when that one setting is changed and saved on the Settings page. The Settings page tells you how many settings are missing, but not which. Pressing Save without changing that setting does nothing.

If the row says the file **could not be read**: close other programs that may be using `config.json` (antivirus or cloud sync can lock it) and press **Re-run checks**.

**Evidence:** OBSERVED HERE: every message above was made with real files. The older advice "press Reset to defaults" was tried for real and did not work (see below).

**Fix check:**

- Broken file: renaming it and pressing Create config: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[config-valid] broken file"
- Wrong value: correcting the value, and the rename way: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[config-valid] wrong value"
- Missing setting: changing that setting writes it, Save alone does not: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[config-valid] missing setting"
- File over 1 MB, and the file that is a folder (read error): messages shown: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[config-valid] too big file and unreadable file"
- A file locked by antivirus or cloud sync: NOT TESTED (a lock cannot be made on the Linux test machine).

**Why not "Reset to defaults":** an earlier version of the Health page said to press it. Tried for real, with a broken file the Settings page is read-only and Reset fails with "config.json is invalid". With a wrong value, Reset fails with the same message as the row. The Health texts were changed in Phase 15.

<a id="accounts-file"></a>

## Accounts file

**Health row:** Accounts file

**You see:**

- No accounts file is chosen yet.
- The accounts file has a problem:
- The accounts file has no accounts in it.

**What to do:**

1. Open the **Home** page and press **Open**.
2. Choose your accounts file (a `.env` file with lines like `ACCOUNT_1_EMAIL=...`). Do not paste passwords anywhere except into that local file.
3. If you have no file yet, use the Accounts page to add an account.

**Evidence:** OBSERVED HERE: "No accounts file is chosen yet" and "has a problem" were made with real files. A file with no account line is refused at the moment you choose it, so "has no accounts in it" was only reproduced with a stand-in.

**Fix check:**

- "No accounts file is chosen yet" then choosing a good file: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[accounts-file] broken saved file"
- "has a problem" (the saved file broke after it was chosen) then choosing a good file: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[accounts-file] broken saved file"
- "has no accounts in it": VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[accounts-file] broken saved file"
- The Windows file dialog: NOT TESTED (no Windows here).

<a id="engine-process"></a>

## Engine process

**Health row:** Engine process

**You see:**

- The engine process is starting.
- The engine has not been started yet. It starts after an accounts file is chosen.
- The engine could not start
- The engine process stopped or crashed

**What to do:**

1. "Starting": wait a few seconds and press **Re-run checks**.
2. "Has not been started yet": open the **Home** page and choose your accounts file with **Open**.
3. "Could not start", "stopped" or "crashed": open the **Home** page and press **Restart engine**. If it fails again, open the **Logs** page and read the newest red lines.

**Evidence:** OBSERVED HERE: "not been started yet" was seen before an accounts file was chosen and after the engine was stopped. The other messages were reproduced in tests.

**Fix check:**

- "Not started" then choosing the accounts file, and "stopped" then Restart engine, with the real engine: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[engine-process] stopped engine"
- "Starting", "could not start", "crashed" and the Restart engine button after a real crash: NOT TESTED (not made with the real engine; the messages themselves are covered by the stand-in tests of the Health service).

<a id="engine-api"></a>

## Engine API answers

**Health row:** Engine API answers

**You see:**

- The engine API did not answer correctly:
- The engine API answered, but it says it is not healthy.

**What to do:**

1. If the message says the engine refused the app (an access problem): close this app and open it again with `START.bat`. The engine and the app must start together.
2. Otherwise: close this app and open it again with `START.bat`. If it happens again, open the Logs page and read the newest red lines.

**Evidence:** REPRODUCED IN TESTS.

**Fix check:**

- The messages for a refused call, a failed call and "not healthy", and OK after a good answer: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[engine-api] answers badly"
- Closing and opening the real app: NOT TESTED (no Windows here, and no real engine failure was made).

<a id="engine-config"></a>

## Engine reads its config

**Health row:** Engine reads its config

**You see:**

- The engine cannot find config.json.
- The engine rejects config.json:
- The engine could not give its config:
- The engine answered, but without any configuration.

**What to do:**

1. "Cannot find config.json": open the **Home** page and press **Create config**.
2. "Rejects config.json" or "without any configuration": follow the four steps for a broken file in the section "config.json content" (rename to `config.broken.json`, then Create config).
3. "Could not give its config": close this app and open it again with `START.bat`.

**Evidence:** OBSERVED HERE: the real engine said "cannot find config.json" when the file was deleted and "config.json is invalid" when the file was broken.

**Fix check:**

- "Cannot find" then Create config, and "rejects" then rename and Create config, with the real engine: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[engine-config] cannot find or rejects"
- "Could not give its config" and "without any configuration": NOT TESTED (not made with the real engine).

<a id="engine-version"></a>

## Engine version

**Health row:** Engine version

**You see:**

- but the engine files on disk are version

**What to do:**

1. An older engine is still running. Open the **Home** page and press **Restart engine**.
2. If the row stays yellow, close this app completely and open it again with `START.bat`.

**Evidence:** OBSERVED HERE: the engine files were changed after the engine started and the real row warned.

**Fix check:**

- Restart engine, with the real engine: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[engine-version] old engine still running"
- Closing and opening the whole app: NOT TESTED (no Windows here).

<a id="disk-space"></a>

## Free disk space

**Health row:** Free disk space

**You see:**

- The disk is almost full:
- The disk is getting full:

**What to do:**

1. Empty the Recycle Bin and delete files you no longer need on the drive named in the row.
2. Or move the project folder to a bigger drive. The engine needs room for browser data, logs and backups.
3. Press **Re-run checks**.

**Evidence:** REPRODUCED IN TESTS. The test machine always had enough space.

**Fix check:**

- Both messages, and OK after space is freed: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[disk-space] low disk"
- Freeing space on a real full drive: NOT TESTED.

<a id="folder-data"></a>

## App data folder (read and write)

**Health row:** App data folder (read and write)

**You see:**

- The app data folder does not exist:
- This computer does not allow the app to write in the app data folder:
- The app data folder is read-only:
- The disk is full, so nothing can be written in the app data folder:
- The app data folder could not be used (
- but a small test file could not be deleted again:

**What to do:**

1. "Does not exist": close this app and open it again with `START.bat`. It creates the folder. The message also appears when a file has the same name as the folder. Check that the drive is connected.
2. "Does not allow the app to write": move the whole project folder to a normal place such as Documents and start `START.bat` from there. If it stays, right-click the folder, choose Properties, then Security, and give your user "Modify". Antivirus "Controlled folder access" can also block it: allow Rewards Farmer there.
3. "Read-only": move the whole project folder to a normal folder such as Documents and start `START.bat` from there.
4. "Disk is full": free some space, then press **Re-run checks**.
5. "Test file could not be deleted": open that folder and delete the file whose name starts with `.rf-health-probe`. If it will not delete, close other programs that use the folder.

**Evidence:** OBSERVED HERE: "does not exist" was made with a missing folder and with a file in the folder's place. The other messages were reproduced in tests.

**Fix check:**

- "Does not exist": creating the folder turns the row OK: VERIFIED (real) `tests/main/troubleshooting.fixes.test.ts` › "[folders] missing folder"
- "Does not exist" after `START.bat` creates the folder: NOT TESTED (no Windows here).
- "Not allowed", "read-only", "disk full", "could not be used", "test file": messages and OK after the cause is gone: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[folders] missing folder"
- Giving "Modify" in Properties, "Controlled folder access", and a real permission-denied folder: NOT TESTED (no Windows here, and the test machine runs as an administrator account that is never denied).

<a id="folder-engine"></a>

## Engine folder (read and write)

**Health row:** Engine folder (read and write)

**You see:**

- The engine folder does not exist:
- This computer does not allow the app to write in the engine folder:
- The engine folder is read-only:
- The disk is full, so nothing can be written in the engine folder:
- The engine folder could not be used (
- but a small test file could not be deleted again:

**What to do:** the same steps as "App data folder (read and write)" above, with one difference: for "does not exist", double-click `START.bat` and press Y when it offers to download the engine files.

**Evidence:** REPRODUCED IN TESTS. The same code and the same real file checks as the app data folder row.

**Fix check:**

- Messages and OK after the cause is gone: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[folders] missing folder"
- Everything about real permissions and `START.bat`: NOT TESTED, same reasons as the app data folder row.

<a id="network"></a>

## Internet connection

**Health row:** Internet connection

**You see:**

- could not be looked up (
- was found, but a connection could not be opened (

**What to do:**

1. "Could not be looked up": check your Wi-Fi or network cable and that other websites open. If you use a VPN, turn it off or switch it.
2. "A connection could not be opened" (yellow): a firewall, VPN or proxy may be blocking the connection. If your accounts use their own proxy, this can be normal. Otherwise allow Rewards Farmer in your firewall.
3. Press **Re-run checks**.

The check only opens a connection to `rewards.bing.com` on port 443 and closes it. Nothing is sent.

**Evidence:** OBSERVED HERE: the Linux test machine cannot look up `rewards.bing.com`, and the real row said so.

**Fix check:**

- The real row failing, and both messages turning OK once the connection works: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[network] offline and blocked"
- Changing Wi-Fi, VPN, firewall or proxy settings: NOT TESTED (the network of the test machine cannot be changed).

<a id="unknown"></a>

## Rows that say "Unknown"

**Health row:** any row

An "Unknown" row means the check could not run, so the app does not claim OK. Most often another row is the real cause.

**You see:**

- Not checked: the engine files are missing (see "Engine files").
- Not checked: config.json does not exist (see "Engine config.json").
- Not checked: the engine is not running (see "Engine process").
- Not checked: the engine API did not answer (see above).
- did not answer in time, so its version is unknown.
- did not finish in time.
- The check itself failed (
- The free disk space could not be read
- The internet check could not be run.

**What to do:**

1. Fix the red or yellow row the message points to ("Engine files", "Engine config.json", "Engine process", "Engine API answers"). The Unknown rows then run by themselves.
2. "Did not answer in time" or "did not finish in time": the computer was slow or busy. Close heavy programs and press **Re-run checks**.
3. "The check itself failed", "disk space could not be read", "internet check could not be run": press **Re-run checks**. If it repeats, export the diagnostics bundle on this page and keep it for whoever helps you.

**Evidence:** OBSERVED HERE for the "Not checked: ..." rows (seen before the engine started and with files removed). The others were reproduced in tests.

**Fix check:**

- Each message above is made and then clears when its cause is fixed: VERIFIED (stand-in) `tests/main/troubleshooting.fixes.test.ts` › "[unknown] rows"
- Slow computers: NOT TESTED.

<a id="launcher-incomplete-install"></a>

## START.bat or TEST.bat: install did not finish

**Health row:** none (this is a launcher problem)

**You see:**

- or an earlier install did not finish

**What to do:**

1. Double-click `START.bat` again and wait. It sees that the earlier install is unfinished and installs again.
2. Do not close the black window and do not press Ctrl+C while it installs. Nothing is printed for a while.
3. If it fails again, check your internet connection, close other windows of this project, and pause antivirus or cloud sync on the project folder. Move the project to a short folder path such as `C:\RF` if the path is very long.

**Evidence:** OBSERVED ON YOUR PC: after an install was stopped with Ctrl+C, `TEST.bat` showed every step as FAIL with the message that `tsc` is not recognized. Recorded in the Phase 9 report.

**Fix check:**

- The launchers now check the real tool files instead of only the folder, then install again: NOT TESTED (needs Windows). `tests/launchers.test.ts` only reads the file text.
- Moving to a short path and pausing antivirus: NOT TESTED.

<a id="launcher-already-running"></a>

## START.bat or TEST.bat: another window is running

**Health row:** none (this is a launcher problem)

**You see:**

- is already running in this folder.

**What to do:**

1. Wait until the other `START.bat` or `TEST.bat` window finishes, or close it.
2. Double-click the file again.

**Evidence:** OBSERVED ON YOUR PC: `START.bat` and `TEST.bat` were started two seconds apart, both installed packages, and the logs showed more than 46000 TAR_ENTRY_ERROR lines. Recorded in the comment inside `START.bat`.

**Fix check:**

- The lock that stops the second window: NOT TESTED (needs Windows). `tests/launchers.test.ts` only reads the file text.

## Known gaps

These were found while writing this guide. They are not fixed in Phase 15.

1. **`START.bat` and an incomplete engine folder.** `START.bat` downloads the engine only when `engine\package.json` is missing. The Health row "Engine files" also needs the API script. If only the API script is missing, the fix in "Engine files" cannot be done with `START.bat`. Found by reading; not run.
2. **"Does not exist" for a file in the way.** The folder rows say the folder does not exist when a file has the same name. Seen for real. The message is not wrong about the folder, but it does not mention the file.
3. **Missing settings.** The Settings page does not name which setting is missing, and Save alone does not write it. Seen for real.
4. **No repair button.** A broken `config.json` can only be fixed by renaming it and pressing Create config. There is no button that keeps your settings.
5. **Windows.** Nothing in this guide was run on Windows by the author. Rows marked `NOT TESTED` say so.
