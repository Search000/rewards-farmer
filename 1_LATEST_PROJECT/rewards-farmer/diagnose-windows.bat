@echo off
:: Run in CMD from the project folder. Writes diagnose-output.txt. No passwords or env vars are collected.
chcp 65001 >nul
if not exist package.json (
    echo ERROR: package.json not found. Run this from inside the unzipped rewards-farmer folder.
    echo Current folder: %CD%
    exit /b 1
)
if not exist engine\package.json (
    echo ERROR: engine folder is empty. Run: git submodule update --init
    exit /b 1
)
set OUT=diagnose-output.txt
echo === Windows === > %OUT%
ver >> %OUT% 2>&1
echo === git === >> %OUT%
git --version >> %OUT% 2>&1
echo === node === >> %OUT%
node --version >> %OUT% 2>&1
echo === npm === >> %OUT%
call npm --version >> %OUT% 2>&1
echo === submodule === >> %OUT%
git submodule status >> %OUT% 2>&1
echo === npm ci === >> %OUT%
call npm ci >> %OUT% 2>&1
echo === npm run check === >> %OUT%
call npm run check >> %OUT% 2>&1
echo === engine:install === >> %OUT%
call npm run engine:install >> %OUT% 2>&1
echo === engine:build === >> %OUT%
call npm run engine:build >> %OUT% 2>&1
echo === npm run build (renderer + main) === >> %OUT%
call npm run build >> %OUT% 2>&1
echo === electron version === >> %OUT%
call npx electron --version >> %OUT% 2>&1
echo Done. Open %OUT%, check for your name/paths, then paste or upload it.
