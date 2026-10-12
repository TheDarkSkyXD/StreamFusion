# Mobile deep links

The committed Android project registers one custom scheme for each application identity:

| Build | Scheme | Application ID |
| --- | --- | --- |
| Development | `streamfusion-development` | `com.thedarkskyxd.streamfusion.dev` |
| Production | `streamfusion` | `com.thedarkskyxd.streamfusion` |

React Native `Linking` supplies the initial URL after a cold start and emits URL events while the app is running. `parseAppLink` accepts only the routes and fields listed below.

## Watch links

A live channel link has this form:

```text
streamfusion-development://watch/{twitch|kick}/{channelLogin}?channelId={id}
```

A clip or video link must include all four media fields:

```text
streamfusion-development://watch/{twitch|kick}/{channelLogin}?channelId={id}&mediaKind={clip|video}&mediaId={id}&title={title}&duration={seconds}
```

`channelLogin` accepts 1 to 64 letters, numbers, underscores, or hyphens. `channelId` and `mediaId` accept 1 to 256 letters, numbers, periods, underscores, colons, or hyphens. A media title accepts 1 to 256 characters without control characters. `duration` must be a non-negative integer.

The parser rejects unknown query parameters and partial media details.

## Search links

Open Search without a query:

```text
streamfusion-development://search
```

Open Search and run one query:

```text
streamfusion-development://search?q=xqc
```

The query can contain up to 100 characters and cannot contain control characters. The path form below resolves to the same destination:

```text
streamfusion-development:///search?q=xqc
```

## Activity links

Open one Activity item with:

```text
streamfusion-development://activity/{eventId}
```

The event ID must contain 1 to 256 letters, numbers, periods, underscores, colons, or hyphens after URL decoding. Activity links do not accept query parameters.

## Test a link on Android

Install and open the development app before sending a link. Then run:

```text
adb shell am start -W -a android.intent.action.VIEW -d "streamfusion-development://watch/twitch/proofstreamer?channelId=channel-1" -p com.thedarkskyxd.streamfusion.dev
```

Use the production scheme and application ID only with a production APK.

## Authentication and notification destinations

Kick sign-in uses the HTTPS callback declared in the Android manifest at `https://streamfusion.leveluptogetherbiz.workers.dev/auth/kick/android/callback`. The callback adapter also recognizes the two custom-scheme callback forms for development and compatibility.

Notification taps map their validated payload directly to a Watch or Activity destination. They do not create another URL scheme.
