function Invoke-RecoveryStageFixture {
  param(
    [string]$Stage,
    [hashtable]$BoundParameters
  )

  $tracePath = $env:LANTERNWATCH_RECOVERY_TRACE_PATH
  if ([string]::IsNullOrWhiteSpace($tracePath)) { throw 'Fixture trace path is required.' }
  $normalizedParameters = [ordered]@{}
  foreach ($entry in $BoundParameters.GetEnumerator()) {
    $normalizedParameters[$entry.Key] = if ($entry.Value -is [Management.Automation.SwitchParameter]) { $entry.Value.IsPresent } else { $entry.Value }
  }
  $record = [ordered]@{
    stage = $Stage
    parameters = $normalizedParameters
    environment = [ordered]@{
      storageRoot = $env:LANTERNWATCH_STORAGE_ROOT
      databasePath = $env:LANTERNWATCH_DB_PATH
      vaultPath = $env:LANTERNWATCH_VAULT_PATH
      runtimeConfigPath = $env:LANTERNWATCH_CONFIG_PATH
    }
  }
  [IO.File]::AppendAllText($tracePath, (($record | ConvertTo-Json -Compress -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  if ($env:LANTERNWATCH_RECOVERY_FAIL_STAGE -eq $Stage) { throw "Requested fixture failure: $Stage" }
}
