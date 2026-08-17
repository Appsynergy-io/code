# Code native bootstrap. irm ... | iex compatible: no param(); target is $args[0].
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'

$Target = $null
if ($args.Count -ge 1 -and $args[0]) {
    $Target = [string]$args[0]
}

if ($Target -and $Target -notmatch '^(stable|latest|\d+\.\d+\.\d+(-[^\s]+)?)$') {
    Write-Error "Usage: install.ps1 [stable|latest|VERSION]"
    exit 1
}

# Check for 32-bit Windows
if (-not [Environment]::Is64BitProcess) {
    Write-Error "Code does not support 32-bit Windows. Please use a 64-bit version of Windows."
    exit 1
}

$DOWNLOAD_BASE_URL = "https://github.com/Appsynergy-io/code/releases/download/release-index"
$CLI_NAME = "code"
$DOWNLOAD_DIR = "$env:USERPROFILE\.claude\downloads"

# Use native ARM64 binary on ARM64 Windows, x64 otherwise
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
    $platform = "win32-arm64"
} else {
    $platform = "win32-x64"
}
New-Item -ItemType Directory -Force -Path $DOWNLOAD_DIR | Out-Null

function Get-RemoteText {
    param([string]$Url)
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -ErrorAction Stop
    $content = $response.Content
    if ($content -is [byte[]]) {
        return [System.Text.Encoding]::UTF8.GetString($content).Trim()
    }
    return ([string]$content).Trim()
}

# Version number → that build; otherwise the channel pointer (default latest)
if ($Target -match '^\d+\.\d+\.\d+(-[^\s]+)?$') {
    $version = $Target
} else {
    $channel = if ($Target) { $Target } else { "latest" }
    try {
        $version = Get-RemoteText "$DOWNLOAD_BASE_URL/$channel"
    }
    catch {
        Write-Error "Failed to get version: $_"
        exit 1
    }
}

# Reject non-version content (e.g. an HTML error page) before it reaches the manifest URL
if ($version -notmatch '^\d+\.\d+\.\d+') {
    Write-Error "Failed to get a valid version from the release index (got unexpected content)."
    exit 1
}

try {
    $manifest = Get-RemoteText "$DOWNLOAD_BASE_URL/${version}-manifest.json" | ConvertFrom-Json
    $checksum = $manifest.platforms.$platform.checksum

    if (-not $checksum) {
        Write-Error "Platform $platform not found in manifest"
        exit 1
    }
}
catch {
    Write-Error "Failed to get manifest: $_"
    exit 1
}

# Download and verify
$binaryPath = "$DOWNLOAD_DIR\$CLI_NAME-$version-$platform.exe"
try {
    Invoke-WebRequest -Uri "$DOWNLOAD_BASE_URL/${version}-${platform}-${CLI_NAME}.exe" -OutFile $binaryPath -UseBasicParsing -ErrorAction Stop
}
catch {
    Write-Error "Failed to download binary: $_"
    if (Test-Path $binaryPath) {
        Remove-Item -Force $binaryPath
    }
    exit 1
}

# Calculate checksum
$actualChecksum = (Get-FileHash -Path $binaryPath -Algorithm SHA256).Hash.ToLower()

if ($actualChecksum -ne $checksum) {
    Write-Error "Checksum verification failed"
    Remove-Item -Force $binaryPath
    exit 1
}

# Run code install to set up launcher and shell integration
Write-Output "Setting up Code..."
$installExitCode = 1
try {
    if ($Target) {
        & $binaryPath install $Target
    }
    else {
        & $binaryPath install
    }
    # Native exit codes don't trigger $ErrorActionPreference - capture explicitly
    $installExitCode = $LASTEXITCODE
}
finally {
    try {
        # Clean up downloaded file
        # Wait a moment for any file handles to be released
        Start-Sleep -Seconds 1
        Remove-Item -Force $binaryPath
    }
    catch {
        Write-Warning "Could not remove temporary file: $binaryPath"
    }
}

if ($installExitCode -ne 0) {
    Write-Error "Installation failed (exit code $installExitCode)"
    exit $installExitCode
}

Write-Output ""
Write-Output "$([char]0x2705) Installation complete!"
Write-Output ""
Write-Output "code is now on your PATH via $env:USERPROFILE\.local\bin"
Write-Output ""
