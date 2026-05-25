# AgentLens Quick Start —Start all services (Windows)
# Usage: .\start-all.ps1

$projectRoot = Split-Path -parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "AgentLens Quick Start" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

Write-Host "Starting Docker containers (PostgreSQL, Redis, MinIO)..." -ForegroundColor Yellow
docker-compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker Compose failed. Ensure Docker is running." -ForegroundColor Red
    exit 1
}

Write-Host "Docker containers started" -ForegroundColor Green
Write-Host "Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host "Start backend in a new terminal:" -ForegroundColor Yellow
Write-Host "   pnpm --filter api-ts dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Start frontend in another terminal:" -ForegroundColor Yellow
Write-Host "   `$env:NEXT_PUBLIC_API_URL='http://localhost:8001'; `$env:NEXT_PUBLIC_WS_URL='ws://localhost:8001'; pnpm --filter web dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Access points:" -ForegroundColor Green
Write-Host "   Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "   Backend API: http://localhost:8001" -ForegroundColor Cyan
Write-Host "   WebSocket: ws://localhost:8001/ws/missions/<mission-id>" -ForegroundColor Cyan
Write-Host ""
Write-Host "Run the demo:" -ForegroundColor Green
Write-Host "   python examples\hitl_release_gate_demo.py" -ForegroundColor Cyan
Write-Host "   python examples\hitl_incident_response_demo.py" -ForegroundColor Cyan
Write-Host ""
Write-Host "Stop infrastructure:" -ForegroundColor Yellow
Write-Host "   docker-compose down" -ForegroundColor Cyan
