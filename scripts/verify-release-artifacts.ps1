$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$packageJson.version

if ([string]::IsNullOrWhiteSpace($version)) {
  throw "package.json is missing version."
}

$artifacts = @(
  @{
    Name = "Chrome ZIP"
    Path = Join-Path $projectRoot ("build\chrome\ytmmocaptions-chrome-v" + $version + ".zip")
    Required = @("manifest.json", "scripts/content-script.js", "styles/panel.css")
    AllowedPrefixes = @("assets/", "scripts/", "styles/")
    AllowedFiles = @("manifest.json", "LICENSE", "PRIVACY.md", "README.md")
  },
  @{
    Name = "Firefox XPI"
    Path = Join-Path $projectRoot ("build\firefox\ytmmocaptions-firefox-v" + $version + ".xpi")
    Required = @("manifest.json", "scripts/content-script.js", "styles/panel.css")
    AllowedPrefixes = @("assets/", "scripts/", "styles/")
    AllowedFiles = @("manifest.json", "LICENSE", "PRIVACY.md", "README.md")
  },
  @{
    Name = "Source ZIP"
    Path = Join-Path $projectRoot ("downloads\ytmmocaptions-source-v" + $version + ".zip")
    Required = @("package.json", "src/content-script.js", "scripts/build.mjs", "SOURCE_SUBMISSION.md")
    AllowedPrefixes = @("assets/", "scripts/", "src/", "store-assets/", "styles/", "tests/")
    AllowedFiles = @(".gitignore", "LICENSE", "manifest.json", "manifest.chrome.json", "manifest.firefox.json", "package.json", "PRIVACY.md", "README.md", "RELEASE.md", "SOURCE_SUBMISSION.md")
  }
)

$blockedSegments = @(
  ".git/",
  ".github/",
  "build/",
  "dist/",
  "downloads/",
  "node_modules/",
  "coverage/",
  "tmp/",
  "temp/",
  ".playwright-user-data",
  "tests/artifacts/"
)

foreach ($artifact in $artifacts) {
  if (-not (Test-Path -LiteralPath $artifact.Path)) {
    throw "$($artifact.Name) is missing: $($artifact.Path)"
  }

  $archive = [System.IO.Compression.ZipFile]::OpenRead($artifact.Path)
  try {
    $entries = $archive.Entries | ForEach-Object { $_.FullName }

    foreach ($required in $artifact.Required) {
      if (-not ($entries -contains $required)) {
        throw "$($artifact.Name) is missing $required."
      }
    }

    foreach ($entry in $entries) {
      if ($entry -like "*\*") {
        throw "$($artifact.Name) contains Windows-style path: $entry"
      }
      foreach ($blocked in $blockedSegments) {
        if ($entry.StartsWith($blocked, [System.StringComparison]::OrdinalIgnoreCase)) {
          throw "$($artifact.Name) contains blocked file path: $entry"
        }
      }

      $allowed = $artifact.AllowedFiles -contains $entry
      if (-not $allowed) {
        foreach ($prefix in $artifact.AllowedPrefixes) {
          if ($entry.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $allowed = $true
            break
          }
        }
      }
      if (-not $allowed) {
        throw "$($artifact.Name) contains unexpected file: $entry"
      }
    }
  } finally {
    $archive.Dispose()
  }

  Write-Output "$($artifact.Name) verified: $($artifact.Path)"
}
