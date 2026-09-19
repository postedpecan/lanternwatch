function Test-LanternwatchNextDevCommandLine {
  [OutputType([bool])]
  param(
    [Parameter(Mandatory = $true)][string]$CommandLine,
    [Parameter(Mandatory = $true)][string]$ProjectRoot
  )

  # A dashboard candidate must invoke this checkout's actual Next CLI directly
  # as node <project>\node_modules\next\dist\bin\next dev. Do not treat an
  # arbitrary project Node worker mentioning the words "next dev" as a match.
  $nextCliPath = Join-Path ([IO.Path]::GetFullPath($ProjectRoot)) 'node_modules\next\dist\bin\next'
  $escapedNextCliPath = [regex]::Escape($nextCliPath)
  $nodeExecutable = '(?:"[^"]*\\node(?:\.exe)?"|[^\s"]*node(?:\.exe)?)'
  $nextCliArgument = '(?:"' + $escapedNextCliPath + '"|' + $escapedNextCliPath + ')'
  $nextDevInvocation = '^\s*' + $nodeExecutable + '\s+' + $nextCliArgument + '\s+dev(?:\s|$)'

  return $CommandLine -match $nextDevInvocation
}
