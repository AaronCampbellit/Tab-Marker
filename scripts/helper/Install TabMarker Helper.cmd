@echo off
setlocal DisableDelayedExpansion
title Install TabMarker Helper
echo Installing the TabMarker update helper...
echo.
if not exist "%~dp0Install-TabMarkerHelper.ps1" (
  echo Setup files are missing. Right-click the downloaded ZIP and choose Extract All.
  echo Then open the extracted folder and double-click Install TabMarker Helper.cmd.
  if not defined TABMARKER_SETUP_NO_PAUSE pause
  exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -File "%~dp0Install-TabMarkerHelper.ps1" %*
set "TabMarkerSetupExit=%ERRORLEVEL%"
echo.
if "%TabMarkerSetupExit%"=="0" (
  echo Done. Return to TabMarker Settings to connect the helper.
) else (
  echo Setup did not finish. See the message above and the setup log, if shown.
  echo If your organization blocks setup, ask IT to approve it.
)
if not defined TABMARKER_SETUP_NO_PAUSE pause
exit /b %TabMarkerSetupExit%
