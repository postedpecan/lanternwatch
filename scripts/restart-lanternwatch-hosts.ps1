[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [switch]$Force,
  [switch]$CodexOnly,
  [switch]$RestartDashboard
)

$ErrorActionPreference = 'Stop'

# PowerShell process names are case-insensitive. These exact names therefore cover
# ChatGPT.exe, Codex.exe/codex.exe, and Claude.exe/claude.exe without a wildcard.
[string[]]$DesktopProcessNames = if ($CodexOnly) { @('ChatGPT', 'Codex') } else { @('ChatGPT', 'Codex', 'Claude') }
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'restart-lanternwatch-hosts.matcher.ps1')

function Get-RestartableExecutablePath {
  param([System.Diagnostics.Process]$Process)

  try {
    if ($Process.Path -and (Test-Path -LiteralPath $Process.Path -PathType Leaf)) {
      return [IO.Path]::GetFullPath($Process.Path)
    }
  } catch {
    # Access to another user's process path can be denied. Try the read-only CIM view.
  }

  try {
    $cimProcess = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($Process.Id)" -ErrorAction Stop
    if ($cimProcess.ExecutablePath -and (Test-Path -LiteralPath $cimProcess.ExecutablePath -PathType Leaf)) {
      return [IO.Path]::GetFullPath($cimProcess.ExecutablePath)
    }
  } catch {
    # Do not infer an application path from its name.
  }

  return $null
}

function Get-AllowedHostProcesses {
  $seenProcessIds = [Collections.Generic.HashSet[int]]::new()
  foreach ($processName in $DesktopProcessNames) {
    foreach ($process in @(Get-Process -Name $processName -ErrorAction SilentlyContinue)) {
      if (-not $seenProcessIds.Add($process.Id)) { continue }
      [PSCustomObject]@{
        Id = $process.Id
        Name = $process.ProcessName
        ExecutablePath = Get-RestartableExecutablePath -Process $process
      }
    }
  }
}

function Get-LocalNextDevProcesses {
  try {
    $nodeProcesses = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop)
  } catch {
    Write-Warning "Could not inspect node.exe processes, so the dashboard will not be restarted: $($_.Exception.Message)"
    return @()
  }

  $matches = @()
  foreach ($nodeProcess in $nodeProcesses) {
    $commandLine = [string]$nodeProcess.CommandLine
    if (Test-LanternwatchNextDevCommandLine -CommandLine $commandLine -ProjectRoot $projectRoot) {
      $matches += [PSCustomObject]@{ Id = [int]$nodeProcess.ProcessId; Name = $nodeProcess.Name; CommandLine = $commandLine }
    }
  }
  return $matches
}

$hostProcesses = @(Get-AllowedHostProcesses)
$dashboardProcesses = if ($RestartDashboard) { @(Get-LocalNextDevProcesses) } else { @() }

Write-Output "Project: $projectRoot"
Write-Output "Allowed host process names: $($DesktopProcessNames -join ', ') (exact, case-insensitive; no wildcards)."
if ($hostProcesses.Count -eq 0) {
  Write-Output "No allowed $($DesktopProcessNames -join ', ') processes were found."
} else {
  foreach ($hostProcess in $hostProcesses) {
    if ($hostProcess.ExecutablePath) {
      Write-Output "Found $($hostProcess.Name) (PID $($hostProcess.Id)); restart path recorded."
    } else {
      Write-Warning "Found $($hostProcess.Name) (PID $($hostProcess.Id)), but its executable path is unavailable. It will not be guessed or relaunched."
    }
  }
}

if ($RestartDashboard) {
  if ($dashboardProcesses.Count -eq 0) {
    Write-Warning 'No local-project Next dev node.exe process was identified. The dashboard will not be stopped or started.'
  } else {
    Write-Output "Found $($dashboardProcesses.Count) local Next dev dashboard process(es) for this project."
  }
}

if (-not $Force) {
  Write-Warning 'Preview only: no processes were stopped and no applications were launched. Add -Force -Confirm for the real restart; forced termination loses unsaved chats and work.'
  return
}

if ($WhatIfPreference) {
  Write-Output 'WhatIf preview: no processes will be stopped and no applications will be launched.'
  return
}

if (-not $PSBoundParameters.ContainsKey('Confirm') -or -not $PSBoundParameters['Confirm']) {
  throw 'Real restart requires both -Force and -Confirm. Forced termination loses unsaved chats and work.'
}

$restartScope = "the allowed $($DesktopProcessNames -join ', ') host processes"
if ($RestartDashboard) { $restartScope += ' and the identified local Next dev dashboard process' }
if (-not $PSCmdlet.ShouldProcess($restartScope, 'Force stop and restart')) {
  Write-Output 'Restart cancelled at the confirmation prompt.'
  return
}

$restartPaths = [Collections.Generic.List[string]]::new()
foreach ($hostProcess in $hostProcesses) {
  try {
    Stop-Process -Id $hostProcess.Id -Force -ErrorAction Stop
    Write-Output "Stopped $($hostProcess.Name) (PID $($hostProcess.Id))."
    if ($hostProcess.ExecutablePath) { $restartPaths.Add($hostProcess.ExecutablePath) }
  } catch {
    Write-Warning "Could not stop $($hostProcess.Name) (PID $($hostProcess.Id)): $($_.Exception.Message)"
  }
}

foreach ($restartPath in @($restartPaths | Select-Object -Unique)) {
  try {
    Start-Process -FilePath $restartPath -ErrorAction Stop
    Write-Output "Relaunched recorded host path: $restartPath"
  } catch {
    Write-Warning "Could not relaunch recorded host path '$restartPath': $($_.Exception.Message)"
  }
}

$dashboardStopped = $false
foreach ($dashboardProcess in $dashboardProcesses) {
  try {
    Stop-Process -Id $dashboardProcess.Id -Force -ErrorAction Stop
    $dashboardStopped = $true
    Write-Output "Stopped local Next dev dashboard (PID $($dashboardProcess.Id))."
  } catch {
    Write-Warning "Could not stop local Next dev dashboard (PID $($dashboardProcess.Id)): $($_.Exception.Message)"
  }
}

if ($RestartDashboard -and $dashboardStopped) {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
  if ($npmCommand) {
    try {
      $npmPath = if ($npmCommand.Source) { $npmCommand.Source } else { $npmCommand.Path }
      Start-Process -FilePath $npmPath -ArgumentList @('run', 'dev') -WorkingDirectory $projectRoot -ErrorAction Stop
      Write-Output 'Started a fresh local dashboard with npm run dev.'
    } catch {
      Write-Warning "The local dashboard was stopped but could not be restarted: $($_.Exception.Message)"
    }
  } else {
    Write-Warning 'The local dashboard was stopped but npm was not found, so it was not restarted.'
  }
}

$escapedProjectRoot = $projectRoot.Replace("'", "''")
$codexCommand = "Set-Location -LiteralPath '$escapedProjectRoot'; codex"
try {
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-Command', $codexCommand) -WorkingDirectory $projectRoot -ErrorAction Stop
  Write-Output 'Opened a fresh PowerShell window in the project and started codex. Run /hooks there after the CLI is ready.'
} catch {
  Write-Warning "Host apps were handled, but a fresh Codex PowerShell window could not be opened: $($_.Exception.Message)"
}
