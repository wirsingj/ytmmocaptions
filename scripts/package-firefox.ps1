$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = Split-Path -Parent $PSScriptRoot
$firefoxBuild = Join-Path $projectRoot "build\firefox"
$manifestPath = Join-Path $firefoxBuild "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Firefox build manifest not found: $manifestPath. Run npm run build first."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "Firefox manifest is missing version."
}
$xpiPath = Join-Path $firefoxBuild ("ytmmocaptions-firefox-v" + $version + ".xpi")

if (-not $manifest.browser_specific_settings -or -not $manifest.browser_specific_settings.gecko) {
  throw "Firefox manifest is missing browser_specific_settings.gecko."
}

$dataCollection = $manifest.browser_specific_settings.gecko.data_collection_permissions
if (-not $dataCollection -or -not $dataCollection.required -or -not ($dataCollection.required -contains "none")) {
  throw "Firefox manifest is missing required gecko.data_collection_permissions.required=['none']."
}

foreach ($contentScript in $manifest.content_scripts) {
  foreach ($jsFile in $contentScript.js) {
    $filePath = Join-Path $firefoxBuild $jsFile
    if (-not (Test-Path -LiteralPath $filePath)) {
      throw "Missing runtime JS file: $filePath"
    }
  }
  foreach ($cssFile in $contentScript.css) {
    $filePath = Join-Path $firefoxBuild $cssFile
    if (-not (Test-Path -LiteralPath $filePath)) {
      throw "Missing runtime CSS file: $filePath"
    }
  }
}

Get-ChildItem -LiteralPath $firefoxBuild -File -Filter "ytmmocaptions-firefox-v*.xpi" |
  Remove-Item -Force

$fileStream = [System.IO.File]::Open($xpiPath, [System.IO.FileMode]::CreateNew)
$files = Get-ChildItem -LiteralPath $firefoxBuild -Recurse -File | Where-Object {
  $_.FullName -ne $xpiPath -and $_.Extension -notin @(".xpi", ".zip")
}
try {
  $zip = New-Object System.IO.Compression.ZipArchive($fileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($file in $files) {
      $entryName = $file.FullName.Substring($firefoxBuild.Length + 1).Replace("\", "/")
      $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $entryStream = $entry.Open()
      try {
        $inputStream = [System.IO.File]::OpenRead($file.FullName)
        try {
          $inputStream.CopyTo($entryStream)
        } finally {
          $inputStream.Dispose()
        }
      } finally {
        $entryStream.Dispose()
      }
    }
  } finally {
    $zip.Dispose()
  }
} finally {
  $fileStream.Dispose()
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($xpiPath)
try {
  $hasBackslashEntries = $archive.Entries | Where-Object { $_.FullName -like "*\*" }
  if ($hasBackslashEntries) {
    throw "XPI contains Windows-style backslash archive paths."
  }
  if (-not ($archive.Entries | Where-Object { $_.FullName -eq "manifest.json" })) {
    throw "XPI is missing manifest.json at archive root."
  }
} finally {
  $archive.Dispose()
}

Write-Output "Firefox XPI packaged successfully:"
Write-Output $xpiPath
