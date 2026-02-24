@echo off
REM Enterprise AI Red Team Platform — Windows Installer
REM Usage: scripts\install.bat

setlocal enabledelayedexpansion

echo.
echo ============================================
echo   Enterprise AI Red Team Platform Setup
echo ============================================
echo.

REM ─── Check Docker ────────────────────────────────────────────────────────────
echo [1/5] Checking prerequisites...

where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not installed or not in PATH.
    echo Install Docker Desktop from: https://docs.docker.com/desktop/windows/
    exit /b 1
)

docker compose version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker Compose v2 not found.
    echo Update Docker Desktop or install the Compose plugin.
    exit /b 1
)

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker daemon is not running. Start Docker Desktop.
    exit /b 1
)
echo [OK] Docker is ready.

REM ─── Setup .env ──────────────────────────────────────────────────────────────
echo.
echo [2/5] Configuring environment...

if not exist ".env" (
    if not exist ".env.example" (
        echo ERROR: .env.example not found. Run from the project root directory.
        exit /b 1
    )
    copy ".env.example" ".env" >nul
    echo [OK] Created .env from .env.example

    REM Generate a random JWT_SECRET using PowerShell
    for /f "delims=" %%i in ('powershell -Command "[System.BitConverter]::ToString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).Replace('-','').ToLower()"') do (
        set JWT_SECRET=%%i
    )
    powershell -Command "(Get-Content .env) -replace 'JWT_SECRET=.*', 'JWT_SECRET=!JWT_SECRET!' | Set-Content .env"
    echo [OK] Generated secure JWT_SECRET

    echo [WARN] Review .env and add your ANTHROPIC_API_KEY for AI features.
) else (
    echo [OK] .env already exists.
)

if not exist "data\reports" mkdir data\reports
if not exist "keys" mkdir keys
if not exist "logs" mkdir logs
echo [OK] Created required directories.

REM ─── Build images ────────────────────────────────────────────────────────────
echo.
echo [3/5] Building Docker images (3-8 min on first run)...
docker compose build
if %errorlevel% neq 0 (
    echo ERROR: Docker build failed. Check the error above.
    exit /b 1
)
echo [OK] Images built.

REM ─── Start services ──────────────────────────────────────────────────────────
echo.
echo [4/5] Starting services...
docker compose up -d
if %errorlevel% neq 0 (
    echo ERROR: Failed to start services.
    exit /b 1
)
echo [OK] Services started.

REM ─── Wait for health ─────────────────────────────────────────────────────────
echo.
echo [5/5] Waiting for the platform to be ready...
set /a attempt=0
:health_loop
set /a attempt+=1
if %attempt% gtr 20 (
    echo [WARN] Health check timed out. Check: docker compose logs -f app
    goto success
)
powershell -Command "try { Invoke-WebRequest -Uri 'http://localhost:15500/api/health' -UseBasicParsing -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto success
echo Waiting...
timeout /t 3 /nobreak >nul
goto health_loop

:success
echo.
echo ============================================
echo            Setup Complete!
echo ============================================
echo.
echo   Platform URL:  http://localhost:15500
echo.
echo   Next steps:
echo     1. Open http://localhost:15500 in your browser
echo     2. Complete the setup wizard
echo     3. Create a project and run your first scan
echo.
echo   Commands:
echo     docker compose logs -f    - view logs
echo     docker compose ps         - service status
echo     docker compose down       - stop services
echo.

endlocal
