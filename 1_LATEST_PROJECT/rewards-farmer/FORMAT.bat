@echo off
:: FORMAT.bat - double-click to tidy the code style (runs "prettier --write" on src and tests). Changes only the layout of code files.
:: It never touches config.json, accounts, sessions or logs. Needs the packages: run TEST.bat or START.bat once first.
:: Output goes to logs\format.log. No passwords, tokens or cookies are written by this file.
setlocal EnableExtensions
cd /d "%~dp0"
if not exist logs mkdir logs
set "LOG=%CD%\logs\format.log"
echo FORMAT.bat %DATE% %TIME% > "%LOG%"
echo.
echo  Rewards Farmer LUCK - format code
echo  ---------------------------------
echo.
if not exist "node_modules\.bin\prettier.cmd" (
    echo FAILED: The project packages are not installed yet. Double-click TEST.bat once ^(it installs them^), then run FORMAT.bat again.
    echo Log file: %LOG%
    pause
    exit /b 1
)
call node_modules\.bin\prettier.cmd --write src tests >> "%LOG%" 2>&1
if errorlevel 1 (
    echo FAILED: Prettier could not finish. Open the log file to see why.
    echo Log file: %LOG%
    pause
    exit /b 1
)
echo SUCCESS: the code style is tidy. Now double-click TEST.bat to check everything.
echo Log file: %LOG%
pause
exit /b 0
