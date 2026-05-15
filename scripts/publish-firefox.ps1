param(
  [ValidateSet("upload", "publish")]
  [string]$Mode = $(if ($env:STORE_PUBLISH_MODE) { $env:STORE_PUBLISH_MODE } else { "upload" })
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$firefoxBuild = Join-Path $projectRoot "build\firefox"
$manifestPath = Join-Path $firefoxBuild "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Firefox build manifest not found: $manifestPath. Run npm run build first."
}

if ($Mode -eq "upload") {
  Write-Output "Firefox AMO publish skipped because mode=upload."
  Write-Output "Running AMO-safe lint only. Set STORE_PUBLISH_MODE=publish after environment approval to submit with web-ext sign."
  npx --yes web-ext lint --source-dir $firefoxBuild
  exit $LASTEXITCODE
}

if (-not $env:AMO_JWT_ISSUER) {
  throw "Missing required environment variable: AMO_JWT_ISSUER"
}
if (-not $env:AMO_JWT_SECRET) {
  throw "Missing required environment variable: AMO_JWT_SECRET"
}

$artifactsDir = Join-Path $projectRoot "build\firefox-amo"
if (Test-Path -LiteralPath $artifactsDir) {
  Remove-Item -LiteralPath $artifactsDir -Recurse -Force
}
New-Item -ItemType Directory -Path $artifactsDir | Out-Null

$webExtArgs = @(
  "--yes",
  "web-ext",
  "sign",
  "--source-dir", $firefoxBuild,
  "--artifacts-dir", $artifactsDir,
  "--channel", "listed",
  "--api-key", $env:AMO_JWT_ISSUER,
  "--api-secret", $env:AMO_JWT_SECRET,
  "--timeout", "900000"
)

if ($env:FIREFOX_EXTENSION_ID) {
  $webExtArgs += @("--id", $env:FIREFOX_EXTENSION_ID)
}

npx @webExtArgs
exit $LASTEXITCODE
