@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo   PageNest - First Run Setup
echo   =========================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap\bootstrap.ps1"

if errorlevel 1 (
  echo.
  echo Initialization failed. Please check the message above.
  echo Log: %~dp0runtime\bootstrap.log
  echo.
  pause
)

endlocal
