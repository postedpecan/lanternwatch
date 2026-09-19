param(
  [string]$StorageRoot,
  [string]$DatabasePath,
  [string]$VaultPath,
  [string]$RuntimeConfigPath
)

$ErrorActionPreference = 'Stop'

$userHome = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($env:HOME) { $env:HOME } else { [Environment]::GetFolderPath('UserProfile') }
if ([string]::IsNullOrWhiteSpace($userHome)) { throw 'Unable to resolve the current user profile directory.' }

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot '.env.local'

function Get-ProjectEnvironmentValue([string]$Name) {
  if (-not (Test-Path -LiteralPath $environmentFile)) { return $null }
  foreach ($line in Get-Content -LiteralPath $environmentFile -Encoding UTF8) {
    if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*)\s*$')) {
      $value = $Matches[1].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($DatabasePath)) {
  $DatabasePath = if ($env:LANTERNWATCH_DB_PATH) { $env:LANTERNWATCH_DB_PATH } else { Get-ProjectEnvironmentValue 'LANTERNWATCH_DB_PATH' }
}
if ([string]::IsNullOrWhiteSpace($StorageRoot)) {
  $StorageRoot = if ($env:LANTERNWATCH_STORAGE_ROOT) { $env:LANTERNWATCH_STORAGE_ROOT } else { Get-ProjectEnvironmentValue 'LANTERNWATCH_STORAGE_ROOT' }
}
if ([string]::IsNullOrWhiteSpace($StorageRoot)) {
  $StorageRoot = if ($DatabasePath) { Split-Path -Parent $DatabasePath } else { Join-Path $userHome '.lanternwatch' }
}
if ([string]::IsNullOrWhiteSpace($DatabasePath)) { $DatabasePath = Join-Path $StorageRoot 'guild.db' }
if ([string]::IsNullOrWhiteSpace($VaultPath)) {
  $VaultPath = if ($env:LANTERNWATCH_VAULT_PATH) { $env:LANTERNWATCH_VAULT_PATH } else { Get-ProjectEnvironmentValue 'LANTERNWATCH_VAULT_PATH' }
}
if ($null -eq $VaultPath) { $VaultPath = '' }

$StorageRoot = [IO.Path]::GetFullPath($StorageRoot)
$DatabasePath = [IO.Path]::GetFullPath($DatabasePath)
if ($VaultPath) { $VaultPath = [IO.Path]::GetFullPath($VaultPath) }
if ([string]::IsNullOrWhiteSpace($RuntimeConfigPath)) {
  $RuntimeConfigPath = if ($env:LANTERNWATCH_CONFIG_PATH) { $env:LANTERNWATCH_CONFIG_PATH } else { Join-Path (Join-Path $userHome '.lanternwatch') 'config.json' }
}
$RuntimeConfigPath = [IO.Path]::GetFullPath($RuntimeConfigPath)

$configurationDirectory = Split-Path -Parent $RuntimeConfigPath
$backupDirectory = Join-Path $configurationDirectory 'backups'
New-Item -ItemType Directory -Force -Path @($configurationDirectory, $StorageRoot, (Split-Path -Parent $DatabasePath), $backupDirectory) | Out-Null
if ($VaultPath) { New-Item -ItemType Directory -Force -Path $VaultPath | Out-Null }

if (Test-Path -LiteralPath $RuntimeConfigPath) {
  $backupPath = Join-Path $backupDirectory ("runtime-" + (Get-Date -Format 'yyyyMMdd-HHmmssfff') + '.json')
  Copy-Item -LiteralPath $RuntimeConfigPath -Destination $backupPath
}

$configuration = [ordered]@{
  storageRoot = $StorageRoot
  databasePath = $DatabasePath
  vaultPath = $VaultPath
}
$temporaryPath = "$RuntimeConfigPath.$PID.tmp"
[IO.File]::WriteAllText($temporaryPath, ($configuration | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporaryPath -Destination $RuntimeConfigPath -Force

Write-Output 'Lanternwatch runtime paths repaired without changing hooks, trust records, or notifier configuration.'
Write-Output "Runtime config: $RuntimeConfigPath"
Write-Output "Storage root: $StorageRoot"
Write-Output "Database: $DatabasePath"
Write-Output 'Fully exit Codex/ChatGPT and bundled codex.exe processes, reopen, and start a fresh chat for real hook activation proof.'
