@echo off
:: TEST.bat - double-click to check the whole project: type-check, lint, formatting and all automated tests.
:: First run: installs the project packages inside THIS folder (nothing global). Needs internet.
:: Output goes to logs\test.log. No passwords, tokens or cookies are written by this file.
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
set "LOG=%CD%\logs\test.log"
echo TEST.bat %DATE% %TIME% > "%LOG%"
set "REASON="
set "ANYFAIL=0"
set "R_TYPES=NOT RUN"
set "R_LINT=NOT RUN"
set "R_FORMAT=NOT RUN"
set "R_TESTS=NOT RUN"

echo.
echo  Rewards Farmer LUCK - test
echo  --------------------------
echo.

:: 1. Node.js 24 or newer
where node >nul 2>&1
if errorlevel 1 (
    set "REASON=Node.js is not installed. Download Node.js 24 or newer from https://nodejs.org/ , install it, then double-click TEST.bat again."
    goto :fail
)
for /f "tokens=1 delims=." %%a in ('node -v') do set "NODEMAJOR=%%a"
set "NODEMAJOR=%NODEMAJOR:v=%"
if %NODEMAJOR% LSS 24 (
    set "REASON=Your Node.js is too old (version %NODEMAJOR%). Download Node.js 24 or newer from https://nodejs.org/ , install it, then double-click TEST.bat again."
    goto :fail
)
echo [OK] Node.js %NODEMAJOR% found.
if not "%CD:~90,1%"=="" (
    echo [WARNING] This folder path is very long. Windows can fail to unpack packages in long paths.
    echo           If the install fails, move the whole project to a short folder such as C:\RF and run again.
)

:: 2. Engine files (some tests use the real engine files)
if not exist "engine\package.json" (
    set "REASON=The engine folder is empty. Double-click START.bat once (it offers to download the engine), then run TEST.bat again."
    goto :fail
)

:: 3. Packages (first run, or an unfinished install)
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

:: 4. The checks. Each one runs even if an earlier one failed, so the summary is complete.
echo Type-check...
call npm run typecheck >> "%LOG%" 2>&1
if errorlevel 1 (
    set "R_TYPES=FAIL"
    set "ANYFAIL=1"
) else (
    set "R_TYPES=PASS"
)
echo Lint...
call npm run lint >> "%LOG%" 2>&1
if errorlevel 1 (
    set "R_LINT=FAIL"
    set "ANYFAIL=1"
) else (
    set "R_LINT=PASS"
)
echo Formatting...
call npm run format:check >> "%LOG%" 2>&1
if errorlevel 1 (
    set "R_FORMAT=FAIL"
    set "ANYFAIL=1"
) else (
    set "R_FORMAT=PASS"
)
echo Automated tests (this takes about a minute)...
call npm run test >> "%LOG%" 2>&1
if errorlevel 1 (
    set "R_TESTS=FAIL"
    set "ANYFAIL=1"
) else (
    set "R_TESTS=PASS"
)

echo.
echo  Type-check : %R_TYPES%
echo  Lint       : %R_LINT%
echo  Formatting : %R_FORMAT%
echo  Tests      : %R_TESTS%
echo.
if "%ANYFAIL%"=="1" (
    set "REASON=At least one check failed. Open the log file to see which one and why."
    goto :fail
)
echo SUCCESS: all checks passed.
echo Log file: %LOG%
pause
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
