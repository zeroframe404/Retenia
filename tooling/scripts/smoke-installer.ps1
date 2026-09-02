#Requires -Version 5.1
<#
.SYNOPSIS
  Installer smoke test for the Retenia NSIS build (sub-phase 14.3 wires this into CI).

.DESCRIPTION
  Installs the packaged Windows artifact silently, launches it, waits for the main
  process's "ready" log line, kills it, then uninstalls silently. Fails (non-zero exit)
  on any missing artifact, a launch that never reaches "ready" within -TimeoutSeconds, or
  an install/uninstall exit code NSIS did not report as success.

.PARAMETER InstallerPath
  Path to the built NSIS installer. Defaults to the single `*.exe` electron-builder
  produces under apps/desktop/dist (see apps/desktop/electron-builder.yml's
  `artifactName`); pass it explicitly when more than one artifact/arch is present.

.PARAMETER TimeoutSeconds
  How long to wait for the "ready" line in the main process log before failing.

.EXAMPLE
  pwsh tooling/scripts/smoke-installer.ps1
#>
[CmdletBinding()]
param(
  [string]$InstallerPath,
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$productName = 'Retenia'
$exeName = 'retenia.exe'

function Resolve-InstallerPath {
  param([string]$Explicit)

  if ($Explicit) {
    if (-not (Test-Path $Explicit)) {
      throw "Installer not found at explicit path: $Explicit"
    }
    return (Resolve-Path $Explicit).Path
  }

  $distDir = Join-Path $repoRoot 'apps\desktop\dist'
  if (-not (Test-Path $distDir)) {
    throw "Build output not found: $distDir (run 'pnpm build' first)"
  }

  $candidates = Get-ChildItem -Path $distDir -Filter '*.exe' -File
  if ($candidates.Count -eq 0) {
    throw "No .exe installer found under $distDir"
  }
  if ($candidates.Count -gt 1) {
    $names = ($candidates | ForEach-Object { $_.Name }) -join ', '
    throw "Multiple installers found under $distDir ($names) — pass -InstallerPath explicitly."
  }

  return $candidates[0].FullName
}

function Get-InstallDir {
  # electron-builder's default per-user NSIS install dir (nsis.perMachine: false in
  # electron-builder.yml) is %LOCALAPPDATA%\Programs\<productName>.
  return Join-Path $env:LOCALAPPDATA "Programs\$productName"
}

function Get-LogPath {
  # electron-log's default Windows path, matched by apps/desktop/src/main/logging/log.ts.
  return Join-Path $env:USERPROFILE "AppData\Roaming\$productName\logs\main.log"
}

$installer = Resolve-InstallerPath -Explicit $InstallerPath
Write-Host "Installer: $installer"

Write-Host 'Installing silently (/S)...'
$install = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
if ($install.ExitCode -ne 0) {
  throw "Installer exited with code $($install.ExitCode)"
}

$installDir = Get-InstallDir
$exePath = Join-Path $installDir $exeName
if (-not (Test-Path $exePath)) {
  throw "Expected installed executable not found: $exePath"
}
Write-Host "Installed at: $exePath"

$logPath = Get-LogPath
if (Test-Path $logPath) {
  # Start from a clean slate so a previous run's "ready" line can't produce a false pass.
  Remove-Item $logPath -Force
}

Write-Host 'Launching app...'
$appProcess = Start-Process -FilePath $exePath -PassThru

try {
  Write-Host "Waiting up to ${TimeoutSeconds}s for the 'ready' log line..."
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ((Test-Path $logPath) -and (Select-String -Path $logPath -Pattern 'ready' -Quiet)) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "Timed out waiting for 'ready' in $logPath"
  }
  Write-Host "App reported ready."
}
finally {
  if (-not $appProcess.HasExited) {
    Write-Host 'Killing app process...'
    Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'Uninstalling silently (/S)...'
$uninstaller = Join-Path $installDir 'Uninstall Retenia.exe'
if (-not (Test-Path $uninstaller)) {
  throw "Uninstaller not found: $uninstaller"
}
$uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
if ($uninstall.ExitCode -ne 0) {
  throw "Uninstaller exited with code $($uninstall.ExitCode)"
}

Write-Host 'Installer smoke test passed.'
