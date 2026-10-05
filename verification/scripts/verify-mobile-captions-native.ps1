param(
  [string]$ProofRoot = (Join-Path $env:TEMP "streamfusion-caption-native-proof-$PID"),
  [string]$AndroidSdk = "C:/Users/Admin/AppData/Local/Android/Sdk",
  [string]$JavaDirectory = "C:/Program Files/Android/Android Studio/jbr"
)
$ErrorActionPreference = "Stop"
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$module = Join-Path $repository "apps/mobile/modules/streamfusion-native-contracts/android"
$wrapper = Join-Path $repository "apps/mobile/android"
if (!(Test-Path -LiteralPath (Join-Path $wrapper "gradlew.bat"))) {
  throw "Run npx expo prebuild --platform android --no-install in apps/mobile first."
}
$proof = [IO.Path]::GetFullPath($ProofRoot)
New-Item -ItemType Directory -Force $proof | Out-Null
Copy-Item -LiteralPath (Join-Path $wrapper "gradlew.bat") -Destination $proof
Copy-Item -LiteralPath (Join-Path $wrapper "gradle") -Destination $proof -Recurse -Force
$source = Join-Path $proof "src/main/java/expo/modules/streamfusionnativecontracts"
$test = Join-Path $proof "src/androidTest/java/expo/modules/streamfusionnativecontracts"
$assets = Join-Path $proof "src/androidTest/assets"
New-Item -ItemType Directory -Force $source, $test, $assets | Out-Null
foreach ($name in @("CaptionCatalog", "CaptionModelStore", "CaptionRecognizer", "CaptionLocalRecognizer", "CaptionPcmConverter")) {
  Copy-Item -LiteralPath (Join-Path $module "src/main/java/expo/modules/streamfusionnativecontracts/$name.kt") -Destination $source
}
Copy-Item -LiteralPath (Join-Path $module "src/androidTest/java/expo/modules/streamfusionnativecontracts/CaptionRecognitionTest.kt") -Destination $test
Copy-Item -LiteralPath (Join-Path $module "src/androidTest/assets/vosk-test.wav") -Destination $assets
[IO.File]::WriteAllText((Join-Path $proof "settings.gradle"), @'
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = 'StreamFusionCaptionNativeProof'
'@)
[IO.File]::WriteAllText((Join-Path $proof "build.gradle"), @'
plugins {
  id 'com.android.application' version '8.13.1'
  id 'org.jetbrains.kotlin.android' version '2.2.21'
}
android {
  namespace 'expo.modules.streamfusionnativecontracts.captionproof'
  compileSdk 36
  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
  defaultConfig {
    applicationId 'expo.modules.streamfusionnativecontracts.captionproof'
    minSdk 30
    targetSdk 36
    versionCode 1
    versionName '1.0'
    testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner'
  }
}
kotlin { compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17 } }
dependencies {
  implementation 'com.alphacephei:vosk-android:0.3.75'
  implementation 'com.squareup.okhttp3:okhttp:4.12.0'
  androidTestImplementation 'androidx.test:runner:1.6.2'
  androidTestImplementation 'androidx.test.ext:junit:1.2.1'
}
'@)
[IO.File]::WriteAllText((Join-Path $proof "gradle.properties"), "android.useAndroidX=true`nkotlin.incremental=false`norg.gradle.jvmargs=-Xmx2048m`n")
[IO.File]::WriteAllText((Join-Path $proof "src/main/AndroidManifest.xml"), @'
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:label="StreamFusion caption native proof" />
</manifest>
'@)
$env:JAVA_HOME = $JavaDirectory
$env:ANDROID_HOME = $AndroidSdk
$env:Path = "$JavaDirectory/bin;$env:Path"
Push-Location $proof
try {
  $ErrorActionPreference = "Continue"
  & ./gradlew.bat connectedDebugAndroidTest --console=plain
  $ErrorActionPreference = "Stop"
  if ($LASTEXITCODE -ne 0) { throw "Native caption proof failed with exit $LASTEXITCODE." }
  Write-Output "Native caption recognition proof passed. Results in $proof/build/reports/androidTests/connected/debug."
} finally {
  Pop-Location
}
