param(
  [switch]$Force,
  [switch]$Confirm,
  [switch]$RestartDashboard,
  [string]$CodexRoot,
  [string]$StorageRoot,
  [string]$DatabasePath,
  [string]$VaultPath,
  [string]$RuntimeConfigPath,
  [string]$NodeExecutable,
  [string]$TestScriptRoot
)

$ErrorActionPreference = 'Stop'

function Get-ProjectEnvironmentValue([string]$Name, [string]$EnvironmentFile) {
  if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { return $null }
  foreach ($line in Get-Content -LiteralPath $EnvironmentFile -Encoding UTF8) {
    if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*)\s*$')) {
      $value = $Matches[1].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        return $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

function Resolve-NodeExecutable([string]$RequestedExecutable) {
  $nodeCommand = if ([string]::IsNullOrWhiteSpace($RequestedExecutable)) {
    Get-Command node -ErrorAction SilentlyContinue
  } elseif (Test-Path -LiteralPath $RequestedExecutable -PathType Leaf) {
    Get-Item -LiteralPath $RequestedExecutable
  } else {
    Get-Command $RequestedExecutable -ErrorAction SilentlyContinue
  }
  if (-not $nodeCommand) { throw 'node.exe was not found on PATH; install Node.js before running recovery.' }
  return [IO.Path]::GetFullPath($(if ($nodeCommand.Source) { $nodeCommand.Source } else { $nodeCommand.FullName }))
}

function Invoke-PowerShellRecoveryStage([string]$Name, [string]$ScriptPath, [hashtable]$Parameters) {
  Write-Output "[$Name] Starting."
  & $ScriptPath @Parameters
  if (-not $?) { throw "Recovery stage failed: $Name" }
  Write-Output "[$Name] Complete."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot '.env.local'
$userHome = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($env:HOME) { $env:HOME } else { [Environment]::GetFolderPath('UserProfile') }
if ([string]::IsNullOrWhiteSpace($userHome)) { throw 'Unable to resolve the current user profile directory.' }

$hasConfirmation = $Confirm.IsPresent
if ($Force.IsPresent -ne $hasConfirmation) {
  throw 'Real recovery requires both -Force and -Confirm. Run with no flags for a non-mutating preflight.'
}
$executeRecovery = $Force.IsPresent -and $hasConfirmation

if ([string]::IsNullOrWhiteSpace($CodexRoot)) {
  $CodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $userHome '.codex' }
}
if ([string]::IsNullOrWhiteSpace($DatabasePath)) {
  $DatabasePath = if ($env:LANTERNWATCH_DB_PATH) { $env:LANTERNWATCH_DB_PATH } else { Get-ProjectEnvironmentValue 'LANTERNWATCH_DB_PATH' $environmentFile }
}
if ([string]::IsNullOrWhiteSpace($StorageRoot)) {
  $StorageRoot = if ($env:LANTERNWATCH_STORAGE_ROOT) { $env:LANTERNWATCH_STORAGE_ROOT } else { Get-ProjectEnvironmentValue 'LANTERNWATCH_STORAGE_ROOT' $environmentFile }
}
if ([string]::IsNullOrWhiteSpace($StorageRoot)) {
  $StorageRoot = if ($DatabasePath) { Split-Path -Parent $DatabasePath } else { Join-Path $userHome '.lanternwatch' }
}
if ([string]::IsNullOrWhiteSpace($DatabasePath)) { $DatabasePath = Join-Path $StorageRoot 'guild.db' }
if ([string]::IsNullOrWhiteSpace($VaultPath)) {
  $VaultPath = if ($env:LANTERNWATCH_VAULT_PATH) { $env:LANTERNWATCH_VAULT_PATH } else { Get-ProjectEnvironmentValue 'LANTERNWATCH_VAULT_PATH' $environmentFile }
}
if ($null -eq $VaultPath) { $VaultPath = '' }
if ([string]::IsNullOrWhiteSpace($RuntimeConfigPath)) {
  $RuntimeConfigPath = if ($env:LANTERNWATCH_CONFIG_PATH) { $env:LANTERNWATCH_CONFIG_PATH } else { Join-Path (Join-Path $userHome '.lanternwatch') 'config.json' }
}

$CodexRoot = [IO.Path]::GetFullPath($CodexRoot)
$StorageRoot = [IO.Path]::GetFullPath($StorageRoot)
$DatabasePath = [IO.Path]::GetFullPath($DatabasePath)
$RuntimeConfigPath = [IO.Path]::GetFullPath($RuntimeConfigPath)
if ($VaultPath) { $VaultPath = [IO.Path]::GetFullPath($VaultPath) }
$NodeExecutable = Resolve-NodeExecutable $NodeExecutable

$scriptRoot = if ([string]::IsNullOrWhiteSpace($TestScriptRoot)) { $PSScriptRoot } else { [IO.Path]::GetFullPath($TestScriptRoot) }
$runtimeRepairScript = Join-Path $scriptRoot 'repair-lanternwatch-runtime.ps1'
$codexRehookScript = Join-Path $scriptRoot 'reinstall-lanternwatch-hooks.ps1'
$notifierRepairScript = Join-Path $scriptRoot 'repair-lanternwatch-notifier.mjs'
$restartScript = Join-Path $scriptRoot 'restart-lanternwatch-hosts.ps1'
$requiredScripts = @($runtimeRepairScript, $codexRehookScript, $notifierRepairScript, $restartScript)
foreach ($requiredScript in $requiredScripts) {
  if (-not (Test-Path -LiteralPath $requiredScript -PathType Leaf)) { throw "Required recovery script not found: $requiredScript" }
}

$codexConfigPath = Join-Path $CodexRoot 'config.toml'
$notifierConfigPath = Join-Path $CodexRoot 'lanternwatch-notifier.json'
if (-not (Test-Path -LiteralPath $codexConfigPath -PathType Leaf)) {
  throw "Codex configuration not found: $codexConfigPath. Run npm run guild:install first."
}

Write-Warning 'Save all work before real recovery. -Force -Confirm will force-close allowed ChatGPT and Codex host processes; unsaved chats and work can be lost.'
Write-Output "Mode: $(if ($executeRecovery) { 'REPAIR AND RESTART' } else { 'DRY-RUN PREFLIGHT (no files or processes will be changed)' })"
Write-Output "Storage root: $StorageRoot"
Write-Output "Database: $DatabasePath"
Write-Output "Vault: $(if ($VaultPath) { $VaultPath } else { '(disabled)' })"
Write-Output "Runtime config: $RuntimeConfigPath"
Write-Output "Codex root: $CodexRoot"
Write-Output "Expected lifecycle receipt: $(Join-Path (Join-Path $StorageRoot 'logs') 'hook.jsonl')"
Write-Output 'Repair order: runtime paths -> Codex hooks -> obsolete notifier -> guarded Codex-host restart.'

if (-not $executeRecovery) {
  Write-Output 'Preflight complete. No repair scripts ran, no configuration changed, and no process was stopped or launched.'
  Write-Output 'To execute after saving all work: npm run guild:recover -- -Force -Confirm'
  if ($RestartDashboard) { Write-Output 'Dashboard restart requested for a future real run; this preview did not inspect or restart it.' }
  return
}

# Every child receives one authoritative tuple, including stages that only use
# part of it. The hook runtime reads the same environment after the runtime
# configuration is written.
$env:LANTERNWATCH_STORAGE_ROOT = $StorageRoot
$env:LANTERNWATCH_DB_PATH = $DatabasePath
$env:LANTERNWATCH_VAULT_PATH = $VaultPath
$env:LANTERNWATCH_CONFIG_PATH = $RuntimeConfigPath

try {
  Invoke-PowerShellRecoveryStage 'runtime-repair' $runtimeRepairScript @{
    StorageRoot = $StorageRoot
    DatabasePath = $DatabasePath
    VaultPath = $VaultPath
    RuntimeConfigPath = $RuntimeConfigPath
  }
  Invoke-PowerShellRecoveryStage 'codex-rehook' $codexRehookScript @{
    CodexRoot = $CodexRoot
    NodeExecutable = $NodeExecutable
  }

  Write-Output '[notifier-repair] Starting.'
  & $NodeExecutable $notifierRepairScript $codexConfigPath $notifierConfigPath
  if ($LASTEXITCODE -ne 0) { throw "Recovery stage failed: notifier-repair (exit code $LASTEXITCODE)" }
  Write-Output '[notifier-repair] Complete.'

  $restartParameters = @{ Force = $true; Confirm = $true; CodexOnly = $true }
  if ($RestartDashboard) { $restartParameters.RestartDashboard = $true }
  Invoke-PowerShellRecoveryStage 'host-restart' $restartScript $restartParameters
} catch {
  [Console]::Error.WriteLine("Lanternwatch recovery stopped before any later stage ran. Hosts were not restarted unless the failure came from the final host-restart stage. $($_.Exception.Message)")
  throw
}

Write-Output 'Recovery stages completed.'
Write-Output 'Codex: reopen Codex, run /hooks in the Codex CLI, trust and enable all five Lanternwatch handlers, fully exit and restart Codex after trust, then send a prompt in a fresh chat.'
Write-Output "Runtime proof: after a fresh prompt, confirm a new receipt in $(Join-Path (Join-Path $StorageRoot 'logs') 'hook.jsonl'). Configuration presence alone is not runtime proof."
