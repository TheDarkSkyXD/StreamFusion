param(
  [string]$KeystorePath = "$env:USERPROFILE\.streamfusion\streamfusion-mobile-release.jks",
  [string]$Alias = "streamfusion-mobile",
  [int]$ValidityDays = 9131
)

$ErrorActionPreference = "Stop"

$keytool = Join-Path ${env:ProgramFiles} "Android\Android Studio\jbr\bin\keytool.exe"
if (-not (Test-Path -LiteralPath $keytool)) {
  throw "keytool not found at $keytool. Install Android Studio or set the JDK path."
}
if (Test-Path -LiteralPath $KeystorePath) {
  throw "$KeystorePath already exists. Android accepts an update only when the signing certificate matches, so replacing this key strands every installed copy. Restore the backup instead, or choose a new application id."
}

$storePassword = Read-Host "Keystore password (hidden, never written to disk by this script)" -AsSecureString
$keyPassword = Read-Host "Key password, or press Enter to reuse the keystore password" -AsSecureString

$env:STREAMFUSION_KEYSTORE_PASS = [System.Net.NetworkCredential]::new("", $storePassword).Password
$env:STREAMFUSION_KEY_PASS = if ($keyPassword.Length -eq 0) {
  $env:STREAMFUSION_KEYSTORE_PASS
} else {
  [System.Net.NetworkCredential]::new("", $keyPassword).Password
}

try {
  New-Item -ItemType Directory -Path (Split-Path -Parent $KeystorePath) -Force | Out-Null

  & $keytool -genkeypair `
    -alias $Alias `
    -keyalg RSA `
    -keysize 4096 `
    -sigalg SHA256withRSA `
    -validity $ValidityDays `
    -dname "CN=StreamFusion Mobile, OU=StreamFusion, O=StreamFusion, C=US" `
    -keystore $KeystorePath `
    -storetype PKCS12 `
    -storepass:env STREAMFUSION_KEYSTORE_PASS `
    -keypass:env STREAMFUSION_KEY_PASS 2>&1 | Out-String | Write-Verbose
  if ($LASTEXITCODE -ne 0) { throw "keytool failed with exit code $LASTEXITCODE" }

  $fingerprint = & $keytool -list -v -keystore $KeystorePath -storepass:env STREAMFUSION_KEYSTORE_PASS 2>$null |
    Where-Object { $_ -match "SHA256:" } |
    Select-Object -First 1 |
    ForEach-Object { (($_ -split "SHA256:")[1]).Trim() }
  if (-not $fingerprint) { throw "keytool created the keystore but reported no SHA-256 fingerprint" }

  $normalized = ($fingerprint -replace ":", "").ToLowerInvariant()
  if ($normalized -notmatch "^[0-9a-f]{64}$") {
    throw "Fingerprint is not 64 lowercase hex characters: $fingerprint"
  }

  Write-Output ""
  Write-Output "Keystore:  $KeystorePath"
  Write-Output "Alias:     $Alias"
  Write-Output "Valid for: $ValidityDays days ($([math]::Round($ValidityDays / 365.25, 1)) years)"
  Write-Output "SHA-256:   $fingerprint"
  Write-Output ""
  Write-Output "This keystore is now the durable identity of StreamFusion Mobile. Back it up twice,"
  Write-Output "encrypted, in separate physical locations, before continuing. Then record the"
  Write-Output "fingerprint in the Android Developer Console and pin it in this repository:"
  Write-Output ""
  Write-Output "  npm run --workspace @streamfusion/mobile verify:release -- --pin $normalized <recorded-by>"
} finally {
  Remove-Item Env:\STREAMFUSION_KEYSTORE_PASS -ErrorAction SilentlyContinue
  Remove-Item Env:\STREAMFUSION_KEY_PASS -ErrorAction SilentlyContinue
  $storePassword = $null
  $keyPassword = $null
}
