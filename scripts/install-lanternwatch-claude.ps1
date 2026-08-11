param(
  [string]$ClaudeRoot,
  [string]$StorageRoot,
  [string]$DatabasePath,
  [string]$VaultPath,
  [string]$NodeExecutable
)

$ErrorActionPreference = 'Stop'

$userHome = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($env:HOME) { $env:HOME } else { [Environment]::GetFolderPath('UserProfile') }
if ([string]::IsNullOrWhiteSpace($userHome)) { throw 'Unable to resolve the current user profile directory.' }
if ([string]::IsNullOrWhiteSpace($ClaudeRoot)) { $ClaudeRoot = Join-Path $userHome '.claude' }
if ([string]::IsNullOrWhiteSpace($DatabasePath) -and $env:LANTERNWATCH_DB_PATH) { $DatabasePath = $env:LANTERNWATCH_DB_PATH }
if ([string]::IsNullOrWhiteSpace($StorageRoot) -and $env:LANTERNWATCH_STORAGE_ROOT) { $StorageRoot = $env:LANTERNWATCH_STORAGE_ROOT }
if ([string]::IsNullOrWhiteSpace($StorageRoot)) {
  $StorageRoot = if ($DatabasePath) { Split-Path -Parent $DatabasePath } else { Join-Path $userHome '.lanternwatch' }
}
if ([string]::IsNullOrWhiteSpace($DatabasePath)) { $DatabasePath = Join-Path $StorageRoot 'guild.db' }
if ([string]::IsNullOrWhiteSpace($VaultPath)) {
  $VaultPath = if ($env:LANTERNWATCH_VAULT_PATH) { $env:LANTERNWATCH_VAULT_PATH } else { '' }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $ClaudeRoot 'settings.json'
$claudeMdPath = Join-Path $ClaudeRoot 'CLAUDE.md'
$backupDirectory = Join-Path $ClaudeRoot '.lanternwatch-backups'
$runtimeConfigPath = if ($env:LANTERNWATCH_CONFIG_PATH) { $env:LANTERNWATCH_CONFIG_PATH } else { Join-Path (Join-Path $userHome '.lanternwatch') 'config.json' }
$lifecycleScript = Join-Path $projectRoot 'scripts\guild-lifecycle-hook.mjs'
$mergeScript = Join-Path $projectRoot 'scripts\merge-claude-hooks.mjs'
$reportScript = Join-Path $projectRoot 'scripts\guild-report.mjs'

$nodeCommand = if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  Get-Command node -ErrorAction SilentlyContinue
} elseif (Test-Path -LiteralPath $NodeExecutable) {
  Get-Item -LiteralPath $NodeExecutable
} else {
  Get-Command $NodeExecutable -ErrorAction SilentlyContinue
}
if (-not $nodeCommand) { throw "node.exe was not found on PATH; install Node.js before running this installer." }
$nodeExecutable = if ($nodeCommand.Source) { $nodeCommand.Source } else { $nodeCommand.FullName }

foreach ($requiredPath in @($lifecycleScript, $mergeScript, $reportScript)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Required path not found: $requiredPath" }
}

$directories = @($ClaudeRoot, (Split-Path -Parent $DatabasePath), $backupDirectory, (Split-Path -Parent $runtimeConfigPath))
if ($VaultPath) { $directories += $VaultPath }
New-Item -ItemType Directory -Force -Path $directories | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (Test-Path -LiteralPath $settingsPath) {
  Copy-Item -LiteralPath $settingsPath -Destination (Join-Path $backupDirectory "settings-$timestamp.json")
}
if (Test-Path -LiteralPath $claudeMdPath) {
  Copy-Item -LiteralPath $claudeMdPath -Destination (Join-Path $backupDirectory "CLAUDE-$timestamp.md")
}
if (Test-Path -LiteralPath $runtimeConfigPath) {
  Copy-Item -LiteralPath $runtimeConfigPath -Destination (Join-Path $backupDirectory "runtime-$timestamp.json")
}

& $nodeExecutable $mergeScript $settingsPath $lifecycleScript $nodeExecutable
if ($LASTEXITCODE -ne 0) { throw "Hook merge failed with exit code $LASTEXITCODE" }

& $nodeExecutable -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));" $settingsPath
if ($LASTEXITCODE -ne 0) { throw 'Reinstalled settings.json is not valid JSON.' }

$beginMarker = '<!-- BEGIN:lanternwatch-reporting -->'
$endMarker = '<!-- END:lanternwatch-reporting -->'
$reportingBlock = @"

$beginMarker
## Lanternwatch activity reporting

Claude Code lifecycle hooks (UserPromptSubmit, Stop, SubagentStart,
SubagentStop, SessionEnd) report primary and subagent activity automatically
for every workspace, registered globally in ``~/.claude/settings.json``.
Reporting failure must never block the actual task.

- Use ``$reportScript`` manually only when a named Lanternwatch role must be
  recorded more precisely than the automatic subagent type permits.
- Use only the supported role ids: herald, guildmaster, steward, pathfinder,
  courier, archivist, genealogist, hookwright, interface-weaver, ledgerkeeper,
  prover, chronicler, counselor, assayer.
- Never place secrets, raw prompts, private file contents, or command lines in
  a manual message.
$endMarker
"@
if (Test-Path -LiteralPath $claudeMdPath) {
  # -Encoding UTF8 is required: this file has no BOM, and Get-Content -Raw
  # without an explicit encoding falls back to the system ANSI codepage on
  # Windows PowerShell 5.1, mangling any non-ASCII characters (e.g. em dashes).
  $claudeMd = Get-Content -Raw -LiteralPath $claudeMdPath -Encoding UTF8
} else {
  $claudeMd = ''
}
if ($claudeMd -match ([regex]::Escape($beginMarker) + '[\s\S]*?' + [regex]::Escape($endMarker))) {
  $claudeMd = [regex]::Replace($claudeMd, ([regex]::Escape($beginMarker) + '[\s\S]*?' + [regex]::Escape($endMarker)), $reportingBlock.Trim())
} else {
  $claudeMd = $claudeMd.TrimEnd() + $reportingBlock + [Environment]::NewLine
}
Set-Content -LiteralPath $claudeMdPath -Value $claudeMd.TrimStart() -Encoding utf8

$runtimeConfiguration = [ordered]@{ storageRoot = $StorageRoot; databasePath = $DatabasePath; vaultPath = $VaultPath }
[IO.File]::WriteAllText($runtimeConfigPath, ($runtimeConfiguration | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

$env:LANTERNWATCH_CONFIG_PATH = $runtimeConfigPath
& $nodeExecutable $reportScript --quiet --event-id lanternwatch-setup-claude-complete --status complete --agent guildmaster --run-id lanternwatch-setup-claude --project $projectRoot --project-name Lanternwatch --quest 'Install Claude Code agent activity reporting' --message 'Claude Code lifecycle hooks registered in global settings.json.' --run-complete

Write-Output "Lanternwatch Claude Code hooks installed."
Write-Output "Database: $DatabasePath"
if ($VaultPath) { Write-Output "Activity exports: $VaultPath\Guild Activity" } else { Write-Output 'Activity exports: disabled (set -VaultPath or LANTERNWATCH_VAULT_PATH to enable)' }
Write-Output "Runtime config: $runtimeConfigPath"
Write-Output "Settings: $settingsPath"
Write-Output "Backup: $backupDirectory"
Write-Output "Global settings.json hooks load automatically (no /hooks trust step in Claude Code)."
Write-Output "Start a new Claude Code session for the hook registration to take effect."
