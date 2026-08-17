@echo off
REM ============================================================
REM  Seven Hand Poker - one-click dev server launcher
REM  Double-click this file to (re)start the local dev server.
REM  Mirrors the "check then start" flow: it first frees port
REM  5183 (kills any stale server so --strictPort won't fail),
REM  starts a fresh server in its own window, then opens the
REM  browser. Close that server window (or press Ctrl+C in it)
REM  to stop the server.
REM ============================================================

cd /d "%~dp0"

echo [1/3] Freeing port 5183 if a previous server is still running...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5183 " ^| findstr "LISTENING"') do (
  echo       stopping old server (PID %%p)
  taskkill /F /PID %%p >nul 2>&1
)

echo [2/3] Starting the dev server in a new window...
start "SHP dev server" cmd /k "npm run dev"

echo [3/3] Opening the browser (waiting a few seconds for Vite)...
timeout /t 4 /nobreak >nul
start "" http://localhost:5183

echo.
echo Done. The server runs in the "SHP dev server" window.
echo Close that window to stop it.
timeout /t 3 /nobreak >nul
