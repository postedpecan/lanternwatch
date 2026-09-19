[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$Force, [switch]$CodexOnly, [switch]$RestartDashboard)
. (Join-Path $PSScriptRoot 'recovery-stage-fixture.ps1')
Invoke-RecoveryStageFixture 'host-restart' $PSBoundParameters
