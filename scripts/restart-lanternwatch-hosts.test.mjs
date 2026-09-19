import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(directory, "restart-lanternwatch-hosts.ps1");
const matcherPath = path.join(directory, "restart-lanternwatch-hosts.matcher.ps1");
const source = readFileSync(scriptPath, "utf8");
const matcherSource = readFileSync(matcherPath, "utf8");

test("the Windows host restart helper parses without executing it", () => {
  const command = "$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile($env:SCRIPT_TO_PARSE, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    shell: false,
    env: { ...process.env, SCRIPT_TO_PARSE: scriptPath },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("the Next dev matcher accepts only the local Next CLI dev invocation", () => {
  const command = [
    ". $env:MATCHER_TO_TEST",
    '$project = "D:\\Work\\LanternWatch"',
    String.raw`$actualNextDev = '"D:\NodeJS\node.exe" "D:\Work\LanternWatch\node_modules\next\dist\bin\next" dev --hostname 127.0.0.1'`,
    String.raw`$workerWithLabel = '"D:\NodeJS\node.exe" "D:\Work\LanternWatch\tools\worker.js" --label "next dev"'`,
    String.raw`$nextStart = '"D:\NodeJS\node.exe" "D:\Work\LanternWatch\node_modules\next\dist\bin\next" start'`,
    'if (-not (Test-LanternwatchNextDevCommandLine -CommandLine $actualNextDev -ProjectRoot $project)) { throw "actual Next dev invocation was rejected" }',
    'if (Test-LanternwatchNextDevCommandLine -CommandLine $workerWithLabel -ProjectRoot $project) { throw "worker label false positive" }',
    'if (Test-LanternwatchNextDevCommandLine -CommandLine $nextStart -ProjectRoot $project) { throw "Next start false positive" }',
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    shell: false,
    env: { ...process.env, MATCHER_TO_TEST: matcherPath },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("the helper requires force and confirmation and keeps WhatIf non-mutating", () => {
  assert.match(source, /if \(-not \$Force\)[\s\S]*?Preview only: no processes were stopped/);
  assert.match(source, /if \(\$WhatIfPreference\)[\s\S]*?no processes will be stopped and no applications will be launched/);
  assert.match(source, /ContainsKey\('Confirm'\)[\s\S]*?Real restart requires both -Force and -Confirm/);
  assert.ok(source.indexOf("$WhatIfPreference") < source.indexOf("Stop-Process"));
  assert.ok(source.indexOf("ContainsKey('Confirm')") < source.indexOf("Stop-Process"));
});

test("the helper has an exact host allowlist and no broad process termination", () => {
  assert.match(source, /\$DesktopProcessNames = if \(\$CodexOnly\) \{ @\('ChatGPT', 'Codex'\) \} else \{ @\('ChatGPT', 'Codex', 'Claude'\) \}/);
  assert.match(source, /Get-Process -Name \$processName/);
  assert.match(source, /Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node\.exe'"/);
  assert.match(source, /Test-LanternwatchNextDevCommandLine/);
  assert.doesNotMatch(source, /next\(\?:\\\.js\)\?\\b\.\*?\\bdev/);
  assert.match(source, /Stop-Process -Id \$hostProcess\.Id -Force/);
  assert.match(source, /Stop-Process -Id \$dashboardProcess\.Id -Force/);
  assert.doesNotMatch(source, /Stop-Process\s+-Name|taskkill|Get-Process\s*\|\s*Stop-Process|Stop-Process\s+-Id\s+\$\w+\.Id\s+-Force\s+-PassThru/);
});

test("Codex-only recovery can exclude Claude from the restart allowlist", () => {
  assert.match(source, /\[switch\]\$CodexOnly/);
  assert.match(source, /if \(\$CodexOnly\) \{ @\('ChatGPT', 'Codex'\) \}/);
});

test("the matcher rejects the worker-label false positive instead of substring matching", () => {
  assert.match(matcherSource, /node_modules\\next\\dist\\bin\\next dev/);
  assert.match(matcherSource, /\^\\s\*.*?\\s\+dev\(\?:\\s\|\$\)/);
  assert.doesNotMatch(matcherSource, /\.\*?\\bdev\\b/);
});

test("the helper only relaunches recorded paths and opens a fresh Codex CLI window", () => {
  assert.match(source, /Get-RestartableExecutablePath/);
  assert.match(source, /if \(\$hostProcess\.ExecutablePath\) \{ \$restartPaths\.Add\(\$hostProcess\.ExecutablePath\) \}/);
  assert.match(source, /Start-Process -FilePath \$restartPath/);
  assert.match(source, /Start-Process -FilePath 'powershell\.exe'[\s\S]*?codex/);
  assert.match(source, /Run \/hooks there after the CLI is ready/);
  assert.doesNotMatch(source, /SendKeys|Windows\.Forms/);
});
