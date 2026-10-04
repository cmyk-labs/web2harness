const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const INSTALL_GUID = "8b7be269-ac7f-4ab6-82e9-71408ffa370b";

// Only these two product keys and two standard product shortcuts belong to setup.
const scope = `$ErrorActionPreference = 'Stop'
$keys = @('Software\\${INSTALL_GUID}', 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${INSTALL_GUID}')
$links = @((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Web2Harness.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Web2Harness.lnk'))
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
`;

function run(script, file) {
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", scope + script], {
    env: { ...process.env, WEB2HARNESS_SETUP_SNAPSHOT: file }, encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || "Installation registration check failed");
}

function captureRegistration(file) {
  run(`$items = foreach ($location in $keys) {
  $key = $registry.OpenSubKey($location)
  if ($null -eq $key) { $null; continue }
  try {
    if ($key.GetSubKeyNames().Length -ne 0) { throw 'Unexpected child registration keys; setup stopped.' }
    $values = @(foreach ($name in $key.GetValueNames()) {
      @{ name = $name; kind = $key.GetValueKind($name).ToString(); value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    })
    @{ values = $values }
  } finally { $key.Dispose() }
}
$shortcuts = @(foreach ($link in $links) {
  if ([IO.File]::Exists($link)) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($link)) } else { $null }
})
$snapshot = @{ keys = @($items); shortcuts = $shortcuts } | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($env:WEB2HARNESS_SETUP_SNAPSHOT, $snapshot)
$registry.Dispose()`, file);
}

function restoreRegistration(file) {
  if (!fs.existsSync(file)) throw new Error("Installation registration recovery snapshot is missing");
  run(`$snapshot = Get-Content -LiteralPath $env:WEB2HARNESS_SETUP_SNAPSHOT -Raw | ConvertFrom-Json
if ($snapshot.keys.Count -ne 2 -or $snapshot.shortcuts.Count -ne 2) { throw 'Invalid installation registration snapshot' }
for ($i = 0; $i -lt 2; $i++) {
  $registry.DeleteSubKeyTree($keys[$i], $false)
  if ($null -ne $snapshot.keys[$i]) {
    $key = $registry.CreateSubKey($keys[$i])
    try {
      foreach ($entry in $snapshot.keys[$i].values) {
        $kind = [Enum]::Parse([Microsoft.Win32.RegistryValueKind], [string]$entry.kind)
        $value = $entry.value
        if ($kind -eq [Microsoft.Win32.RegistryValueKind]::DWord) { $value = [int]$value }
        elseif ($kind -eq [Microsoft.Win32.RegistryValueKind]::QWord) { $value = [long]$value }
        elseif ($kind -eq [Microsoft.Win32.RegistryValueKind]::Binary) { $value = [byte[]]$value }
        elseif ($kind -eq [Microsoft.Win32.RegistryValueKind]::MultiString) { $value = [string[]]$value }
        $key.SetValue([string]$entry.name, $value, $kind)
      }
    } finally { $key.Dispose() }
  }
  if ($null -eq $snapshot.shortcuts[$i]) { [IO.File]::Delete($links[$i]) }
  else { [IO.File]::WriteAllBytes($links[$i], [Convert]::FromBase64String($snapshot.shortcuts[$i])) }
}
$registry.Dispose()`, file);
}

module.exports = { INSTALL_GUID, captureRegistration, restoreRegistration };
