# Start the Android app with Metro

StreamFusion Mobile uses the React Native CLI and the committed Gradle project in `apps/mobile/android`. Metro listens on port `8083`.

## Install or rebuild the development app

Start an Android emulator or connect a device. From the repository root, run:

```text
npm ci
npm run mobile:native
```

`mobile:native` checks Java, builds `app:assembleDebug`, installs the APK with `adb install -r`, starts Metro, reverses port `8083`, and opens the app. The `-r` install preserves the existing application data.

Run this command after any Android, Kotlin, native dependency, Gradle, manifest, or native configuration change. On Windows, the launcher creates and removes a temporary mapped drive for the native build. You do not need to create a short-path junction.

When more than one device is connected, select one with:

```text
npm run mobile:native -- --device emulator-5554
```

You can also set `STREAMFUSION_ANDROID_DEVICE` to the device serial.

## Start an installed development app

For JavaScript or TypeScript changes, run:

```text
npm run mobile
```

This command starts Metro, waits for an Android device, checks that the installed app has the version and `versionCode` from `native-config.json`, reverses port `8083`, and opens the app. If no device is ready, the launcher starts the first configured Android virtual device.

The version check cannot detect a native code change. Rebuild with `npm run mobile:native` whenever native code changes.

Gradle applies the patches in `apps/mobile/patches` before loading native dependencies, including after `npm ci --ignore-scripts`. The `react-native-svg` patch requests static bitmaps for SVG raster textures because its Android canvas renderer cannot consume Fresco animated images. Chat emotes use a separate animated renderer. Recheck this patch when upgrading `react-native-svg`.

To reset Metro's cache, pass the React Native CLI flag through the JavaScript-only launcher:

```text
npm run mobile -- --reset-cache
```

To build and install while an existing Metro process already serves port `8083`, run:

```text
npm run mobile:native -- --no-packager
```

## Diagnose a Hermes global setup error

An app can fail during startup with this error:

```text
[runtime not ready]: TypeError: property is not writable
setUpDefaultReactNativeEnvironment
```

This error occurs when Metro loads more than one copy of React or React Native and initializes the same Hermes globals twice.

The repository prevents that conflict in three places:

- The root package overrides pin `react@19.2.8` and `react-native@0.86.3`.
- `apps/mobile/metro.config.js` resolves the React family from the mobile workspace and searches the mobile and root `node_modules` directories.
- `apps/mobile/babel.config.js` uses `@react-native/babel-preset` and the required React Native Worklets plugin.

After pulling dependency or Metro changes, run `npm ci` and restart with `npm run mobile -- --reset-cache`. If the installed native app no longer matches `native-config.json`, rebuild it with `npm run mobile:native`.
