# StreamFusion Mobile runtime

The Android client uses React Native with a committed Android project. Portable product rules and contracts remain in public @streamfusion/core subpaths. Expo is not a runtime, build, or package dependency.

## Runtime flow

index.js registers the main component with AppRegistry. The MobileRuntime composition root constructs dependencies and injects them into feature controllers and screens. AppShell owns navigation, independent destination histories, back behavior, restoration, and parsed app links.

## Source ownership

| Path | Responsibility |
| --- | --- |
| index.js | React Native entry point |
| android/ | Android application, manifest, resources, Gradle configuration, and host lifecycle |
| src/features/ | Feature routes, presentation, workflows, capabilities, adapters, and persistence |
| src/design/ | Mobile tokens and reusable presentation elements |
| src/composition/ | Dependency construction and injection |
| modules/streamfusion-native-contracts/ | React Native bridges and existing Kotlin engines |
| tests/ | Mobile infrastructure tests and fixtures |

The historical Kotlin namespace remains stable because Android component identities participate in persisted service, installer, and export operations. It does not import the former module SDK.

## Import policy

ESLint enforces feature responsibility boundaries and rejects reverse imports. Domain code and capabilities remain independent of React and native APIs. Concrete adapters consume the typed bridge. Only composition roots wire implementations. Production code cannot import test support, Node, Electron, another app's source, or Core internals. The architecture verifier exercises allowed and forbidden alias, relative, dynamic, and CommonJS imports. The no-Expo tests inspect the installed dependency graph and lockfile.

## State ownership

TanStack Query owns remote request state. The Product Store owns durable records. The Cache Store owns disposable provider results. React and feature controllers own presentation state. Android services own recoverable background media work.

## Encrypted persistence

StreamFusionStorage uses Zetetic SQLCipher behind the existing EncryptedDatabaseDriver. Product, Cache, and recovery backups have independent keys. Database files remain in filesDir/SQLite with their existing names. Recovery artifacts remain in filesDir/recovery. WAL, integrity checks, transactional migrations, backup schema versions, and restore rekeying remain intact. Corrupt or missing-key Product data stays available for recovery rather than being silently deleted.

StreamFusionSecureStore retains the existing Android Keystore aliases and encrypted SharedPreferences format. It preserves saved accounts, pending login attempts, database keys, and proxy credentials without a secret migration. Existing plaintext SQLite stores with secretbox payloads continue using that format in place. New stores use SQLCipher. The Cache Store remains disposable, expires after seven days by default, and evicts expired entries before the least recently used entries to a 256 MiB target. Android backup and device transfer exclude all app-owned data.

## Native capabilities

React Native modules preserve playback contract version 5, captions version 4, diagnostics and Media Jobs version 3, and connectivity and maintenance version 1. Maintenance remains a contained stub. Existing engines own Media3 sessions, decoded program audio, Vosk recognition, thermal and memory facts, download journals, app update verification, and installer handoffs. Typed adapters validate their responses and events before feature code consumes them.

Media3 is the Android playback implementation for Watch and MultiStream. It retains Twitch playlist interception, muted starts, quality selection, playback speed, seek, volume, and system Picture-in-Picture. MainActivity forwards user-leave events for automatic PiP. React Native lifecycle listeners forward foreground and background state. Android owns system PiP movement and resizing. The floating in-app player retains dragging, resizing, and position within the current stream session.

StreamFusionEmoteImage uses Fresco for cached GIF and WebP images. Its animated prop controls animation playback. StreamFusionPlatform owns Custom Tabs, clipboard, connectivity facts, orientation, system bars, haptics, app metadata, and SHA-256. Storage owns secure random bytes and UUIDs.

StreamFusionNotifications owns local channels, posting permission, presentation, and cold and warm tap receipts. Android WorkManager checks public Twitch and Kick stream state for an encrypted snapshot of eligible saved follows about every 15 minutes. Foreground reads and background checks share one encrypted native observation journal. The worker does not start React or use account tokens. Provider failures preserve the last verified state. The first successful observation establishes a silent baseline.

The native journal retains pending Activity events until JavaScript persists and acknowledges them. Notification settings control eligibility, restart grace, sound, and interruption policy. Disabled system alerts, Do Not Disturb, and denied Android permission do not discard eligible Activity history. Android may delay periodic work, and force-stop suspends it until the app opens again. Firebase and a notification relay are not used.

Product settings retain the last confirmed account follow list for each platform and account identity. Unavailable reads keep that list, and partial reads merge verified follows into it. Confirmed empty lists, sign-out, and account switches clear the old membership. Foreground observations carry their original read times and only explicit provider live or offline evidence.

## Android workflows

The normal mobile command opens the installed development app with Metro on port 8083. The native command builds the committed Gradle project and installs it without prebuild. Use STREAMFUSION_ANDROID_DEVICE or the native launcher's device argument when multiple devices are connected. Native changes require a rebuilt APK. Restart the app after code changes and leave the latest development app running after verification.

For checkout paths containing commas, the native-contracts module puts its build output in Gradle's user-home cache, keyed by the checkout path. This keeps Kotlin's test-access path list intact. App APK paths stay under `android/app/build/outputs/apk/`.

native-config.json records the development identity. Production builds require the exact production release channel, an explicit release version and version code, and the pinned signing certificate. The development application remains com.thedarkskyxd.streamfusion.dev with scheme streamfusion-development. The production application remains com.thedarkskyxd.streamfusion with scheme streamfusion. Release builds use the existing upload-signing variables and APK verification gates.

Public Metro configuration uses STREAMFUSION_PUBLIC_RELAY_URL, STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS, STREAMFUSION_PUBLIC_TWITCH_CLIENT_ID, STREAMFUSION_PUBLIC_KICK_CLIENT_ID, and STREAMFUSION_PUBLIC_WORKER_URL. The release workflow supplies these values from matching repository variables. The Babel plugin inlines only those explicit public variables. It never reads dotenv files or arbitrary environment values.

## Provider workflows

Authenticated chat, recorded replay, moderation, engagement, and MultiStream keep their feature roots and provider-neutral capabilities. Tokens still refresh and pass scope checks before provider operations. Development fixtures cannot authorize provider writes. Unsupported provider operations retain their explicit handoffs.

Twitch uses the existing public Device Code flow. Missing, empty, or whitespace-only client ID overrides use the bundled public Twitch client ID. Kick retains PKCE, encrypted durable attempts, the canonical HTTPS Worker callback, and the app-scheme return. Warm and cold callback delivery uses React Native Linking. Background returns wait for account restoration and duplicate returns cannot start parallel exchanges. Both providers retain guest browsing when unavailable.

Authorization pages open in browser-owned Android Custom Tabs launched from the StreamFusion task. Both providers request a resizable sheet at three quarters of the screen height with background interaction disabled. Browsers without partial Custom Tabs support show a full-screen in-app tab. Missing Custom Tabs support fails explicitly without an external-browser fallback. Twitch polling resumes when the app returns to the foreground. Kick retains the Worker page's Open StreamFusion link. Closing a browser tab does not cancel a durable authorization attempt.

The Mobile domain language is recorded in docs/research/streamfusion-mobile/CONTEXT.md. UPDATES.md describes the in-app update contract.
