# Run as Administrator: right-click PowerShell → Run as administrator, then:
#   cd "C:\Users\IshaanSatapathy\Desktop\Corsair Hackathon"
#   .\scripts\reset-postgres-dev.ps1

$ErrorActionPreference = "Stop"

$serviceName = "postgresql-x64-18"
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$hbaPath = "C:\Program Files\PostgreSQL\18\data\pg_hba.conf"
$bakPath = "$hbaPath.threadbak"

if (-not (Test-Path $pgBin)) {
  Write-Error "PostgreSQL 18 not found at $pgBin"
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
  Write-Error "Run this script in an Administrator PowerShell window."
}

Write-Host "Stopping PostgreSQL..."
Stop-Service $serviceName -Force

if (-not (Test-Path $bakPath)) {
  Copy-Item $hbaPath $bakPath -Force
  Write-Host "Backed up pg_hba.conf"
}

$content = Get-Content $hbaPath -Raw
$content = $content -replace "scram-sha-256", "trust"
[System.IO.File]::WriteAllText($hbaPath, $content)

Write-Host "Starting PostgreSQL (trust auth temporarily)..."
Start-Service $serviceName
Start-Sleep -Seconds 3

$psql = Join-Path $pgBin "psql.exe"
& $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';"
$dbExists = & $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='dev'"
if ($dbExists.Trim() -ne "1") {
  & $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -c "CREATE DATABASE dev;"
  Write-Host "Created database 'dev'"
}

Write-Host "Restoring pg_hba.conf..."
Copy-Item $bakPath $hbaPath -Force

Write-Host "Restarting PostgreSQL..."
Restart-Service $serviceName -Force
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Done. DATABASE_URL should be:"
Write-Host "  postgresql://postgres:postgres@localhost:5432/dev"
Write-Host ""
Write-Host "Restart dev server: pnpm dev"
