$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = Split-Path -Parent $PSScriptRoot
$downloads = Join-Path $projectRoot "downloads"
$manifestPath = Join-Path $projectRoot "manifest.firefox.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Missing manifest.firefox.json."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "Manifest is missing version."
}

New-Item -ItemType Directory -Path $downloads -Force | Out-Null
$sourceZip = Join-Path $downloads ("ytmmocaptions-source-v" + $version + ".zip")
if (Test-Path -LiteralPath $sourceZip) {
  Remove-Item -LiteralPath $sourceZip -Force
}

$tempParent = [System.IO.Path]::GetTempPath()
$tempRoot = Join-Path $tempParent ("ytmmocaptions-source-v" + $version)
$resolvedTempParent = (Resolve-Path $tempParent).Path
if (-not $tempRoot.StartsWith($resolvedTempParent, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unexpected temp path: $tempRoot"
}
if (Test-Path -LiteralPath $tempRoot) {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $tempRoot | Out-Null

$dirs = @("assets", "scripts", "src", "store-assets", "styles")
foreach ($dir in $dirs) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $dir) -Destination (Join-Path $tempRoot $dir) -Recurse
}

$testsSource = Join-Path $projectRoot "tests"
$testsDestination = Join-Path $tempRoot "tests"
New-Item -ItemType Directory -Path $testsDestination -Force | Out-Null
Get-ChildItem -LiteralPath $testsSource -Recurse -File | Where-Object {
  $relativePath = $_.FullName.Substring($testsSource.Length + 1).Replace("\", "/")
  -not $relativePath.StartsWith("artifacts/", [System.StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object {
  $relativePath = $_.FullName.Substring($testsSource.Length + 1)
  $destinationPath = Join-Path $testsDestination $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $destinationPath
}

$files = @(
  ".gitignore",
  "LICENSE",
  "manifest.json",
  "manifest.chrome.json",
  "manifest.firefox.json",
  "package.json",
  "package-lock.json",
  "PRIVACY.md",
  "README.md",
  "RELEASE.md",
  "SOURCE_SUBMISSION.md"
)
foreach ($file in $files) {
  $path = Join-Path $projectRoot $file
  if (Test-Path -LiteralPath $path) {
    Copy-Item -LiteralPath $path -Destination (Join-Path $tempRoot $file)
  }
}

$fileStream = [System.IO.File]::Open($sourceZip, [System.IO.FileMode]::CreateNew)
try {
  $zip = New-Object System.IO.Compression.ZipArchive($fileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    $sourceFiles = Get-ChildItem -LiteralPath $tempRoot -Recurse -File | Sort-Object -Property FullName
    $entryTimestamp = [System.DateTimeOffset]::Parse("2024-01-01T00:00:00Z")
    foreach ($file in $sourceFiles) {
      $entryName = $file.FullName.Substring($tempRoot.Length + 1).Replace("\", "/")
      $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = $entryTimestamp
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

Remove-Item -LiteralPath $tempRoot -Recurse -Force

$archive = [System.IO.Compression.ZipFile]::OpenRead($sourceZip)
try {
  $hasBackslashEntries = $archive.Entries | Where-Object { $_.FullName -like "*\*" }
  if ($hasBackslashEntries) {
    throw "Source ZIP contains Windows-style backslash archive paths."
  }
  if (-not ($archive.Entries | Where-Object { $_.FullName -eq "package.json" })) {
    throw "Source ZIP is missing package.json at archive root."
  }
} finally {
  $archive.Dispose()
}

Write-Output "Source package created successfully:"
Write-Output $sourceZip
