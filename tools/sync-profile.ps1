# Sync this package into an installed DSH profile.
#
# A `file:` pnpm dependency is copied (hard-linked) into the profile, so edits do
# not reach the running host by themselves. Run this after changing a file; DSH's
# client HMR then reloads the browser half on its own. A page refresh (Ctrl+R)
# picks up a changed manifest or a newly added file.
#
# Usage:  pwsh -File tools/sync-profile.ps1 [-Profile desktop] [-Home "$env:USERPROFILE\.dsh"]

param(
  [string]$Profile = 'desktop',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [string]$Source = (Split-Path -Parent $PSScriptRoot)
)

$destination = Join-Path $DshHome "profiles\$Profile\node_modules\dsh-account-odometer"
if (-not (Test-Path $destination)) {
  Write-Error "dsh-account-odometer is not installed in profile '$Profile' ($destination)."
  exit 1
}

$files = @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\client.js', 'README.md')
foreach ($relative in $files) {
  $from = Join-Path $Source $relative
  $to = Join-Path $destination $relative
  if (-not (Test-Path $from)) { continue }
  [System.IO.File]::WriteAllBytes($to, [System.IO.File]::ReadAllBytes($from))
  Write-Output "synced $relative"
}
