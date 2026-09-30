# Recovering the StreamFusion Mobile production signing key

Android accepts an update only when the signing certificate and `versionCode` match the installed app. Losing the production keystore and its passwords means a new application ID and a fresh install for every user. Treat these files as the most important secret in the project.

## What exists

| Item | Location |
| --- | --- |
| Keystore | `%USERPROFILE%\.streamfusion\streamfusion-mobile-release.jks` |
| Keystore and key password | `%USERPROFILE%\.streamfusion\streamfusion-mobile-release-credentials.txt` |
| Encrypted offline backup | `%USERPROFILE%\.streamfusion\backup\streamfusion-mobile-release.jks.7z` |
| Backup passphrase | `%USERPROFILE%\.streamfusion\backup\streamfusion-mobile-release-backup-passphrase.txt` |
| Public certificate | `apps/mobile/config/production-signing-certificate.json` |

Both directories are ACL-restricted to your Windows account. The pinned SHA-256 fingerprint is `e84285558899c9eef61d5c8cd28f5fdb59ff70240246e7a073cb622642ef3c57`, which is the certificate every published APK must carry.

## The plaintext files are the weak point

The two `.txt` files hold the passwords in plain text on one machine. They exist so the work is not lost, not as a resting state.

1. Move both passwords into a password manager now.
2. Delete `streamfusion-mobile-release-credentials.txt`.
3. Delete `streamfusion-mobile-release-backup-passphrase.txt`.
4. Copy the `.7z` archive to two encrypted offline locations, such as a password-manager file attachment and an encrypted USB drive in a different physical place.
5. Confirm the password manager holds the archive, not only the keystore.

The archive uses a different passphrase from the keystore, so a stolen archive on its own cannot sign anything.

## Confirm a backup is real

A backup that has never been restored is a guess. Extract the archive to a scratch directory and compare the fingerprint:

```powershell
$pass = Read-Host "archive passphrase" -AsSecureString
$env:SF = [System.Net.NetworkCredential]::new("", $pass).Password
& "C:\Program Files\7-Zip\7z.exe" x `
  "$env:USERPROFILE\.streamfusion\backup\streamfusion-mobile-release.jks.7z" `
  "-o$env:TEMP\streamfusion-restore" -p"$env:SF" -y
Remove-Item Env:\SF
```

Then read the fingerprint from the restored keystore and confirm it equals the pinned value above. Repeat that drill every six months and after any credential or machine change.

## Signing a new release

The release workflow materializes the keystore from repository secrets, so the local file is only needed for a manual build or a recovery. The secrets are `STREAMFUSION_MOBILE_KEYSTORE_BASE64`, `STREAMFUSION_MOBILE_KEYSTORE_PASSWORD`, `STREAMFUSION_MOBILE_KEY_ALIAS`, and `STREAMFUSION_MOBILE_KEY_PASSWORD`.

Rotating the signer is not a routine operation. A new certificate cannot update an existing install, so rotation means a new application ID. Proof-of-rotation under APK Signature Scheme v3 is possible but is a migration with its own device matrix, not a fix for a lost key.
