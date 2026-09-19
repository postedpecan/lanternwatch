param([string]$StorageRoot, [string]$DatabasePath, [string]$VaultPath, [string]$RuntimeConfigPath)
. (Join-Path $PSScriptRoot 'recovery-stage-fixture.ps1')
Invoke-RecoveryStageFixture 'runtime-repair' $PSBoundParameters
