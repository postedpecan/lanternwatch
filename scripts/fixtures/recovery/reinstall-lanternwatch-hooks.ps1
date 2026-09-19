param([string]$CodexRoot, [string]$NodeExecutable)
. (Join-Path $PSScriptRoot 'recovery-stage-fixture.ps1')
Invoke-RecoveryStageFixture 'codex-rehook' $PSBoundParameters
