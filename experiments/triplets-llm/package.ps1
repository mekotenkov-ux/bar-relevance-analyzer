param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $projectRoot "artifacts\triplets-llm-deferred.zip"
}
$absoluteOutput = [System.IO.Path]::GetFullPath($OutputPath)

# This allowlist is intentionally explicit. Do not replace it with recursion or
# globs: doing so could package a local .env, model cache, report, or dependency.
$includedFiles = @(
  "LICENSE",
  "AUTHORS",
  "ATTRIBUTION.md",
  "NOTICE",
  "experiments/triplets-llm/README.md",
  "experiments/triplets-llm/package.ps1",
  "app/api/analyze-triplets/route.ts",
  "lib/semantic-triplets.ts",
  "services/triplets/.dockerignore",
  "services/triplets/acceptance.mjs",
  "services/triplets/app.py",
  "services/triplets/docker-compose.yml",
  "services/triplets/Dockerfile",
  "services/triplets/env.example",
  "services/triplets/grounding.py",
  "services/triplets/grounding_acceptance.py",
  "services/triplets/Modelfile.ollama",
  "services/triplets/README.md",
  "services/triplets/requirements.txt",
  "tests/triplets-v9.test.mjs"
)

$forbiddenPathPattern = "(^|/)(node_modules|__pycache__|\.next|dist|models?|model-cache|cache|volumes?)(/|$)"
$forbiddenExtensionPattern = "\.(gguf|safetensors|onnx|pt|pth|bin|pyc|pyo)$"
$resolvedFiles = foreach ($relativePath in $includedFiles) {
  $archivePath = $relativePath.Replace("\", "/")
  $leafName = [System.IO.Path]::GetFileName($archivePath)
  if ($archivePath -match $forbiddenPathPattern -or $archivePath -match $forbiddenExtensionPattern) {
    throw "Forbidden archive path: $archivePath"
  }
  if ($leafName -eq ".env" -or $leafName.StartsWith(".env.")) {
    throw "Environment file is forbidden: $archivePath"
  }

  $sourcePath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $relativePath))
  if (-not $sourcePath.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Archive source escapes the project root: $archivePath"
  }
  if (-not [System.IO.File]::Exists($sourcePath)) {
    throw "Required archive source is missing: $archivePath"
  }
  [PSCustomObject]@{ ArchivePath = $archivePath; SourcePath = $sourcePath }
}

$resolvedFiles = @($resolvedFiles | Sort-Object ArchivePath)
$outputDirectory = [System.IO.Path]::GetDirectoryName($absoluteOutput)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$temporaryOutput = "$absoluteOutput.tmp-$([System.Guid]::NewGuid().ToString('N'))"

Add-Type -AssemblyName System.IO.Compression
$fixedTimestamp = [System.DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)
$utf8 = [System.Text.UTF8Encoding]::new($false)
$manifestLines = [System.Collections.Generic.List[string]]::new()
$fileStream = $null
$zipArchive = $null

try {
  $fileStream = [System.IO.File]::Open(
    $temporaryOutput,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  $zipArchive = [System.IO.Compression.ZipArchive]::new(
    $fileStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false,
    $utf8
  )

  foreach ($file in $resolvedFiles) {
    $bytes = [System.IO.File]::ReadAllBytes($file.SourcePath)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha256.ComputeHash($bytes) }
    finally { $sha256.Dispose() }
    $hashText = -join ($hash | ForEach-Object { $_.ToString("x2") })
    $manifestLines.Add("$hashText  $($file.ArchivePath)")

    $entry = $zipArchive.CreateEntry(
      $file.ArchivePath,
      [System.IO.Compression.CompressionLevel]::NoCompression
    )
    $entry.LastWriteTime = $fixedTimestamp
    $entryStream = $entry.Open()
    try { $entryStream.Write($bytes, 0, $bytes.Length) }
    finally { $entryStream.Dispose() }
  }

  $manifestBytes = $utf8.GetBytes(($manifestLines -join "`n") + "`n")
  $manifestEntry = $zipArchive.CreateEntry(
    "ARCHIVE-MANIFEST.sha256",
    [System.IO.Compression.CompressionLevel]::NoCompression
  )
  $manifestEntry.LastWriteTime = $fixedTimestamp
  $manifestStream = $manifestEntry.Open()
  try { $manifestStream.Write($manifestBytes, 0, $manifestBytes.Length) }
  finally { $manifestStream.Dispose() }
}
finally {
  if ($null -ne $zipArchive) { $zipArchive.Dispose() }
  if ($null -ne $fileStream) { $fileStream.Dispose() }
}

try {
  if ([System.IO.File]::Exists($absoluteOutput)) {
    [System.IO.File]::Delete($absoluteOutput)
  }
  [System.IO.File]::Move($temporaryOutput, $absoluteOutput)
}
catch {
  if ([System.IO.File]::Exists($temporaryOutput)) {
    [System.IO.File]::Delete($temporaryOutput)
  }
  throw
}

$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $absoluteOutput).Hash.ToLowerInvariant()
Write-Output "Created: $absoluteOutput"
Write-Output "Files: $($resolvedFiles.Count + 1)"
Write-Output "SHA256: $archiveHash"
