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
    Required = @("package.json", "package-lock.json", "src/content-script.js", "scripts/build.mjs", "SOURCE_SUBMISSION.md")
    AllowedPrefixes = @("assets/", "scripts/", "src/", "store-assets/", "styles/", "tests/")
    AllowedFiles = @(".gitignore", "LICENSE", "manifest.json", "manifest.chrome.json", "manifest.firefox.json", "package.json", "package-lock.json", "PRIVACY.md", "README.md", "RELEASE.md", "SOURCE_SUBMISSION.md")
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

    $manifestEntries = $entries | Where-Object { $_ -in @("manifest.json", "manifest.chrome.json", "manifest.firefox.json") }
    foreach ($manifestEntry in $manifestEntries) {
      $entryObject = $archive.GetEntry($manifestEntry)
      if (-not $entryObject) {
        continue
      }
      $reader = New-Object System.IO.StreamReader($entryObject.Open())
      try {
        $manifest = $reader.ReadToEnd() | ConvertFrom-Json
      } finally {
        $reader.Dispose()
      }

      foreach ($contentScript in $manifest.content_scripts) {
        foreach ($match in $contentScript.matches) {
          if ($match -in @("<all_urls>", "*://*/*", "http://*/*", "https://*/*")) {
            throw "$($artifact.Name) manifest $manifestEntry contains broad content script match: $match"
          }
          if ($match -ne "https://www.youtube.com/*") {
            throw "$($artifact.Name) manifest $manifestEntry contains unexpected content script match: $match"
          }
        }
      }
      foreach ($hostPermission in $manifest.host_permissions) {
        if ($hostPermission -in @("<all_urls>", "*://*/*", "http://*/*", "https://*/*")) {
          throw "$($artifact.Name) manifest $manifestEntry contains broad host permission: $hostPermission"
        }
        if ($hostPermission -ne "https://www.youtube.com/*") {
          throw "$($artifact.Name) manifest $manifestEntry contains unexpected host permission: $hostPermission"
        }
      }
      if ($manifest.optional_permissions -and $manifest.optional_permissions.Count -gt 0) {
        throw "$($artifact.Name) manifest $manifestEntry should not declare optional_permissions."
      }
      if ($manifest.background -or $manifest.externally_connectable) {
        throw "$($artifact.Name) manifest $manifestEntry should not declare background or externally_connectable."
      }
      foreach ($permission in @("tabs", "activeTab", "scripting")) {
        if ($manifest.permissions -contains $permission) {
          throw "$($artifact.Name) manifest $manifestEntry contains unnecessary permission: $permission"
        }
      }
    }

    foreach ($entry in $entries) {
      if ($entry -like "*\*") {
        throw "$($artifact.Name) contains Windows-style path: $entry"
      }
      if (($artifact.Name -in @("Chrome ZIP", "Firefox XPI")) -and $entry -eq "scripts/universal-captions.js") {
        throw "$($artifact.Name) contains unreleased generic-video runtime code: $entry"
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
