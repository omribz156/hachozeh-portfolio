@echo off
setlocal

set "SCRIPT=D:\projects\Navi\scripts\check-wsl-pressure-win.ps1"
set "SAVE_PATH=%USERPROFILE%\Desktop\wsl-pressure.txt"

if /I "%~1"=="--save" goto :save

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"

if /I "%~1"=="--no-pause" goto :done

echo.
pause

:save
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '%SCRIPT%' | Out-File '%SAVE_PATH%' -Encoding utf8"
echo Saved report to "%SAVE_PATH%"
if /I "%~2"=="--no-pause" goto :done

echo.
pause

:done
endlocal
