@echo off
rem CryptChat launcher: installs dependencies on first run, then starts the app.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERR] Node.js is required. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo [SYS] First run: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERR] npm install failed.
    pause
    exit /b 1
  )
)

call npm start
