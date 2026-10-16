@echo off
:: START.bat - double-click to start Rewards Farmer LUCK.
:: First run: installs the project packages inside THIS folder (nothing global). Needs internet and a few minutes.
:: Output goes to logs\start.log. No passwords, tokens or cookies are written by this file.
setlocal EnableExtensions
cd /d "%~dp0"
if not exist logs mkdir logs
if "%~1"=="_locked" goto :main

:: One launcher at a time per folder. START.bat and TEST.bat both install packages; running them together
:: corrupts node_modules (found in the user's logs: both started 2 seconds apart, 46000+ TAR_ENTRY_ERROR).
set "LOCK=%CD%\logs\run.lock"
2>nul (>>"%LOCK%" type nul)
if errorlevel 1 (
    echo.
    echo FAILED: Another Rewards Farmer window ^(START.bat or TEST.bat^) is already running in this folder.
    echo Wait until it finishes or close it, then double-click this file again.
    pause
    exit /b 1
)
9>"%LOCK%" call "%~f0" _locked
exit /b %ERRORLEVEL%

:main
set "LOG=%CD%\logs\start.log"
echo START.bat %DATE% %TIME% > "%LOG%"
set "REASON="

echo.
echo  Rewards Farmer LUCK - start
echo  ---------------------------
echo  Keep this window open while the app runs. Closing it closes the app.
echo.

:: 1. Node.js 24 or newer
where node >nul 2>&1
if errorlevel 1 (
    set "REASON=Node.js is not installed. Download Node.js 24 or newer from https://nodejs.org/ , install it, then double-click START.bat again."
    goto :fail
)
for /f "tokens=1 delims=." %%a in ('node -v') do set "NODEMAJOR=%%a"
set "NODEMAJOR=%NODEMAJOR:v=%"
if %NODEMAJOR% LSS 24 (
    set "REASON=Your Node.js is too old (version %NODEMAJOR%). Download Node.js 24 or newer from https://nodejs.org/ , install it, then double-click START.bat again."
    goto :fail
)
echo [OK] Node.js %NODEMAJOR% found.
if not "%CD:~90,1%"=="" (
    echo [WARNING] This folder path is very long. Windows can fail to unpack packages in long paths.
    echo           If the install fails, move the whole project to a short folder such as C:\RF and run again.
)

:: 2. Engine files (the pinned upstream engine lives in the engine folder). Two files must exist: engine\package.json and
::    engine\scripts\api\server.js (the control API the app talks to). The folder can be there but incomplete.
call :check_engine_files
if "%ENGF_OK%"=="1" goto :engine_files_ok
where git >nul 2>&1
if errorlevel 1 (
    set "REASON=The engine files are missing or incomplete and Git is not installed. Download Git from https://git-scm.com/download/win , install it, then double-click START.bat again."
    goto :fail
)
echo The engine files are missing or incomplete. They can be downloaded now into this folder with Git.
echo Only the missing engine files are put back. Your own settings (config.json) and accounts are not touched.
choice /c YN /m "Download the engine files now"
if errorlevel 2 (
    set "REASON=The engine files are needed. You chose not to download them."
    goto :fail
)
call git submodule update --init >> "%LOG%" 2>&1
if errorlevel 1 (
    set "REASON=Could not download the engine files with Git."
    goto :fail
)
call :check_engine_files
if "%ENGF_OK%"=="1" goto :engine_files_ok
:: The folder was already there, so the step above had nothing to download. Put back ONLY the two files, as they are in the
:: pinned engine version. Other files in the engine folder are not touched.
call git -C engine checkout -- package.json scripts/api/server.js >> "%LOG%" 2>&1
call :check_engine_files
if "%ENGF_OK%"=="1" goto :engine_files_ok
set "REASON=The engine folder is still incomplete. Rename the folder named engine to engine-old, then double-click START.bat again so it downloads the engine again."
goto :fail
:engine_files_ok
echo [OK] Engine files found.

:: 3. App packages (first run, or an unfinished install)
call :check_app
if "%APP_OK%"=="1" goto :app_ready
echo Installing the app packages ^(first run, or an earlier install did not finish^). This can take several minutes. Nothing is printed while it works. Do NOT close this window or press Ctrl+C.
call npm ci >> "%LOG%" 2>&1
if errorlevel 1 (
    set "REASON=Installing the app packages failed. Check your internet connection, close other windows of this project, and pause antivirus or cloud sync on this folder."
    goto :fail
)
call :check_app
if "%APP_OK%"=="1" goto :app_ready
set "REASON=The install ended but some package files are missing. Close other windows of this project, move the folder to a short path such as C:\RF, and try again."
goto :fail
:app_ready
echo [OK] App packages are installed.

:: 4. Engine packages and engine build (first run only)
call :check_engine
if "%ENG_OK%"=="1" goto :eng_ready
echo Installing the engine packages ^(first run, or an earlier install did not finish^). Do NOT close this window...
call npm run engine:install >> "%LOG%" 2>&1
if errorlevel 1 (
    set "REASON=Installing the engine packages failed (check your internet connection)."
    goto :fail
)
call :check_engine
if "%ENG_OK%"=="1" goto :eng_ready
set "REASON=The engine install ended but some engine files are missing. Try again; if it repeats, move the folder to a short path such as C:\RF."
goto :fail
:eng_ready
if not exist "engine\dist\index.js" (
    echo First run: building the engine...
    call npm run engine:build >> "%LOG%" 2>&1
    if errorlevel 1 (
        set "REASON=Building the engine failed."
        goto :fail
    )
)
echo [OK] Engine is ready.

:: 5. Browser for the bot (about 150 MB, asked once if it is not found)
dir /b "%LOCALAPPDATA%\ms-playwright\chromium*" >nul 2>&1
if errorlevel 1 (
    echo The browser used by the bot was not found on this PC.
    choice /c YN /m "Download the browser now (about 150 MB)"
    if not errorlevel 2 (
        call npm run engine:browser >> "%LOG%" 2>&1
        if errorlevel 1 echo [WARNING] The browser download failed. The app still opens, but a run cannot start without it.
    )
)

:: 6. Run the app (this window stays until the app is closed)
echo Starting the app...
call npm run start >> "%LOG%" 2>&1
if errorlevel 1 (
    set "REASON=The app stopped with an error."
    goto :fail
)
echo.
echo SUCCESS: the app was closed normally.
echo Log file: %LOG%
pause
exit /b 0

:check_engine_files
set "ENGF_OK=1"
if not exist "engine\package.json" set "ENGF_OK=0"
if not exist "engine\scripts\api\server.js" set "ENGF_OK=0"
exit /b 0

:check_app
:: A finished install is more than the marker file: the tools must really exist. An install that was cut
:: short can still leave the marker behind, so each tool is checked.
set "APP_OK=1"
if not exist "node_modules\.package-lock.json" set "APP_OK=0"
if not exist "node_modules\rolldown\package.json" set "APP_OK=0"
for %%B in (vite tsc eslint prettier vitest electron esbuild) do if not exist "node_modules\.bin\%%B.cmd" set "APP_OK=0"
exit /b 0

:check_engine
set "ENG_OK=1"
if not exist "engine\node_modules\.package-lock.json" set "ENG_OK=0"
if not exist "engine\node_modules\.bin\tsc.cmd" set "ENG_OK=0"
exit /b 0

:fail
echo.
echo FAILED: %REASON%
echo Log file: %LOG%
echo (The technical details are in the log file.)
pause
exit /b 1
