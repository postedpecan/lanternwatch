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

if ([string]::IsNullOrWhiteSpace($CodexRoot)) {
  $CodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $userHome '.codex' }
}
if ([string]::IsNullOrWhiteSpace($DatabasePath) -and $env:LANTERNWATCH_DB_PATH) { $DatabasePath = $env:LANTERNWATCH_DB_PATH }
if ([string]::IsNullOrWhiteSpace($StorageRoot) -and $env:LANTERNWATCH_STORAGE_ROOT) { $StorageRoot = $env:LANTERNWATCH_STORAGE_ROOT }
if ([string]::IsNullOrWhiteSpace($StorageRoot)) {
  $StorageRoot = if ($DatabasePath) { Split-Path -Parent $DatabasePath } else { Join-Path $userHome '.lanternwatch' }
}
if ([string]::IsNullOrWhiteSpace($DatabasePath)) { $DatabasePath = Join-Path $StorageRoot 'guild.db' }
if ([string]::IsNullOrWhiteSpace($VaultPath)) {
  $VaultPath = if ($env:LANTERNWATCH_VAULT_PATH) { $env:LANTERNWATCH_VAULT_PATH } else { '' }
}

$nodeCommand = if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  Get-Command node -ErrorAction SilentlyContinue
} elseif (Test-Path -LiteralPath $NodeExecutable) {
  Get-Item -LiteralPath $NodeExecutable
} else {
  Get-Command $NodeExecutable -ErrorAction SilentlyContinue
}
if (-not $nodeCommand) { throw 'node.exe was not found on PATH; install Node.js before running this installer.' }
$NodeExecutable = if ($nodeCommand.Source) { $nodeCommand.Source } else { $nodeCommand.FullName }

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $CodexRoot 'config.toml'
$agentsPath = Join-Path $CodexRoot 'AGENTS.md'
$hooksPath = Join-Path $CodexRoot 'hooks.json'
$backupDirectory = Join-Path $CodexRoot '.lanternwatch-backups'
$notifierConfigPath = Join-Path $CodexRoot 'lanternwatch-notifier.json'
$runtimeConfigPath = if ($env:LANTERNWATCH_CONFIG_PATH) { $env:LANTERNWATCH_CONFIG_PATH } else { Join-Path (Join-Path $userHome '.lanternwatch') 'config.json' }
$notifyScript = Join-Path $projectRoot 'scripts\guild-notify.mjs'
$reportScript = Join-Path $projectRoot 'scripts\guild-report.mjs'
$lifecycleScript = Join-Path $projectRoot 'scripts\guild-lifecycle-hook.mjs'
$mergeScript = Join-Path $projectRoot 'scripts\merge-hooks.mjs'

foreach ($requiredPath in @($notifyScript, $reportScript, $lifecycleScript, $mergeScript)) {
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
  @{ Path = $notifierConfigPath; Name = "notifier-$timestamp.json" },
  @{ Path = $runtimeConfigPath; Name = "runtime-$timestamp.json" }
)) {
  if (Test-Path -LiteralPath $backup.Path) { Copy-Item -LiteralPath $backup.Path -Destination (Join-Path $backupDirectory $backup.Name) }
}

$config = if (Test-Path -LiteralPath $configPath) { Get-Content -Raw -LiteralPath $configPath -Encoding UTF8 } else { '' }
$existingNotify = [regex]::Match($config, '(?m)^\s*notify\s*=\s*\[(.*?)\]\s*$')
if ($existingNotify.Success -and $existingNotify.Value -notmatch 'guild-notify\.mjs') {
  $notifierTokens = @([regex]::Matches($existingNotify.Groups[1].Value, '"(?:\\.|[^"\\])*"') | ForEach-Object { $_.Value | ConvertFrom-Json })
  if ($notifierTokens.Count -gt 0) {
    $notifierConfiguration = [ordered]@{ command = $notifierTokens[0]; args = @($notifierTokens | Select-Object -Skip 1) }
    [IO.File]::WriteAllText($notifierConfigPath, ($notifierConfiguration | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
  }
}

$escapedNode = $NodeExecutable -replace '\\', '\\'
$escapedNotify = $notifyScript -replace '\\', '\\'
$escapedNotifierConfig = $notifierConfigPath -replace '\\', '\\'
$notifyLine = 'notify = [ "' + $escapedNode + '", "' + $escapedNotify + '", "--notifier-config", "' + $escapedNotifierConfig + '" ]'
if ($config -match '(?m)^\s*notify\s*=.*$') {
  $config = [regex]::Replace($config, '(?m)^\s*notify\s*=.*$', $notifyLine, 1)
} else {
  $config = $notifyLine + [Environment]::NewLine + $config
}
[IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))

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
- Use only the supported role ids: herald, guildmaster, steward, pathfinder,
  courier, archivist, genealogist, hookwright, interface-weaver, ledgerkeeper,
  prover, chronicler, counselor, assayer.
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
& $NodeExecutable $reportScript --quiet --event-id lanternwatch-setup-complete --status complete --agent guildmaster --run-id lanternwatch-setup --project $projectRoot --project-name Lanternwatch --quest 'Install local agent activity system' --message 'SQLite, Local API, and activity export storage initialized.' --run-complete

Write-Output 'Lanternwatch installed.'
Write-Output "Database: $DatabasePath"
if ($VaultPath) { Write-Output "Activity exports: $VaultPath\Guild Activity" } else { Write-Output 'Activity exports: disabled (set -VaultPath or LANTERNWATCH_VAULT_PATH to enable)' }
Write-Output "Runtime config: $runtimeConfigPath"
Write-Output "Hooks: $hooksPath"
Write-Output "Backups: $backupDirectory"
Write-Output 'In a terminal, run codex and use /hooks in that CLI session to review, trust, and enable each Lanternwatch hook.'
Write-Output 'The desktop and IDE chat composers do not provide /hooks. Fully exit their host processes, reopen Codex, and start a fresh chat.'
