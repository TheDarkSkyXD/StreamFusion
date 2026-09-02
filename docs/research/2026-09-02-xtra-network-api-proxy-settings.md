# Xtra network, API token, and HTTP proxy settings

Research date: 2026-09-02

This note compares StreamFusion with Xtra at revision [`17587ad`](https://github.com/crackededed/Xtra/tree/17587ada8efc562fcb3a36cad6b133e79c01e00f). The revision is pinned because Xtra changes independently of StreamFusion.

## Finding

Xtra's root **Network library** setting selects one of three Android HTTP engines. It is not a downloadable library or a general proxy mode. The selected engine handles Twitch REST and GraphQL calls, OAuth calls, images, and online media loads. Xtra's custom WebSocket implementation still opens Java sockets directly.

StreamFusion already has an **API / Tokens** page, a default-session HTTP proxy, and ordered Twitch playlist proxies. It does not have a network-engine selector. A literal port of Xtra's selector would not fit Electron because StreamFusion already gets Chromium's network stack through renderer `fetch`, `net.fetch`, and `Session.fetch`. A selector needs a second complete, supported desktop transport before it earns a place in Settings.

## Xtra's Network library selector

The root preference stores the string `network_library` in Android's default `SharedPreferences`. Its default is `OkHttp`. The current choices are `HttpEngine`, `Cronet`, and `OkHttp`. See [`root_preferences.xml` lines 123-131](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/res/xml/root_preferences.xml#L123-L131), [`arrays.xml` lines 8-22](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/res/values/arrays.xml#L8-L22), and [`ContextExtensions.kt` lines 20-22](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/util/ContextExtensions.kt#L20-L22).

Xtra filters the choices against the device. Android `HttpEngine` requires Android R or newer and SDK extension 7 for Android S. Cronet requires an enabled `CronetProvider`. Xtra hides the selector when neither optional engine is available. It removes only the unavailable option when one is available. See [`SettingsActivity.kt` lines 407-425](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/settings/SettingsActivity.kt#L407-L425).

All three engines are created lazily. `HttpEngine` and Cronet get QUIC hints for Twitch and emote hosts. OkHttp is the unconditional fallback. Any unavailable or unrecognized selection reaches the OkHttp branch. See [`XtraModule.kt` lines 40-99](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/XtraModule.kt#L40-L99).

The setting affects these request classes:

- Twitch OAuth validation and token calls. The repository switches engines for each request and falls back to OkHttp. See [`AuthRepository.kt` lines 30-90](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/repository/AuthRepository.kt#L30-L90).
- Twitch GraphQL and persisted GraphQL calls. See [`GraphQLRepository.kt` lines 132-205](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/repository/GraphQLRepository.kt#L132-L205).
- Twitch Helix calls. See [`HelixRepository.kt` lines 49-101](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/repository/HelixRepository.kt#L49-L101).
- Coil image requests. See [`XtraApp.kt` lines 48-175](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/XtraApp.kt#L48-L175).
- HLS playlist and segment loading in ExoPlayer. See [`ExoPlayerService.kt` lines 434-455](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/player/ExoPlayerService.kt#L434-L455).

The selector does not replace Xtra's WebSocket transport. Xtra's IRC, EventSub, Hermes, and 7TV socket clients use its own `WebSocket` class, which opens a `java.net.Socket` and wraps it with TLS. See [`WebSocket.kt` lines 37-100](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/util/WebSocket.kt#L37-L100).

## Xtra's API token settings

Xtra exposes a writable token page. The user can choose which APIs the login flow obtains tokens for. The values are both, GQL only, or Helix only, with both as the default. The page also exposes the Helix client ID, the Helix redirect URL, the GQL client ID, the current user ID and login, the Helix token, the GQL token, the Web GQL token, and a validate-tokens switch that defaults on. See [`api_token_preferences.xml` lines 4-77](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/res/xml/api_token_preferences.xml#L4-L77) and [`arrays.xml` lines 229-233](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/res/values/arrays.xml#L229-L233).

The login setting changes the acquisition flow. GQL-only login opens Twitch login directly. Both and Helix-only begin with the Helix authorization URL. The both path continues into GQL login after a valid Helix token. See [`LoginActivity.kt` lines 136-169](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/login/LoginActivity.kt#L136-L169), [`LoginActivity.kt` lines 316-322](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/login/LoginActivity.kt#L316-L322), and [`LoginActivity.kt` lines 512-539](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/login/LoginActivity.kt#L512-L539).

Xtra writes the user identity and all three token values to a separate private `SharedPreferences` file named `prefs2`. The values are plain strings, not encrypted values. Xtra excludes `prefs2.xml` from Android backup. See [`SettingsActivity.kt` lines 1249-1301](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/settings/SettingsActivity.kt#L1249-L1301), [`ContextExtensions.kt` lines 20-22](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/util/ContextExtensions.kt#L20-L22), and [`backup_rules.xml` lines 2-6](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/res/xml/backup_rules.xml#L2-L6).

Xtra builds request headers from those settings. It sends the GQL token as `Authorization: OAuth ...` only when the caller asks to include it. It sends the Helix token as `Authorization: Bearer ...`. See [`TwitchApiHelper.kt` lines 245-290](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/util/TwitchApiHelper.kt#L245-L290).

When network connectivity returns and token validation is enabled, Xtra validates the present tokens against Twitch. It checks that the returned client ID matches the configured client ID. A 401 opens the logout flow. See [`MainActivity.kt` lines 200-228](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/main/MainActivity.kt#L200-L228) and [`MainViewModel.kt` lines 978-1029](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/main/MainViewModel.kt#L978-L1029).

## Xtra's HTTP proxy settings

Xtra has two separate playback proxy systems.

The first system is an ordered list of custom stream playlist URLs. It is enabled by default and takes precedence over the HTTP proxy list. A URL can contain `$channel`, and Xtra can add `allow_source`, `allow_audio_only`, and `fast_bread` query parameters. See [`root_preferences.xml` lines 85-109](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/res/xml/root_preferences.xml#L85-L109) and [`ExoPlayerService.kt` lines 801-840](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/player/ExoPlayerService.kt#L801-L840).

The second system is the page named **HTTP proxy settings**. It stores an ordered list of records with this shape:

```text
host
port
username
password
proxyPlaybackAccessToken
proxyMultivariantPlaylist
proxyMediaPlaylist
position
enabled
```

New records enable media-playlist proxying by default. The master switch for the list defaults off. Xtra only considers enabled records with a host, a port, and at least one request-class switch. See [`StreamProxy.kt` lines 6-19](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/model/ui/StreamProxy.kt#L6-L19), [`root_preferences.xml` lines 98-109](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/res/xml/root_preferences.xml#L98-L109), and [`ExoPlayerService.kt` lines 672-686](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/player/ExoPlayerService.kt#L672-L686).

The three switches scope the HTTP proxy to the playback-token request, the multivariant HLS playlist, or media playlists after ad detection. The transport implementation follows the selected network library. Xtra creates a proxy-capable `HttpEngine` or Cronet engine when supported and uses an OkHttp proxy client as the fallback. Proxy authentication uses the stored username and password. See [`PlayerRepository.kt` lines 114-191](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/repository/PlayerRepository.kt#L114-L191) and [`ExoPlayerService.kt` lines 874-965](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/player/ExoPlayerService.kt#L874-L965).

Xtra uses list order as failover order. A failed proxied playback-token request advances to the next eligible proxy, then falls back to a direct request when the list is exhausted. An HTTP error during playback also advances the active proxy and restarts the player after 1.5 seconds. See [`ExoPlayerService.kt` lines 335-360](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/player/ExoPlayerService.kt#L335-L360) and [`ExoPlayerService.kt` lines 837-867](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/ui/player/ExoPlayerService.kt#L837-L867).

The records live in Xtra's Room database. The model stores the username and password as plain strings. Android backup includes the database, so the source does not provide encrypted-at-rest handling for these proxy credentials. See [`StreamProxy.kt` lines 6-19](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/model/ui/StreamProxy.kt#L6-L19), [`XtraModule.kt` lines 299-308](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/java/com/github/andreyasadchy/xtra/XtraModule.kt#L299-L308), and [`backup_rules.xml` lines 2-6](https://github.com/crackededed/Xtra/blob/17587ada8efc562fcb3a36cad6b133e79c01e00f/app/src/main/res/xml/backup_rules.xml#L2-L6).

## Implications for StreamFusion desktop

StreamFusion already covers the useful user outcomes:

| Xtra capability | StreamFusion status | Important difference |
| --- | --- | --- |
| Network library selector | Missing | Electron already supplies Chromium networking. StreamFusion also has Node `fetch` call sites, so a selector cannot change every request without a broad transport migration. |
| API token settings | Present | [`Settings/index.tsx`](../../apps/desktop/src/frontend/pages/Settings/index.tsx) shows read-only Twitch and Kick identity, validity, expiry, and scopes. It does not reveal or accept raw token values. [`storage-service.ts`](../../apps/desktop/src/backend/services/storage-service.ts) encrypts tokens with Electron `safeStorage` when available. |
| Custom playlist proxy list | Present | [`TwitchPlaylistProxySettingsSection.tsx`](../../apps/desktop/src/frontend/features/settings/components/settings/TwitchPlaylistProxySettingsSection.tsx) stores ordered `$channel` URL templates and checks source availability. |
| HTTP proxy | Present | [`stream-proxy-service.ts`](../../apps/desktop/src/backend/services/stream-proxy-service.ts) applies one HTTP and HTTPS proxy to Electron's default session. It stores credentials with `safeStorage` and never returns them to the renderer. Node fetches and interceptor-owned manifest retrieval remain outside that session proxy. |
| Per-request-class HTTP proxy switches | Missing | Electron `Session.setProxy` applies to a whole session. StreamFusion cannot truthfully offer Xtra's three independent playback switches on the existing default session. |
| Multiple HTTP proxy endpoints with failover | Missing | StreamFusion configures one endpoint. Xtra stores an ordered list and advances after playback failures. |

Electron documents that `net.fetch` and renderer `fetch` use Chromium's network stack, while Node `fetch` uses Node's HTTP stack. See the official [Electron `net` reference](https://www.electronjs.org/docs/latest/api/net/). Electron also documents that `Session.setProxy` configures one session. See the official [Electron `session` reference](https://www.electronjs.org/docs/latest/api/session).

### StreamFusion request-class ledger

| Request class | Current transport | Default-session proxy |
| --- | --- | --- |
| Renderer fetch/XHR and media segments in the main window | Chromium default session | Yes |
| Shared main-process requests through `RobustHttpClient` | `AppNetwork` / Chromium default session | Yes |
| Manifest-interceptor upstream and backup retrieval | Node fetch | No; using the intercepted session would recursively re-enter `webRequest` |
| Chat and event WebSockets | Platform-specific socket clients | No |
| Explicit direct partitions, including Kick CDN | Separate Chromium sessions in direct mode | No |
| Remaining main-process global-fetch call sites | Node fetch | No; migrate only after checking session and interceptor constraints |

My recommendation is not to copy Xtra's root selector yet. First route the network calls that must share proxy, DNS, TLS, and cache behavior through one StreamFusion request boundary. Keep Chromium as the default. Do not route interceptor-owned manifest retrieval through the intercepted default session because that recursively re-enters Electron's `webRequest` handler; proxying that path requires a separate, proxy-synchronized session. Add a second engine only if a measured compatibility problem proves that it is useful and the second engine covers the same request classes.

Do not port Xtra's raw token editors. StreamFusion's read-only status and reconnect flow keep credentials out of the renderer and avoid mismatched client-ID and token pairs. The existing HTTP proxy also has stronger credential storage than Xtra. The worthwhile parity gaps are multiple proxy endpoints and failover, but only if users need them. Per-request-class switches require separate Electron sessions or dedicated loaders, not three UI toggles over `defaultSession`.
