# Builds a standalone arm64 APK for a real Android phone.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File .\scripts\build-phone-apk.ps1
$ErrorActionPreference = "Stop"

$mobile = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $mobile ".env"
if (-not (Test-Path $envFile)) {
    throw "Missing $envFile. Copy .env.example to .env and fill in the values."
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

$env:ANDROID_HOME = "C:\Android\Sdk"
$env:ANDROID_SDK_ROOT = "C:\Android\Sdk"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.21.9-hotspot"
$env:JAVA_TOOL_OPTIONS = "-Djava.net.preferIPv4Stack=true"

Push-Location (Join-Path $mobile "android")
try {
    & .\gradlew.bat assembleRelease "-PreactNativeArchitectures=arm64-v8a" -x lint -x test
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

$apk = Join-Path $mobile "android\app\build\outputs\apk\release\app-release.apk"
Write-Host ""
Write-Host "APK ready: $apk"
Write-Host "Install on a USB-connected phone with:"
Write-Host "  adb install -r `"$apk`""
