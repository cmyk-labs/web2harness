const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { assertPlainPath, recordPaths } = require("./installation-record.cjs");
const { writePrivateFileAtomic } = require("../common/atomic-file.cjs");

function stageShortcutIcon(options) {
  assertPlainPath(options.shortcutIconSource);
  const stat = fs.statSync(options.shortcutIconSource);
  if (!stat.isFile() || stat.size < 6 || stat.size > 2 * 1024 * 1024) throw new Error("Invalid shortcut icon");
  const bytes = fs.readFileSync(options.shortcutIconSource);
  if (bytes.readUInt32LE(0) !== 0x00010000 || bytes.readUInt16LE(4) === 0) throw new Error("Expected an ICO shortcut icon");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const icon = path.join(recordPaths(options.appData, options.installRoot).directory, `shortcut-${digest}.ico`);
  assertPlainPath(icon);
  if (fs.existsSync(icon)) {
    if (!fs.readFileSync(icon).equals(bytes)) throw new Error("Stored shortcut icon failed verification");
  } else writePrivateFileAtomic(icon, bytes);
  return icon;
}

// Optional explicit links are for isolated fixtures. Production uses only the two
// standard shortcuts, and edits neither the target nor unrelated same-name links.
function setShortcutIcons(installRoot, icon, links) {
  assertPlainPath(installRoot);
  assertPlainPath(icon);
  for (const link of links || []) assertPlainPath(link);
  const script = `$ErrorActionPreference = 'Stop'
$inputData = $env:WEB2HARNESS_SHORTCUT_INPUT | ConvertFrom-Json
$links = $inputData.links
if ($null -eq $links) {
  $links = @((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Web2Harness.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Web2Harness.lnk'))
}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class W2HShortcutNotify { [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern void SHChangeNotify(uint e, uint f, string p, IntPtr q); }'
$shell = New-Object -ComObject WScript.Shell
try {
  foreach ($link in $links) {
    if (!(Test-Path -LiteralPath $link -PathType Leaf)) { continue }
    $current = Get-Item -LiteralPath $link
    while ($null -ne $current) {
      if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected shortcut path' }
      $current = if ($current -is [IO.FileInfo]) { $current.Directory } else { $current.Parent }
    }
    $shortcut = $shell.CreateShortcut($link)
    try {
      if (![string]::Equals($shortcut.TargetPath, $inputData.target, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $shortcut.IconLocation = $inputData.icon + ',0'
      $shortcut.Save()
      [W2HShortcutNotify]::SHChangeNotify(0x2000, 0x5, $link, [IntPtr]::Zero)
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
  }
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
`;
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, WEB2HARNESS_SHORTCUT_INPUT: JSON.stringify({ target: path.join(installRoot, "Web2Harness.exe"), icon, links }) },
    encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || "Shortcut icon update failed");
}

function removeSetupAssets(directory) {
  assertPlainPath(directory);
  for (const name of fs.readdirSync(directory)) {
    if (!/^shortcut-[a-f0-9]{64}\.ico$/.test(name) && name !== "setup-timings.jsonl") continue;
    const file = path.join(directory, name);
    assertPlainPath(file);
    if (!fs.statSync(file).isFile()) throw new Error("Unexpected setup asset");
    fs.unlinkSync(file);
  }
}

module.exports = { stageShortcutIcon, setShortcutIcons, removeSetupAssets };
