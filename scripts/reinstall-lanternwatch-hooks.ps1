param(
  [string]$CodexRoot,
  [string]$NodeExecutable
)

$ErrorActionPreference = 'Stop'

$userHome = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($env:HOME) { $env:HOME } else { [Environment]::GetFolderPath('UserProfile') }
if ([string]::IsNullOrWhiteSpace($userHome)) { throw 'Unable to resolve the current user profile directory.' }
if ([string]::IsNullOrWhiteSpace($CodexRoot)) {
  $CodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $userHome '.codex' }
}
$nodeCommand = if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  Get-Command node -ErrorAction SilentlyContinue
} elseif (Test-Path -LiteralPath $NodeExecutable) {
  Get-Item -LiteralPath $NodeExecutable
} else {
  Get-Command $NodeExecutable -ErrorAction SilentlyContinue
}
if (-not $nodeCommand) { throw 'node.exe was not found on PATH; install Node.js before reinstalling hooks.' }
$NodeExecutable = if ($nodeCommand.Source) { $nodeCommand.Source } else { $nodeCommand.FullName }

$projectRoot = Split-Path -Parent $PSScriptRoot
$hooksPath = Join-Path $CodexRoot 'hooks.json'
$configPath = Join-Path $CodexRoot 'config.toml'
$launcherPath = Join-Path $CodexRoot 'LanternWatch\guild-lifecycle-hook.cmd'
$lifecycleScript = Join-Path $projectRoot 'scripts\guild-lifecycle-hook.mjs'
$mergeScript = Join-Path $projectRoot 'scripts\merge-hooks.mjs'
$backupRoot = Join-Path $CodexRoot '.lanternwatch-backups'
$backupDirectory = Join-Path $backupRoot ("rehook-" + (Get-Date -Format 'yyyyMMdd-HHmmssfff'))

foreach ($requiredPath in @($configPath, $lifecycleScript, $mergeScript, $NodeExecutable)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required path not found: $requiredPath"
  }
}

New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
Copy-Item -LiteralPath $configPath -Destination (Join-Path $backupDirectory 'config.toml')
if (Test-Path -LiteralPath $hooksPath) {
  Copy-Item -LiteralPath $hooksPath -Destination (Join-Path $backupDirectory 'hooks.json')
}
if (Test-Path -LiteralPath $launcherPath) {
  Copy-Item -LiteralPath $launcherPath -Destination (Join-Path $backupDirectory 'guild-lifecycle-hook.cmd')
}

try {
  $mergeOutput = & $NodeExecutable $mergeScript $hooksPath $lifecycleScript $NodeExecutable --report
  if ($LASTEXITCODE -ne 0) { throw "Hook merge failed with exit code $LASTEXITCODE" }
  $mergeReport = $mergeOutput | Select-Object -Last 1 | ConvertFrom-Json

  $config = [IO.File]::ReadAllText($configPath)
  $removedTrustRecords = 0
  foreach ($trustKey in $mergeReport.trustKeysToReset) {
    $escapedKey = [regex]::Escape([string]$trustKey)
    $pattern = "(?ms)^\[hooks\.state\.'$escapedKey'\]\r?\n.*?(?=^\[|\z)"
    $updated = [regex]::Replace($config, $pattern, '')
    if ($updated -ne $config) { $removedTrustRecords += 1 }
    $config = $updated
  }
  [IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))

  & $NodeExecutable -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));" $hooksPath
  if ($LASTEXITCODE -ne 0) { throw 'Reinstalled hooks.json is not valid JSON.' }

  Write-Output 'Lanternwatch lifecycle hooks were reinstalled.'
  Write-Output "Backup: $backupDirectory"
  Write-Output "Trust records reset: $removedTrustRecords"
  Write-Output 'In a terminal, run codex and use /hooks in that CLI session to review, trust, and enable each displayed Lanternwatch hook.'
  Write-Output 'The desktop and IDE chat composers do not provide /hooks. Fully exit their host processes, reopen Codex, and start a fresh chat.'
  Write-Output 'SessionEnd runs only when the main thread ends, so its receipt is not created before that point.'
} catch {
  Copy-Item -LiteralPath (Join-Path $backupDirectory 'config.toml') -Destination $configPath -Force
  $hooksBackup = Join-Path $backupDirectory 'hooks.json'
  if (Test-Path -LiteralPath $hooksBackup) {
    Copy-Item -LiteralPath $hooksBackup -Destination $hooksPath -Force
  }
  $launcherBackup = Join-Path $backupDirectory 'guild-lifecycle-hook.cmd'
  if (Test-Path -LiteralPath $launcherBackup) {
    Copy-Item -LiteralPath $launcherBackup -Destination $launcherPath -Force
  } elseif (Test-Path -LiteralPath $launcherPath) {
    Remove-Item -LiteralPath $launcherPath -Force
  }
  throw
}
