@echo off
setlocal
title IDEalize PC build
echo Building the IDEalize Windows installer. This window stays open until it finishes.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
echo.
if errorlevel 1 (
  echo The build stopped. Please send OUTPUT\build-log.txt to JJ.
) else (
  echo Done. Please send everything in the OUTPUT folder to JJ.
)
echo.
pause
