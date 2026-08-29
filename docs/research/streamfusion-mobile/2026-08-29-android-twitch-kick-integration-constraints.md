# Twitch and Kick integration constraints on Android

Research date: 2026-08-29

Ticket: [#98](https://github.com/TheDarkSkyXD/StreamFusion/issues/98)

## Answer

StreamFusion Mobile can keep most signed-in reads, chat sends, and moderation calls on the Android device. It cannot reach full Desktop parity through documented provider APIs alone.

Three gaps shape the architecture:

1. Twitch and Kick do not expose viewer follow or unfollow writes in their current public APIs. Kick also has no official followed-channels read.
2. Neither provider exposes the native HLS playback URL StreamFusion needs through its public data API. Twitch documents a web embed, not a native media URL. Kick documents neither a playback endpoint nor an Android embed.
3. Reliable Live Notifications cannot depend on a WebSocket or polling loop inside a backgrounded Android app. Twitch supports webhooks or a foreground WebSocket. Kick events are webhook-only. A hosted relay must receive provider events and send Android push notifications.

The viable boundary is therefore:

```text
Android Expo app
  -> direct provider APIs with the user's access token
  -> direct foreground chat transport where officially supported
  -> narrow trusted services for secrets, app-token reads, webhooks, and push

Trusted services
  -> existing Kick OAuth Worker, still token-only
  -> separate integration relay for app-token reads and provider webhooks
  -> Expo Push Service or FCM for Android delivery
```

The Android app is an untrusted public client. It may contain provider client IDs, but it must not contain a provider client secret, webhook secret, FCM service-account credential, or reusable app access token. Expo states that client bundle values are readable by end users, including values supplied through `EXPO_PUBLIC_*` variables. [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)

## Existing Desktop evidence

The current Desktop implementation already separates documented APIs from web-only fallbacks, but several Electron techniques have no direct Expo equivalent.

| Area | Current implementation | Android consequence |
| --- | --- | --- |
| Twitch public reads | The adapter uses Twitch web GraphQL for signed-out browse, search, channel, video, and clip data. [Twitch adapter rules](../../../apps/desktop/src/backend/api/platforms/twitch/AGENTS.md#L21) | This is not an official public API contract. Official signed-out Helix reads need an app token, which must remain on a trusted service. |
| Twitch playback | The resolver obtains a web GraphQL playback token and builds an `usher.ttvnw.net` HLS URL. [Twitch adapter rules](../../../apps/desktop/src/backend/api/platforms/twitch/AGENTS.md#L85) | Native Expo playback can consume HLS, but the URL acquisition path remains an unsupported web integration. |
| Twitch follow writes | Desktop calls persisted Twitch web GraphQL mutations with a separate Device Code credential. [follow-endpoints.ts](../../../apps/desktop/src/backend/api/platforms/twitch/endpoints/follow-endpoints.ts#L3) | The public Twitch API removed follow and unfollow writes. Porting these mutations would preserve the same brittle web dependency. |
| Twitch chat | Desktop uses `tmi.js` over IRC and sends through IRC. [twitch-chat.ts](../../../apps/desktop/src/backend/services/chat/twitch-chat.ts#L1) | Twitch now recommends EventSub for receive and Helix for send. The mobile implementation should use the current documented path. |
| Kick OAuth | The app sends the code, redirect URI, and PKCE verifier to the Worker. The Worker adds the Kick client secret for exchange and refresh. [token-exchange.ts](../../../apps/desktop/src/backend/auth/token-exchange.ts#L105), [Worker](../../../apps/worker/src/index.ts#L220) | This boundary is reusable after the Worker's redirect allowlist accepts one exact Android callback. Android owns browser presentation, state, and PKCE. The Worker keeps the secret. |
| Kick redirect validation | The Worker currently accepts only `http://localhost` callbacks on ports 8765 through 8864. [Worker](../../../apps/worker/src/index.ts#L143) | The current deployed contract rejects an Android App Link or custom scheme. Mobile auth needs a narrow additional allowlist entry, not an arbitrary client-supplied redirect. |
| Kick public data | Signed-in official calls use the user's bearer. Signed-out reads and feature gaps use `kick.com/api/*` routes. [Kick adapter rules](../../../apps/desktop/src/backend/api/platforms/kick/AGENTS.md#L15) | Direct official reads work after login. Signed-out parity needs a narrow app-token proxy or the same undocumented routes. |
| Kick follows | Desktop uses internal `kick.com/api/v2` reads and writes, browser cookies, XSRF state, Kasada runtime state, and a hidden `BrowserWindow`. [follow-endpoints.ts](../../../apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts#L1) | There is no equivalent reliable native API. A WebView recreation would still be undocumented and would conflict with native OAuth guidance. |
| Kick chat | Desktop receives from a hard-coded Pusher application and sends through a hidden Kick page. [kick-chat.ts](../../../apps/desktop/src/backend/services/chat/kick-chat.ts#L1), [kick-send-window.ts](../../../apps/desktop/src/backend/api/platforms/kick/kick-send-window.ts#L1) | Official send can replace the hidden page. Official receive is webhook-only, so direct Pusher remains an unsupported foreground option unless a relay is added. |
| Live Notifications | Twitch uses EventSub with polling fallback. Kick polls. [ADR 0006](../../adr/0006-main-process-live-notifications.md) | Android background limits remove the app-lifetime service assumption. Both Platforms need push for reliable delivery while the app is backgrounded or terminated. |

## Authentication and token lifecycle

### Twitch

Twitch presents an awkward choice for a mobile public client.

- Twitch documents the implicit grant for mobile apps, but implicit tokens do not provide the durable refresh behavior StreamFusion needs. [Twitch OAuth flows](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)
- Twitch documents Authorization Code Grant for apps with a server that can protect a client secret. [Twitch OAuth flows](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)
- Twitch Device Code Grant supports public clients, needs no client secret, returns access and refresh tokens, and makes its refresh tokens one-time use. Twitch describes it for devices with limited input or no suitable browser, including Electron applications. [Twitch Device Code Grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow)
- Twitch requires third-party apps that maintain OAuth sessions to validate access tokens through `/validate`. [Twitch authentication](https://dev.twitch.tv/docs/authentication/)

Recommendation: keep Device Code Grant for Android 1.0 unless product work rejects its activation-code experience. It is the only Twitch-documented public-client flow that matches the existing renewable session without adding a Twitch secret to the app. If a normal browser callback is mandatory, add a backend-assisted Authorization Code flow and keep the Twitch secret there.

The refresh coordinator must be single-flight and must replace the stored Twitch refresh token atomically after every successful refresh. Twitch says Device Code refresh tokens are one-time use. OAuth security guidance also requires rotating or sender-constrained refresh tokens for public clients. [Twitch Device Code Grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow), [RFC 9700 section 2.2.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.2.2)

### Kick

Kick requires Authorization Code Grant with S256 PKCE and `state`. Its token and refresh requests also require the app's client secret. [Kick OAuth documentation](https://github.com/KickEngineering/KickDevDocs/blob/main/getting-started/generating-tokens-oauth2-flow.md)

Android should open Kick authorization in the system browser through `expo-auth-session`, not an embedded Kick login WebView. Native OAuth guidance requires an external user agent and PKCE for public native clients. [Expo AuthSession](https://docs.expo.dev/versions/latest/sdk/auth-session/), [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)

Use a verified HTTPS Android App Link for the redirect if Kick accepts it in app registration. This binds the callback domain to the signed APK and prevents another installed app from claiming the callback. Expo requires `autoVerify`, an intent filter, and a hosted `/.well-known/assetlinks.json`. [Expo Android App Links](https://docs.expo.dev/linking/android-app-links/), [Android App Links](https://developer.android.com/training/app-links/about)

The Android app should keep the PKCE verifier and expected state in memory for the active attempt. After the callback, it sends the code, exact redirect URI, and verifier to the existing Worker. The Worker adds `KICK_CLIENT_SECRET`, exchanges the code, and later rotates refresh tokens. The Worker must first add the exact production Android callback to `isAllowedKickRedirect`; its current localhost-only check rejects every mobile redirect. This changes the redirect allowlist without expanding the Worker's token-only responsibility.

### Storage

Store each Platform's access token, refresh token, expiry, scopes, user ID, and token generation in `expo-secure-store`. On Android, SecureStore encrypts values stored in `SharedPreferences` with the Android Keystore. Its entries are excluded from Auto Backup because a restored value cannot be decrypted after uninstall removes the Keystore key. [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)

SecureStore reduces extraction risk, but it does not make an installed client trusted. Android notes that a compromised app process may still use a key even when it cannot extract the key material. [Android Keystore](https://developer.android.com/privacy-and-security/keystore)

## Operation matrix

Legend:

- Direct means the Android app can call a documented provider API with the signed-in user's token.
- Relay means a trusted hosted service is required.
- Unsupported means the current product outcome has no documented provider operation.
- Internal means Desktop has a working web integration, but the provider does not promise that contract.

| Operation | Twitch Android | Kick Android | Boundary and evidence |
| --- | --- | --- | --- |
| Public browse, search, channels, categories, streams | Direct after login with the user token. Signed-out official access needs an app-token proxy. | Direct after login. Current `/public/v1/channels`, `/public/v2/categories`, and `/public/v2/livestreams` accept user or app tokens. Signed-out official access needs an app-token proxy. | Twitch Helix requires a valid app or user access token for ordinary public resources. [Twitch API guide](https://dev.twitch.tv/docs/api/guide), [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml) |
| Current user's followed channels and live follows | Direct with `user:read:follows`. | Unsupported by the official API. Internal `kick.com/api/v2` reads are the only current Desktop path. | [Twitch scopes](https://dev.twitch.tv/docs/authentication/scopes/), [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml) |
| Follow and unfollow writes | Unsupported by the official API. Twitch removed Create and Delete Follows in 2021. | Unsupported by the official API. | [Twitch changelog](https://dev.twitch.tv/docs/change-log/#2021-07-27), [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml) |
| User, channel, video, and clip reads | Helix covers users, channels, videos, and clips with app or user tokens. | Users and channels are official. Videos and clips are absent from the current public API. | [Twitch API reference](https://dev.twitch.tv/docs/api/reference/), [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml) |
| Live playback URL | Unsupported as a public API operation. Twitch documents its approved web player embed. Desktop's GQL token and Usher HLS resolver is internal. | Unsupported as a public API operation. The livestream models contain metadata, not a viewer HLS URL. Desktop obtains `playback_url` from internal channel data. | [Twitch embed requirements](https://dev.twitch.tv/docs/embed/), [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml) |
| Native HLS rendering after URL resolution | Direct. `expo-video` supports HLS on Android, background playback through a foreground service, and Picture-in-Picture. | Direct under the same condition. | [Expo Video](https://docs.expo.dev/versions/latest/sdk/video/) |
| Chat receive while foregrounded | Direct through EventSub WebSocket with `user:read:chat`. Twitch recommends this for chat clients installed on an end user's system. | Official receive is webhook-only, so use a relay. Direct Pusher is Internal and foreground-only. | [Twitch chat authentication](https://dev.twitch.tv/docs/chat/authenticating/), [Kick Events](https://github.com/KickEngineering/KickDevDocs/blob/main/events/introduction.md) |
| Chat send | Direct through `POST /helix/chat/messages` with `user:write:chat`. | Direct through `POST /public/v1/chat` with `chat:write`. | [Twitch Send Chat Message](https://dev.twitch.tv/docs/api/reference/#send-chat-message), [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml) |
| Chat history and VOD chat replay | Unsupported by Helix. Desktop uses community or web sources. | Unsupported by the public API. Desktop uses internal recent-message routes. | [Twitch adapter rules](../../../apps/desktop/src/backend/api/platforms/twitch/AGENTS.md#L90), [Kick adapter rules](../../../apps/desktop/src/backend/api/platforms/kick/AGENTS.md#L102) |
| Timeout, ban, unban, delete message | Direct with the endpoint-specific moderator scopes and a user who has authority in the channel. | Direct with `moderation:ban` and `moderation:chat_message:manage`. | [Twitch API reference](https://dev.twitch.tv/docs/api/reference/), [Kick scopes](https://github.com/KickEngineering/KickDevDocs/blob/main/scopes/scopes.md) |
| Polls and predictions | Direct through documented Helix endpoints and scopes. | Predictions remain Internal. The current public API does not list them. | [Twitch API reference](https://dev.twitch.tv/docs/api/reference/), [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml) |
| Pinned chat messages | Twitch now has documented pin endpoints and optional pin-on-send. Direct with moderator authority and scope. | Internal. The public API has no pin operations. | [Twitch API reference](https://dev.twitch.tv/docs/api/reference/#pin-chat-message), [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml) |
| Foreground stream online and offline observation | Direct through Twitch EventSub WebSocket. | Direct polling is possible with a user token. Official real-time events go to a webhook. | [Twitch WebSocket events](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/), [Kick event types](https://github.com/KickEngineering/KickDevDocs/blob/main/events/event-types.md) |
| Background or terminated Live Notifications | Relay. Use Twitch EventSub webhooks, then Android push. | Relay. Kick's `livestream.status.updated` is delivered by webhook, then Android push. | [Twitch EventSub](https://dev.twitch.tv/docs/eventsub/), [Kick Events](https://github.com/KickEngineering/KickDevDocs/blob/main/events/introduction.md), [Expo push](https://docs.expo.dev/push-notifications/sending-notifications/) |

## Chat architecture

### Twitch foreground chat

Use one EventSub WebSocket while the app is foregrounded. Subscribe to the channel chat events needed by the open StreamSlots and send messages through Helix. Twitch says WebSocket EventSub uses a user access token, allows at most three connections per user and client pair, and allows 300 enabled subscriptions per connection. A dropped socket loses its subscriptions and has no event replay, so the client must recreate them. [Twitch WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)

This replaces mobile use of `tmi.js`. Twitch recommends EventSub for chat receive and the API for sends. [Twitch IRC migration](https://dev.twitch.tv/docs/chat/irc-migration/)

Signed-out Twitch chat is a product choice. The documented EventSub chat path requires a user token. Keeping anonymous IRC would retain a legacy path solely for signed-out viewing.

### Kick foreground chat

Kick's documented `chat.message.sent` event is a webhook. The app registration owns one publicly accessible webhook URL, and Kick signs each delivery. [Kick event introduction](https://github.com/KickEngineering/KickDevDocs/blob/main/events/introduction.md), [Kick webhook security](https://github.com/KickEngineering/KickDevDocs/blob/main/events/webhook-security.md)

There are two viable implementations:

1. Use a hosted Kick chat relay. It verifies Kick signatures, deduplicates `Kick-Event-Message-Id`, and forwards messages to connected Android clients. This stays within the documented API, but adds sustained chat traffic and subscription lifecycle state to the backend.
2. Port the current public Pusher subscription to Android for foreground receive. This avoids chat traffic on StreamFusion infrastructure, but it depends on a hard-coded, undocumented Kick web application and may break without notice.

Official chat send should call Kick directly from Android with the user's `chat:write` token. The Desktop hidden `BrowserWindow` send path is no longer needed on mobile.

## Playback architecture

`expo-video` can render Android HLS and supports Picture-in-Picture and a foreground service for background playback. [Expo Video](https://docs.expo.dev/versions/latest/sdk/video/)

URL acquisition is the blocker.

- Twitch's public API lists stream metadata but no playback-token or manifest operation. Twitch's documented playback product is a web embed with required domain verification and player rules. [Twitch embed requirements](https://dev.twitch.tv/docs/embed/), [Twitch video embed](https://dev.twitch.tv/docs/embed/video-and-clips/)
- Kick's public livestream and channel models do not expose a viewer HLS manifest. The `Stream.url` field in the current OpenAPI model is an RTMPS broadcaster ingest URL, not a viewer playback URL. [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml)

An official-only mobile release can use Twitch's approved web embed in a WebView, subject to Twitch's domain, visibility, and minimum-size rules. There is no equivalent documented Kick embed. A native player for both Platforms therefore needs provider approval or continued use of the internal resolvers. The latter should be named an accepted compatibility risk, not treated as an official API.

## Live Notifications and push

Do not keep provider WebSockets or frequent polling alive as an Android background service. Android restricts background execution and foreground-service starts. WorkManager is for deferrable work, not exact stream-start delivery. [Android background restrictions](https://developer.android.com/develop/background-work/background-tasks/bg-work-restrictions), [foreground-service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)

Use this flow:

```text
Twitch EventSub webhook ----\
                             -> integration relay -> Expo Push Service or FCM -> Android
Kick signed webhook --------/
```

The relay must store the minimum operational state required to deliver notifications:

- random installation ID
- Expo push token or native FCM token
- Platform plus Channel IDs selected for Live Notifications
- provider subscription IDs and expiry or status
- notification preferences needed at delivery time
- deduplication IDs and a short delivery ledger

This is not cross-device settings sync, but it is remote per-install state. The existing decision that Guest Follows remain device-local needs this explicit exception if Guest Follows must produce reliable Live Notifications.

Kick requires a public webhook URL. Its event signature covers the message ID, timestamp, and raw body, and the relay must validate it before acting. Kick automatically removes subscriptions after a webhook fails continuously for more than a day. [Kick webhook security](https://github.com/KickEngineering/KickDevDocs/blob/main/events/webhook-security.md)

Twitch webhook subscriptions use an app access token and a server-held HMAC secret. The callback must use HTTPS on port 443. [Twitch subscription management](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/), [Twitch webhook verification](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/)

Expo supports delivery through its push service or direct FCM. Sending happens from a server. For an Android-only GitHub APK, FCM still requires Firebase project credentials and a device with Google Play services. Expo also notes that force-stopping an Android app prevents notifications until the user opens it again. [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Expo notification behavior](https://docs.expo.dev/push-notifications/what-you-need-to-know/)

## Trusted-service inventory

| Secret or operation | Where it belongs | Reason |
| --- | --- | --- |
| Kick client secret and Kick code exchange or refresh | Existing Kick OAuth Worker | Kick requires the secret for both token exchange and refresh. |
| Twitch client secret, if browser Authorization Code is chosen | Auth service | A native app cannot keep it secret. Device Code Grant avoids this service. |
| Twitch and Kick app-token creation | Integration relay | Both client-credentials grants require a secret. Do not vend reusable app tokens to the APK. |
| Signed-out official Platform reads | Narrow read proxy on the integration relay | A proxy can use the app token without exposing it. Signed-in user-token reads remain direct. |
| Twitch EventSub webhook HMAC secret | Integration relay | Twitch signs webhook deliveries with this shared secret. |
| Kick webhook processing | Integration relay | Kick requires a public callback. The relay verifies Kick's public-key signature and deduplicates messages. |
| Expo Push or FCM server credential | Integration relay | Push sending is a trusted server operation. |
| User access and refresh tokens | Android SecureStore | User credentials may live on the user's device. They should not be copied to the integration relay unless a future server-side user action needs them. |

Keep the existing Kick OAuth Worker token-only. Put app-token reads, event subscriptions, webhook receipt, and push in a separate service so OAuth rate limits and token handling do not turn into a general Platform proxy.

## Unsupported or high-risk parity items

These Desktop outcomes need an explicit product decision before Android implementation:

| Outcome | Constraint |
| --- | --- |
| Twitch account follow and unfollow | No public write API. Desktop's persisted web GraphQL mutations are unsupported. |
| Kick account follow list, follow, and unfollow | No public API. Desktop relies on Kick website session cookies, XSRF, bot-detection runtime state, scraping, and internal endpoints. |
| Native Twitch playback | The HLS token and Usher resolver are internal. The documented alternative is a restricted web embed. |
| Native Kick playback | No documented playback URL or embed exists. The current `playback_url` route is internal. |
| Kick videos, clips, chat history, predictions, and pins | Missing from the current public API. |
| Twitch VOD chat replay | Missing from Helix. |
| Signed-out official browse on either Platform | Requires a trusted app-token read proxy. Direct anonymous Desktop fallbacks are web integrations. |
| Signed-out Twitch chat | Current anonymous IRC behavior is not available through documented EventSub chat. |
| Official Kick chat receive without StreamFusion infrastructure | Kick's documented receive transport is webhook-only. |

## Recommended first architecture

1. Create Platform-neutral auth, credential-store, API-reader, chat, playback-source, event, and push capability contracts in shared packages. Keep Expo, Android, Twitch, Kick, SecureStore, and notification SDK types in adapters.
2. Use direct user-token calls for official signed-in reads, Twitch chat send and receive, Kick chat send, and both moderation APIs.
3. Reuse the token-only Kick Worker for exchange and refresh. Keep Twitch Device Code Grant direct unless a browser callback is chosen.
4. Add a separate integration relay for app-token public reads, provider webhooks, minimal per-install notification subscriptions, and push delivery.
5. Treat playback and account follow writes as product gates. Do not hide their unsupported status behind the shared Platform interface.
6. Isolate every accepted internal integration behind a narrow capability such as `IAccountFollowWriter`, `IPlaybackSource`, or `IKickForegroundChatSource`. Return unavailable when a Platform has no approved adapter.

This keeps direct provider calls as the normal path while containing the operations that genuinely need secrets or inbound public endpoints.

## Decision questions surfaced

1. For Android account follow buttons, should StreamFusion use Guest Follows plus a deep link to the provider, omit account writes, or accept the unsupported Twitch GQL and Kick web-session integrations?
2. For playback, is Android allowed to depend on the current internal HLS resolvers, or must it use only provider-approved playback? An official-only rule blocks native Kick playback and limits Twitch to its web embed.
3. Should signed-out discovery use a narrow official app-token read proxy, require Platform login, or accept the current web/internal read endpoints?
4. Should Kick foreground chat use a hosted webhook relay or the current undocumented Pusher connection?
5. May the notification relay store the minimal per-install follow and push mapping needed for Guest Follow alerts, despite the decision that StreamFusion settings and Guest Follows remain device-local?
6. Is Twitch's activation-code login acceptable on Android, or should StreamFusion add a backend-assisted browser Authorization Code flow for a more native login experience?

## Sources checked

Primary sources only:

- [Twitch authentication](https://dev.twitch.tv/docs/authentication/)
- [Twitch OAuth flows](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)
- [Twitch API reference](https://dev.twitch.tv/docs/api/reference/)
- [Twitch EventSub](https://dev.twitch.tv/docs/eventsub/)
- [Twitch EventSub WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
- [Twitch chat authentication](https://dev.twitch.tv/docs/chat/authenticating/)
- [Twitch IRC migration](https://dev.twitch.tv/docs/chat/irc-migration/)
- [Twitch embed requirements](https://dev.twitch.tv/docs/embed/)
- [Kick developer documentation source](https://github.com/KickEngineering/KickDevDocs)
- [Kick OpenAPI](https://api.kick.com/swagger/doc.yaml)
- [Expo AuthSession](https://docs.expo.dev/versions/latest/sdk/auth-session/)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo Video](https://docs.expo.dev/versions/latest/sdk/video/)
- [Expo push notifications](https://docs.expo.dev/push-notifications/what-you-need-to-know/)
- [Android background work](https://developer.android.com/develop/background-work/background-tasks/bg-work-restrictions)
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)
- [RFC 8252, OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html)
- [RFC 9700, OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
