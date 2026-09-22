# Android Metro boot (Hermes "property is not writable")

## Symptom

Expo LogBox / logcat on emulator load:

```text
[runtime not ready]: TypeError: property is not writable
setUpDefaultReactNativeEnvironment / setUpDefaltReactNativeEnvironment
```

## Cause

Duplicate `react` / `react-native` copies in the npm workspace (historically root
`react-native@0.86.2` next to `apps/mobile` `react-native@0.86.3`). Hermes then
initializes RN globals twice and assignment to an already-defined global throws.

Manual Metro overrides of `resolver.nodeModulesPaths` / `watchFolders` (pre-SDK
52 style) make this class of failure more likely in Expo monorepos.

## Fix in-repo

- Root `package.json` overrides pin `react@19.2.8`, `react-native@0.86.3`, and
  `expo@57.0.17` so the workspace installs one copy of each.
- `apps/mobile/metro.config.js` keeps Expo's monorepo `nodeModulesPaths`, only
  trims unrelated workspace apps from `watchFolders`, and redirects
  `react` / `react-native` resolution through the mobile workspace origin.
- `apps/mobile/babel.config.js` uses `babel-preset-expo`.
- `app.json` enables `experiments.autolinkingModuleResolution`.

## After pulling

From the monorepo root (on Windows use the short `F:\sf` junction, never `C:`
and never the long `F:\My Github Repos\...` path for native rebuilds):

```bat
npm ci
cd apps\mobile
npm start
```

Open `exp://LAN:8081` in Expo Go. For a custom development APK instead:

```bat
npm run start:dev-client -- --clear --port 8081
```
