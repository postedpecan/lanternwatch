param([string]$ClaudeRoot, [string]$StorageRoot, [string]$DatabasePath, [string]$VaultPath, [string]$NodeExecutable)
. (Join-Path $PSScriptRoot 'recovery-stage-fixture.ps1')
Invoke-RecoveryStageFixture 'claude-install' $PSBoundParameters
