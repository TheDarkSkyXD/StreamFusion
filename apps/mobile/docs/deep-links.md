# Mobile deep links (Expo Go)

Scheme from `app.json`: **`streamfusion-development`** (release builds may use `streamfusion`).

Deep links are parsed by `parseAppLink` and applied through the shell lifecycle. They do not invent a second router tree; Expo Router still mounts the single app shell.

## Watch

Live channel:

```text
streamfusion-development://watch/{twitch|kick}/{channelLogin}?channelId={id}
```

VOD or clip:

```text
streamfusion-development://watch/{twitch|kick}/{channelLogin}?channelId={id}&mediaKind=clip|video&mediaId={id}&title={title}&duration={seconds}
```

Example (Expo Go / Android):

```bash
npx uri-scheme open "streamfusion-development://watch/twitch/proofstreamer?channelId=channel-1" --android
```

## Search

Open Search:

```text
streamfusion-development://search
```

Open Search with a query (runs the search once the Search screen mounts):

```text
streamfusion-development://search?q=xqc
```

Path-style URLs (Expo Router / some Expo Go forms) are normalized to the same intents:

```text
streamfusion-development:///search?q=xqc
exp://127.0.0.1:8081/--/search?q=xqc
```

## Activity

```text
streamfusion-development://activity/{eventId}
```

Live-alert / notification opens reuse the same Watch and Activity location mapping inside the shell (not a separate URL scheme).

## Tablet navigation

At window width **≥ 600**, the shell shows a persistent **side rail** (`getShellNavigationPlacement`). Compact phones keep the bottom tab bar. Primary navigation stays hidden during picture-in-picture and while the soft keyboard is open on the bottom bar (see Android navigation model).
