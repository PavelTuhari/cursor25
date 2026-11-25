<#
.SYNOPSIS
    Installs una-efactura as a Windows service.

.DESCRIPTION
    Windows has no supervisor of its own for a plain executable, so this uses
    NSSM (https://nssm.cc) - a single 300 KB binary - to wrap `node dist/src/main.js`.
    Run from an elevated PowerShell in the service directory.

.EXAMPLE
    .\deploy\windows\install-service.ps1 -InstallDir "C:\Program Files\una-efactura" -EnvFile "C:\ProgramData\una-efactura\efactura.env"
#>
[CmdletBinding()]
param(
    [string]$ServiceName = "una-efactura",
    [string]$InstallDir  = (Get-Location).Path,
    [string]$EnvFile     = "C:\ProgramData\una-efactura\efactura.env",
    [string]$NssmPath    = "nssm.exe"
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this from an elevated PowerShell - registering a service needs administrator rights."
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node.exe is not on PATH. Install Node.js 22 or newer first." }

$entry = Join-Path $InstallDir "dist\src\main.js"
if (-not (Test-Path $entry)) { throw "$entry not found. Run 'npm run build' before installing." }
if (-not (Test-Path $EnvFile)) { throw "$EnvFile not found. Copy .env.example there and fill it in." }

$logDir = Join-Path $InstallDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Service $ServiceName already exists - stopping and reconfiguring."
    & $NssmPath stop $ServiceName confirm | Out-Null
} else {
    & $NssmPath install $ServiceName $node $entry
}

& $NssmPath set $ServiceName AppDirectory   $InstallDir
& $NssmPath set $ServiceName DisplayName    "UNA e-Factura integration service"
& $NssmPath set $ServiceName Description    "Sends fiscal invoices to SIA e-Factura (SFS.md) and tracks their status."
& $NssmPath set $ServiceName Start          SERVICE_AUTO_START
& $NssmPath set $ServiceName AppStdout      (Join-Path $logDir "service.log")
& $NssmPath set $ServiceName AppStderr      (Join-Path $logDir "service.err.log")
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760
# SIGTERM equivalent, then a grace period so an in-flight tick can finish.
& $NssmPath set $ServiceName AppStopMethodConsole 45000

# Environment: NSSM wants one NUL-free block of KEY=VALUE lines.
$pairs = Get-Content $EnvFile |
    Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' -and $_ -notmatch '^\s*#' } |
    ForEach-Object { $_.Trim() }
& $NssmPath set $ServiceName AppEnvironmentExtra $pairs

& $NssmPath start $ServiceName
Write-Host "Installed and started $ServiceName."
Write-Host "Check it with: Invoke-RestMethod http://127.0.0.1:8090/efactura/v1/health"
