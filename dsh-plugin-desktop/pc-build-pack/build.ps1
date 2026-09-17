# Builds the IDEalize Windows installer from the source in this pack.
# Started by Build-IDEalize.cmd. Writes everything to the OUTPUT folder,
# including build-log.txt, which is the only thing to send back if it stops.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $root 'source'
$desktop = Join-Path $source 'dsh-plugin-desktop'
$output = Join-Path $root 'OUTPUT'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$log = Join-Path $output 'build-log.txt'
"IDEalize PC build started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Set-Content -Path $log -Encoding UTF8

function Write-Log([string] $message) {
  Write-Host $message
  Add-Content -Path $log -Value $message -Encoding UTF8
}

function Invoke-Step([string] $name, [string] $workingDirectory, [string] $command, [string[]] $arguments) {
  Write-Log ""
  Write-Log "==> $name"
  Write-Log "    $command $($arguments -join ' ')"
  Push-Location $workingDirectory
  try {
    # Native tools write progress to stderr; that is not an error, so the
    # exit code is the only verdict.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $command @arguments 2>&1 | ForEach-Object { $line = "$_"; Write-Host $line; Add-Content -Path $log -Value $line -Encoding UTF8 }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
  } finally {
    Pop-Location
  }
  if ($code -ne 0) {
    throw "Step '$name' failed with exit code $code."
  }
}

function Stop-WithInstructions([string[]] $lines) {
  Write-Log ""
  foreach ($line in $lines) { Write-Log $line }
  Write-Log ""
  exit 1
}

try {
  Write-Log "Pack folder: $root"

  # 1. This PC
  if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    Stop-WithInstructions @(
      "This build needs a 64-bit Windows PC with an Intel or AMD processor.",
      "This PC reports: $env:PROCESSOR_ARCHITECTURE"
    )
  }
  if ($root.Length -gt 60) {
    Write-Log "Warning: this folder's path is $($root.Length) characters long. Windows limits file paths, and the build creates deep folders."
    Write-Log "If the build fails with a path or ENAMETOOLONG error, move this whole folder to C:\idealize-build and run it again."
  }
  if (-not (Test-Path (Join-Path $source 'yarn.lock'))) {
    Stop-WithInstructions @("The source folder is missing or incomplete. Unzip the whole pack again and run this from inside the unzipped folder.")
  }

  # 2. Node.js, the only thing to install by hand
  $nodeInstall = @(
    "Node.js 22 is needed and was not found in a version this build accepts.",
    "Install it with one of these, then double-click Build-IDEalize.cmd again:",
    "  - In PowerShell:  winget install OpenJS.NodeJS.LTS --version 22.23.2",
    "  - Or download and run:  https://nodejs.org/dist/v22.23.2/node-v22.23.2-x64.msi",
    "Keep the installer's default options. Do not pick Node 25 or newer; the build refuses it."
  )
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) { Stop-WithInstructions $nodeInstall }
  $nodeVersion = (& node -p "process.versions.node").Trim()
  $nodeArch = (& node -p "process.arch").Trim()
  Write-Log "Node.js $nodeVersion ($nodeArch) at $($node.Source)"
  $match = [regex]::Match($nodeVersion, '^(\d+)\.(\d+)\.')
  $major = [int] $match.Groups[1].Value
  $minor = [int] $match.Groups[2].Value
  # The same rule as dsh-plugin-desktop/scripts/package-win.ts: 22.19+ or 24.x.
  if (-not (($major -eq 22 -and $minor -ge 19) -or $major -eq 24)) {
    Stop-WithInstructions (@("Found Node.js $nodeVersion.") + $nodeInstall)
  }
  if ($nodeArch -ne 'x64') {
    Stop-WithInstructions (@("Found a $nodeArch build of Node.js; the 64-bit x64 build is required.") + $nodeInstall)
  }
  if ($null -eq (Get-Command corepack -ErrorAction SilentlyContinue)) {
    Stop-WithInstructions (@("Node.js is installed but its 'corepack' command is missing. Reinstall Node.js from the link below with default options.") + $nodeInstall)
  }

  # 3. Environment the build relies on
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'   # Corepack would otherwise ask before fetching Yarn
  $env:DSH_TELEMETRY_DISABLED = '1'
  foreach ($name in @('npm_config_build_from_source', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD')) {
    if (Test-Path "Env:$name") { Remove-Item "Env:$name" }
  }

  # 4. The build. Each step is the same command the release workflow runs.
  Invoke-Step 'Downloading the project dependencies (several minutes)' $source 'corepack' @('yarn', 'install', '--immutable')
  Invoke-Step 'Checking and building the installer (the longest step)' $source 'corepack' @('yarn', 'dist:win')
  Invoke-Step 'Building the portable zip' $source 'corepack' @('yarn', 'dist:win-portable')

  # 5. Collect the results
  $manifest = Get-Content (Join-Path $desktop 'package.json') -Raw | ConvertFrom-Json
  $version = $manifest.version
  $dist = Join-Path $desktop 'dist'
  $setup = Join-Path $dist "IDEalize-$version-x64-Setup.exe"
  $portable = Join-Path $dist "IDEalize-$version-x64-Portable.zip"
  foreach ($file in @($setup, $portable)) {
    if (-not (Test-Path $file)) { throw "Expected output is missing: $file" }
  }
  Copy-Item $setup (Join-Path $output "IDEalize-$version-x64-Setup.exe") -Force
  Copy-Item $setup (Join-Path $output 'IDEalize-V1-Setup.exe') -Force
  Copy-Item $portable (Join-Path $output "IDEalize-$version-x64-Portable.zip") -Force
  Copy-Item (Join-Path $root 'PACK.json') (Join-Path $output 'PACK.json') -Force
  $sums = @()
  foreach ($name in @("IDEalize-$version-x64-Setup.exe", 'IDEalize-V1-Setup.exe', "IDEalize-$version-x64-Portable.zip")) {
    $hash = (Get-FileHash -Algorithm SHA256 (Join-Path $output $name)).Hash.ToLower()
    $sums += "$hash  $name"
  }
  [IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS-windows.txt'), (($sums -join "`n") + "`n"))

  Write-Log ""
  Write-Log "Build finished. Files in $output"
  Get-ChildItem $output | ForEach-Object { Write-Log ("    {0,12:n0} bytes  {1}" -f $_.Length, $_.Name) }
  Start-Process explorer.exe $output
  exit 0
} catch {
  Write-Log ""
  Write-Log "The build stopped: $($_.Exception.Message)"
  Write-Log "Please send $log to JJ. Nothing else is needed."
  exit 1
}
