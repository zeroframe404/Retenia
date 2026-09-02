@echo off
rem Best-effort fallback for shells without bash. See CLAUDE.md > Windows.
where bash >nul 2>nul
if %errorlevel%==0 (
  bash "%~dp0format.sh"
)
exit /b 0
