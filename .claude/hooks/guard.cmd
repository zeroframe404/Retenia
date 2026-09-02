@echo off
rem Best-effort fallback for shells without bash. See CLAUDE.md > Windows.
where bash >nul 2>nul
if %errorlevel%==0 (
  bash "%~dp0guard.sh"
  exit /b %errorlevel%
)
exit /b 0
