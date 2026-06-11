# Symlink .env into apps/* and packages/* (Windows PowerShell)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "..")

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
} else {
  Write-Host ".env already exists"
}

Get-ChildItem -Path "apps", "packages" -Directory | ForEach-Object {
  $target = Join-Path $_.FullName ".env"
  $source = (Resolve-Path ".env").Path

  if (Test-Path $target) {
    return
  }

  New-Item -ItemType SymbolicLink -Path $target -Target $source | Out-Null
  Write-Host "Linked .env -> $($_.Name)"
}

Write-Host "Setup complete."
