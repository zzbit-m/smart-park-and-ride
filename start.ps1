# Smart Park & Ride - Startup Script for PowerShell

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "       Smart Park & Ride Starter         " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Start Docker containers
Write-Host "[1/4] Starting Docker services (Postgres, Redis, Backend, Worker)..." -ForegroundColor Yellow
docker-compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start docker-compose services. Make sure Docker Desktop is running." -ForegroundColor Red
    Exit 1
}

# 2. Await Backend healthcheck readiness (wait for Postgres and Redis to connect)
Write-Host "[2/4] Awaiting API gateway healthcheck (http://localhost:8000/health)..." -ForegroundColor Yellow
$healthy = $false
$max_attempts = 15
for ($i = 1; $i -le $max_attempts; $i++) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:8000/health" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.status -eq "ok" -and $response.checks.postgres -eq $true -and $response.checks.redis -eq $true) {
            $healthy = $true
            break
        }
    } catch {
        # Keep waiting
    }
    Write-Host "    -> Waiting for services to connect (attempt $i/$max_attempts)..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
}

if (-not $healthy) {
    Write-Host "ERROR: Backend API health check failed or services did not initialize in time." -ForegroundColor Red
    Write-Host "Please check backend logs: docker-compose logs backend" -ForegroundColor Yellow
    Exit 1
}
Write-Host "    -> API is online and fully healthy!" -ForegroundColor Green

# 3. Run database migrations
Write-Host "[3/4] Running database migrations inside backend container..." -ForegroundColor Yellow
docker-compose exec -T backend alembic upgrade head
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Database migration failed." -ForegroundColor Red
    Exit 1
}
Write-Host "    -> Database schema is up-to-date!" -ForegroundColor Green

# 4. Cloudflare Tunnel
Write-Host ""
$startTunnel = Read-Host "Do you want to start a Cloudflare tunnel? (y/N)"
$cfProcess = $null
if ($startTunnel -eq "y" -or $startTunnel -eq "Y") {
    Write-Host "[4/4] Starting Cloudflare tunnel and retrieving URL..." -ForegroundColor Yellow
    $logFile = Join-Path $PSScriptRoot "cloudflared.log"
    if (Test-Path $logFile) { Remove-Item $logFile -Force }

    $cfProcess = Start-Process cloudflared -ArgumentList "tunnel", "--url", "http://localhost:8000" -NoNewWindow -PassThru -RedirectStandardError $logFile

    # Wait for the tunnel URL to appear in the log (up to 15 seconds)
    $tunnelUrl = $null
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $logFile) {
            $content = Get-Content $logFile -ErrorAction SilentlyContinue
            # Cloudflare quick tunnel URLs look like: https://xxxx.trycloudflare.com
            $match = $content | Select-String -Pattern "https://[a-zA-Z0-9-]+\.trycloudflare\.com"
            if ($match) {
                $tunnelUrl = $match.Matches[0].Value
                break
            }
        }
    }

    if ($tunnelUrl) {
        # Copy the main URL to clipboard
        Set-Clipboard -Value $tunnelUrl -ErrorAction SilentlyContinue

        Write-Host ""
        Write-Host "==========================================================" -ForegroundColor Green
        Write-Host "  CLOUDFLARE TUNNEL IS ACTIVE!" -ForegroundColor Green
        Write-Host "  Your public base URL is: " -ForegroundColor Green -NoNewline
        Write-Host $tunnelUrl -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Rider Portal (Mobile):  " -ForegroundColor Green -NoNewline
        Write-Host "$tunnelUrl/" -ForegroundColor Cyan
        Write-Host "  Operator Dashboard:     " -ForegroundColor Green -NoNewline
        Write-Host "$tunnelUrl/admin.html" -ForegroundColor Cyan
        Write-Host "  Layout Manager SPA:     " -ForegroundColor Green -NoNewline
        Write-Host "$tunnelUrl/admin-layout/" -ForegroundColor Cyan
        Write-Host "==========================================================" -ForegroundColor Green
        Write-Host "  [COPIED] Public base URL has been copied to your clipboard!" -ForegroundColor Green
        Write-Host "  [TIP] DO NOT close this window or press Ctrl+C (it kills the tunnel)." -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-Host "WARNING: Failed to retrieve the tunnel URL automatically." -ForegroundColor Red
        Write-Host "Check 'cloudflared.log' to find the URL manually." -ForegroundColor Yellow
    }
} else {
    Write-Host "[4/4] Skipping Cloudflare tunnel." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "All systems successfully launched!" -ForegroundColor Green
if ($cfProcess) {
    Write-Host "Press any key to stop the Cloudflare tunnel and exit..." -ForegroundColor Yellow
} else {
    Write-Host "Press any key to exit..."
}

$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Stop the cloudflared process on exit
if ($cfProcess -and -not $cfProcess.HasExited) {
    Write-Host "Stopping Cloudflare tunnel..." -ForegroundColor Yellow
    Stop-Process -Id $cfProcess.Id -Force
}
