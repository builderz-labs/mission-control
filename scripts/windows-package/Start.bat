@echo off
setlocal
set "INSTALL_DIR=%~dp0"
if "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR:~0,-1%"

if exist "%INSTALL_DIR%\node\node.exe" (
    "%INSTALL_DIR%\node\node.exe" "%INSTALL_DIR%\launcher.js"
) else (
    where node >nul 2>nul
    if errorlevel 1 (
        echo [Mission Control] No bundled Node.js found and no system Node.js on PATH.
        echo Install Node.js 22 or later from https://nodejs.org and try again.
        exit /b 1
    )
    node "%INSTALL_DIR%\launcher.js"
)
