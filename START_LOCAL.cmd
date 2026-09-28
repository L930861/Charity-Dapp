@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer before continuing.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 exit /b 1
echo Open http://localhost:3001 after the ready message. Keep this window open.
call npm run demo
pause
