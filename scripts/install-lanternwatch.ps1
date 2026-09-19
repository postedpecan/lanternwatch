param(
  [string]$CodexRoot,
  [string]$StorageRoot,
  [string]$DatabasePath,
  [string]$VaultPath,
  [string]$NodeExecutable
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

if ([string]::IsNullOrWhiteSpace($CodexRoot)) {
  $CodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $userHome '.codex' }
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

$nodeCommand = if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  Get-Command node -ErrorAction SilentlyContinue
} elseif (Test-Path -LiteralPath $NodeExecutable) {
  Get-Item -LiteralPath $NodeExecutable
} else {
  Get-Command $NodeExecutable -ErrorAction SilentlyContinue
}
if (-not $nodeCommand) { throw 'node.exe was not found on PATH; install Node.js before running this installer.' }
$NodeExecutable = if ($nodeCommand.Source) { $nodeCommand.Source } else { $nodeCommand.FullName }

$configPath = Join-Path $CodexRoot 'config.toml'
$agentsPath = Join-Path $CodexRoot 'AGENTS.md'
$hooksPath = Join-Path $CodexRoot 'hooks.json'
$launcherPath = Join-Path $CodexRoot 'LanternWatch\guild-lifecycle-hook.cmd'
$backupDirectory = Join-Path $CodexRoot '.lanternwatch-backups'
$runtimeConfigPath = if ($env:LANTERNWATCH_CONFIG_PATH) { $env:LANTERNWATCH_CONFIG_PATH } else { Join-Path (Join-Path $userHome '.lanternwatch') 'config.json' }
$reportScript = Join-Path $projectRoot 'scripts\guild-report.mjs'
$lifecycleScript = Join-Path $projectRoot 'scripts\guild-lifecycle-hook.mjs'
$mergeScript = Join-Path $projectRoot 'scripts\merge-hooks.mjs'

foreach ($requiredPath in @($reportScript, $lifecycleScript, $mergeScript)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Required path not found: $requiredPath" }
}

$directories = @($CodexRoot, (Split-Path -Parent $DatabasePath), $backupDirectory, (Split-Path -Parent $runtimeConfigPath))
if ($VaultPath) { $directories += $VaultPath }
New-Item -ItemType Directory -Force -Path $directories | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
foreach ($backup in @(
  @{ Path = $configPath; Name = "config-$timestamp.toml" },
  @{ Path = $agentsPath; Name = "AGENTS-$timestamp.md" },
  @{ Path = $hooksPath; Name = "hooks-$timestamp.json" },
  @{ Path = $launcherPath; Name = "guild-lifecycle-hook-$timestamp.cmd" },
  @{ Path = $runtimeConfigPath; Name = "runtime-$timestamp.json" }
)) {
  if (Test-Path -LiteralPath $backup.Path) { Copy-Item -LiteralPath $backup.Path -Destination (Join-Path $backupDirectory $backup.Name) }
}

& $NodeExecutable $mergeScript $hooksPath $lifecycleScript $NodeExecutable
if ($LASTEXITCODE -ne 0) { throw "Hook merge failed with exit code $LASTEXITCODE" }

$beginMarker = '<!-- BEGIN:lanternwatch-reporting -->'
$endMarker = '<!-- END:lanternwatch-reporting -->'
$reportingBlock = @"

$beginMarker
## Lanternwatch activity reporting

Codex lifecycle hooks report primary and subagent start/stop events automatically
for every workspace. Reporting failure must never block the actual task.

- Use ``$reportScript`` manually only when a named Lanternwatch role must be
  recorded more precisely than the automatic subagent type permits.
- Use only the supported role ids: business-analyst, program-manager,
  operations-coordinator, technical-researcher, market-intelligence-analyst,
  systems-analyst, change-management-analyst, platform-engineer,
  frontend-engineer, data-engineer, qa-engineer, technical-writer,
  strategy-consultant, compliance-reviewer. Legacy fantasy ids are accepted
  as input aliases, but Lanternwatch emits and stores only these role ids.
- Never place secrets, raw prompts, private file contents, or command lines in
  a manual message.
$endMarker
"@
$agents = if (Test-Path -LiteralPath $agentsPath) { Get-Content -Raw -LiteralPath $agentsPath -Encoding UTF8 } else { '' }
if ($agents -match ([regex]::Escape($beginMarker) + '[\s\S]*?' + [regex]::Escape($endMarker))) {
  $agents = [regex]::Replace($agents, ([regex]::Escape($beginMarker) + '[\s\S]*?' + [regex]::Escape($endMarker)), $reportingBlock.Trim())
} else { $agents = $agents.TrimEnd() + $reportingBlock + [Environment]::NewLine }
[IO.File]::WriteAllText($agentsPath, $agents.TrimStart(), [Text.UTF8Encoding]::new($false))

$runtimeConfiguration = [ordered]@{ storageRoot = $StorageRoot; databasePath = $DatabasePath; vaultPath = $VaultPath }
[IO.File]::WriteAllText($runtimeConfigPath, ($runtimeConfiguration | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

$env:LANTERNWATCH_CONFIG_PATH = $runtimeConfigPath
& $NodeExecutable $reportScript --quiet --event-id lanternwatch-setup-complete --status complete --agent program-manager --run-id lanternwatch-setup --project $projectRoot --project-name Lanternwatch --quest 'Install local agent activity system' --message 'SQLite, Local API, and activity export storage initialized.' --run-complete

Write-Output 'Lanternwatch installed.'
Write-Output "Database: $DatabasePath"
if ($VaultPath) { Write-Output "Activity exports: $VaultPath\Guild Activity" } else { Write-Output 'Activity exports: disabled (set -VaultPath or LANTERNWATCH_VAULT_PATH to enable)' }
Write-Output "Runtime config: $runtimeConfigPath"
Write-Output "Hooks: $hooksPath"
Write-Output "Backups: $backupDirectory"
Write-Output 'Existing Codex notifier configuration was preserved; live status uses lifecycle hooks rather than the completion-only notify fallback.'
Write-Output 'In a terminal, run codex and use /hooks in that CLI session to review, trust, and enable each Lanternwatch hook.'
Write-Output 'The desktop and IDE chat composers do not provide /hooks. Fully exit their host processes, reopen Codex, and start a fresh chat.'
