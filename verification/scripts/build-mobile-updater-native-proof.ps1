param(
  [string]$ProofRoot = (Join-Path $env:TEMP "streamfusion-updater-native-proof"),
  [string]$AndroidSdk = "C:/Users/Admin/AppData/Local/Android/Sdk",
  [string]$JavaDirectory = "C:/Program Files/Android/Android Studio/jbr"
)
$ErrorActionPreference = "Stop"
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$module = Join-Path $repository "apps/mobile/modules/streamfusion-native-contracts/android"
$wrapper = Join-Path $repository "apps/mobile/android"
$proof = [IO.Path]::GetFullPath($ProofRoot)
if (!(Test-Path -LiteralPath (Join-Path $wrapper "gradlew.bat"))) {
  throw "Run npx expo prebuild --platform android --no-install in apps/mobile first."
}
if (!(Test-Path -LiteralPath (Join-Path $JavaDirectory "bin/keytool.exe"))) { throw "JDK keytool is missing." }
if (!(Test-Path -LiteralPath $AndroidSdk)) { throw "Android SDK is missing." }
New-Item -ItemType Directory -Force $proof | Out-Null
Copy-Item -LiteralPath (Join-Path $wrapper "gradlew.bat") -Destination $proof -Force
Copy-Item -LiteralPath (Join-Path $wrapper "gradle") -Destination $proof -Recurse -Force
$source = Join-Path $proof "src/main/java/expo/modules/streamfusionnativecontracts"
$test = Join-Path $proof "src/test/java/expo/modules/streamfusionnativecontracts"
New-Item -ItemType Directory -Force $source, $test | Out-Null
foreach ($name in @("UpdaterEngine", "UpdaterRecord", "UpdaterVerifier", "UpdaterTransport", "UpdaterForegroundService", "UpdateInstallReceiver", "UpdateConsentActivity")) {
  Copy-Item -LiteralPath (Join-Path $module "src/main/java/expo/modules/streamfusionnativecontracts/$name.kt") -Destination $source -Force
}
Copy-Item -LiteralPath (Join-Path $module "src/androidTest/java/expo/modules/streamfusionnativecontracts/UpdaterProofActivity.kt") -Destination $source -Force
$engineSource = Join-Path $module "src/main/java/expo/modules/streamfusionnativecontracts/UpdaterEngine.kt"
$engineHash = (Get-FileHash -LiteralPath $engineSource -Algorithm SHA256).Hash
foreach ($name in @("UpdaterCancellationTest", "UpdaterRecordTest", "UpdaterVerifierTest", "UpdaterHandoffTest")) {
  Copy-Item -LiteralPath (Join-Path $module "src/test/java/expo/modules/streamfusionnativecontracts/$name.kt") -Destination $test -Force
}
$testResources = Join-Path $proof "src/test/resources"
New-Item -ItemType Directory -Force $testResources | Out-Null
$renameShadow = Join-Path $test "ProofAtomicFileRenameShadow.java"
if ($env:OS -eq "Windows_NT") {
  [IO.File]::WriteAllText($renameShadow, @'
package expo.modules.streamfusionnativecontracts;

import android.util.AtomicFile;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;

@Implements(AtomicFile.class)
public class ProofAtomicFileRenameShadow {
  @Implementation
  protected static void rename(File source, File target) {
    try {
      Files.move(source.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
    } catch (IOException error) {
      throw new IllegalStateException("Atomic journal rename failed", error);
    }
  }
}
'@)
  [IO.File]::WriteAllText((Join-Path $testResources "robolectric.properties"), "sdk=35`nshadows=expo.modules.streamfusionnativecontracts.ProofAtomicFileRenameShadow`n")
  Write-Output "Windows Robolectric tests replace AtomicFile's File.renameTo with Files.move(REPLACE_EXISTING). Production APKs do not include this shadow."
} else {
  if (Test-Path -LiteralPath $renameShadow) { Remove-Item -LiteralPath $renameShadow }
  [IO.File]::WriteAllText((Join-Path $testResources "robolectric.properties"), "sdk=35`n")
}
[IO.File]::WriteAllText((Join-Path $proof "settings.gradle"), @'
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = 'StreamFusionUpdaterNativeProof'
'@)
[IO.File]::WriteAllText((Join-Path $proof "build.gradle"), @'
plugins {
  id 'com.android.application' version '8.13.1'
  id 'org.jetbrains.kotlin.android' version '2.2.21'
}
android {
  namespace 'expo.modules.streamfusionnativecontracts.updateproof'
  compileSdk 36
  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
  signingConfigs {
    proof {
      storeFile file('proof.keystore')
      storePassword 'streamfusion-proof'
      keyAlias 'updater-proof'
      keyPassword 'streamfusion-proof'
    }
  }
  defaultConfig {
    applicationId 'expo.modules.streamfusionnativecontracts.updateproof'
    minSdk 30
    targetSdk 36
    versionCode = Integer.parseInt(project.providers.gradleProperty('proofVersionCode').getOrElse('1'))
    versionName = project.providers.gradleProperty('proofVersionName').getOrElse('0.1.5-alpha.1')
  }
  testOptions { unitTests.includeAndroidResources = true }
  buildTypes { debug { signingConfig signingConfigs.proof } }
}
kotlin { compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17 } }
dependencies {
  implementation 'com.squareup.okhttp3:okhttp:4.12.0'
  implementation 'com.android.tools.build:apksig:8.13.2'
  testImplementation 'junit:junit:4.13.2'
  testImplementation 'org.robolectric:robolectric:4.14.1'
}
'@)
[IO.File]::WriteAllText((Join-Path $proof "gradle.properties"), "android.useAndroidX=true`nkotlin.incremental=false`norg.gradle.jvmargs=-Xmx2048m`n")
New-Item -ItemType Directory -Force (Join-Path $proof "src/main") | Out-Null
[IO.File]::WriteAllText((Join-Path $proof "src/main/AndroidManifest.xml"), @'
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:name="expo.modules.streamfusionnativecontracts.UpdaterProofApplication" android:label="Updater native proof">
    <activity android:name="expo.modules.streamfusionnativecontracts.UpdaterProofActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
    <activity android:name="expo.modules.streamfusionnativecontracts.UpdateConsentActivity" android:exported="false" android:theme="@android:style/Theme.Translucent.NoTitleBar" />
    <receiver android:name="expo.modules.streamfusionnativecontracts.UpdateInstallReceiver" android:exported="false" />
    <service android:name="expo.modules.streamfusionnativecontracts.UpdaterForegroundService" android:exported="false" android:foregroundServiceType="dataSync" />
  </application>
</manifest>
'@)
$keystore = Join-Path $proof "proof.keystore"
if (!(Test-Path -LiteralPath $keystore)) {
  & (Join-Path $JavaDirectory "bin/keytool.exe") -genkeypair -storetype PKCS12 -keystore $keystore -storepass streamfusion-proof -keypass streamfusion-proof -alias updater-proof -keyalg RSA -keysize 2048 -validity 3650 -dname "CN=StreamFusion updater proof"
  if ($LASTEXITCODE -ne 0) { throw "Could not create proof signing key." }
}
$env:JAVA_HOME = $JavaDirectory
$env:ANDROID_HOME = $AndroidSdk
$env:ANDROID_SDK_ROOT = $AndroidSdk
$env:Path = "$JavaDirectory/bin;$env:Path"
Push-Location $proof
try {
  foreach ($build in @(
    @{ Code = 2; Name = "0.1.6-alpha.1"; Output = "candidate.apk" },
    @{ Code = 1; Name = "0.1.5-alpha.1"; Output = "baseline-r.apk" }
  )) {
    $ErrorActionPreference = "Continue"
    & ./gradlew.bat assembleDebug "-PproofVersionCode=$($build.Code)" "-PproofVersionName=$($build.Name)" --console=plain
    $ErrorActionPreference = "Stop"
    if ($LASTEXITCODE -ne 0) { throw "Native updater proof build failed for version code $($build.Code)." }
    $built = @(Get-ChildItem -LiteralPath (Join-Path $proof "build/outputs/apk/debug") -Filter "*-debug.apk" -File)
    if ($built.Count -ne 1) { throw "Expected one debug APK for version code $($build.Code)." }
    Copy-Item -LiteralPath $built[0].FullName -Destination (Join-Path $proof $build.Output) -Force
  }
  if ((Get-FileHash -LiteralPath $engineSource -Algorithm SHA256).Hash -ne $engineHash -or
    (Get-FileHash -LiteralPath (Join-Path $source "UpdaterEngine.kt") -Algorithm SHA256).Hash -ne $engineHash) {
    throw "UpdaterEngine changed while building the proof. Rerun against one source revision."
  }
  Write-Output "UpdaterEngine SHA-256: $engineHash"
  Write-Output "Built $proof/candidate.apk and $proof/baseline-r.apk."
  Write-Output "Install and launch baseline-r.apk once, then run: adb push candidate.apk /data/local/tmp/candidate.apk"
  Write-Output "Run: adb shell run-as expo.modules.streamfusionnativecontracts.updateproof cp /data/local/tmp/candidate.apk files/candidate.apk"
  Write-Output "Launch Updater native proof, tap Update, grant install permission and approve Android installation. Reopen it to observe versionCode=2 and marker=retained across APK replacement."
  Write-Output "For background transfer, launch with --el chunkDelayMs 300, tap Update, press Home, and reopen after transfer completes. The ready state must wait for an explicit Install tap."
  $ErrorActionPreference = "Continue"
  & ./gradlew.bat testDebugUnitTest --console=plain
  $ErrorActionPreference = "Stop"
  if ($LASTEXITCODE -ne 0) { throw "Native updater unit tests failed. See $proof/build/reports/tests/testDebugUnitTest/index.html." }
} finally {
  Pop-Location
}
