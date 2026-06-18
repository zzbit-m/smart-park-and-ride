# Smart Park & Ride - Stop Script for PowerShell

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "       Smart Park & Ride Stopper         " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Stop Docker containers
Write-Host "[1/2] Spinning down Docker containers..." -ForegroundColor Yellow
docker-compose down
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Failed to spin down containers cleanly via docker-compose." -ForegroundColor Red
} else {
    Write-Host "    -> All containers stopped and removed." -ForegroundColor Green
}

# 2. Clean up logs
Write-Host "[2/2] Cleaning up temporary files and logs..." -ForegroundColor Yellow
$logFile = Join-Path $PSScriptRoot "cloudflared.log"
if (Test-Path $logFile) {
    Remove-Item $logFile -Force
    Write-Host "    -> Deleted cloudflared.log" -ForegroundColor Green
} else {
    Write-Host "    -> No log files to clean." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Cleanup complete! All services stopped." -ForegroundColor Green
Start-Sleep -Seconds 2
