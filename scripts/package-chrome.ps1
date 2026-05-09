$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = Split-Path -Parent $PSScriptRoot
$chromeBuild = Join-Path $projectRoot "build\chrome"
$manifestPath = Join-Path $chromeBuild "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Chrome build manifest not found: $manifestPath. Run npm run build first."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "Chrome manifest is missing version."
}
$zipPath = Join-Path $chromeBuild ("ytmmocaptions-chrome-v" + $version + ".zip")

foreach ($contentScript in $manifest.content_scripts) {
  foreach ($jsFile in $contentScript.js) {
    $filePath = Join-Path $chromeBuild $jsFile
    if (-not (Test-Path -LiteralPath $filePath)) {
      throw "Missing runtime JS file: $filePath"
    }
  }
  foreach ($cssFile in $contentScript.css) {
    $filePath = Join-Path $chromeBuild $cssFile
    if (-not (Test-Path -LiteralPath $filePath)) {
      throw "Missing runtime CSS file: $filePath"
    }
  }
}

Get-ChildItem -LiteralPath $chromeBuild -File -Filter "ytmmocaptions-chrome-v*.zip" |
  Remove-Item -Force

$files = Get-ChildItem -LiteralPath $chromeBuild -Recurse -File | Where-Object {
  $_.FullName -ne $zipPath -and $_.Extension -notin @(".zip", ".xpi")
}
$fileStream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
try {
  $zip = New-Object System.IO.Compression.ZipArchive($fileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($file in $files) {
      $entryName = $file.FullName.Substring($chromeBuild.Length + 1).Replace("\", "/")
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

$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $hasBackslashEntries = $archive.Entries | Where-Object { $_.FullName -like "*\*" }
  if ($hasBackslashEntries) {
    throw "Chrome zip contains Windows-style backslash archive paths."
  }
  if (-not ($archive.Entries | Where-Object { $_.FullName -eq "manifest.json" })) {
    throw "Chrome zip is missing manifest.json at archive root."
  }
} finally {
  $archive.Dispose()
}

Write-Output "Chrome ZIP packaged successfully:"
Write-Output $zipPath
