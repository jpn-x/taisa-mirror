# Builds the release ZIP: release\mirrorx-vX.Y.Z-win-x64.zip (+ SHA256SUMS.txt, BUILD-INFO.json).
# Bundles the official, Authenticode-signed node.exe (verified against nodejs.org SHASUMS256.txt) so end users
# need to install nothing. No other binaries are included: everything else is plain JavaScript + one WebAssembly file.
param([string]$NodeVersion = 'v24.19.0')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$ver = $pkg.version
$name = "mirrorx-v$ver-win-x64"
$work = Join-Path $root '.tmp\package'
$stage = Join-Path $work $name
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage, "$stage\runtime", (Join-Path $root 'release') | Out-Null

# 1. official Node.js (signed) with checksum verification
$base = "https://nodejs.org/dist/$NodeVersion"
$zipName = "node-$NodeVersion-win-x64.zip"
Invoke-WebRequest "$base/SHASUMS256.txt" -OutFile "$work\SHASUMS256.txt"
Invoke-WebRequest "$base/$zipName" -OutFile "$work\$zipName"
$expected = ((Get-Content "$work\SHASUMS256.txt" | Where-Object { $_ -match [regex]::Escape($zipName) + '$' }) -split '\s+')[0]
$actual = (Get-FileHash "$work\$zipName" -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { throw "Node.js checksum mismatch! expected $expected got $actual" }
Expand-Archive "$work\$zipName" -DestinationPath "$work\node" -Force
$nodeDir = Join-Path "$work\node" "node-$NodeVersion-win-x64"
Copy-Item "$nodeDir\node.exe" "$stage\runtime\node.exe"
Copy-Item "$nodeDir\LICENSE" "$stage\runtime\NODE-LICENSE.txt"
$sig = Get-AuthenticodeSignature "$stage\runtime\node.exe"
if ($sig.Status -ne 'Valid') { throw "node.exe signature is not valid: $($sig.Status)" }
Write-Host "node.exe signed by: $($sig.SignerCertificate.Subject)"

# 2. project files
foreach ($d in 'server', 'web', 'docs', 'assets') { Copy-Item $d "$stage\$d" -Recurse }
New-Item -ItemType Directory "$stage\engine", "$stage\scripts" | Out-Null
Copy-Item engine\playfair.wasm, engine\playfair.wasm.sha256, engine\pf_wrapper.c "$stage\engine"
Copy-Item engine\playfair "$stage\engine\playfair" -Recurse
Copy-Item scripts\create-shortcut.ps1, scripts\build-wasm.sh, scripts\fake-iphone.js, scripts\mdns-probe.js, scripts\firewall.ps1 "$stage\scripts"
Copy-Item 'Start MirrorX.cmd', 'はじめにお読みください.txt', 'ショートカットを作る.cmd', README.md, LICENSE, THIRD_PARTY_NOTICES.md, package.json $stage

# 3. provenance
$commit = (git rev-parse HEAD).Trim()
$info = [ordered]@{
  name = $name; version = $ver; gitCommit = $commit; builtAt = (Get-Date).ToUniversalTime().ToString('o')
  node = [ordered]@{ version = $NodeVersion; sha256OfOfficialZip = $actual; signer = $sig.SignerCertificate.Subject }
  playfairWasmSha256 = ((Get-Content engine\playfair.wasm.sha256 -Raw) -split '\s+')[0]
  source = 'https://github.com/jpn-x/taisa-mirror'
}
$info | ConvertTo-Json -Depth 5 | Set-Content "$stage\BUILD-INFO.json" -Encoding UTF8

# 4. zip + SHA256
$out = Join-Path $root "release\$name.zip"
Remove-Item $out -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $stage -DestinationPath $out -CompressionLevel Optimal
$h = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
"$h  $name.zip" | Set-Content (Join-Path $root 'release\SHA256SUMS.txt') -Encoding ASCII
Write-Host "`n$out`nSHA256: $h"
