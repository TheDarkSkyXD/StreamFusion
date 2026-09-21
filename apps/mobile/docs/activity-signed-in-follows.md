# Activity signed-in follows (#195)

Activity membership is the union of:

1. **Guest Follows** on-device (always available)
2. **Twitch account follows** via Helix `GET /channels/followed` when a Twitch
   credential is ready and a client id is present
   (`EXPO_PUBLIC_TWITCH_CLIENT_ID`, or the development fixture client id in `__DEV__`)
3. **Kick account follows** via the legacy Kick web catalog
   `GET https://kick.com/api/v2/channels/followed` with the signed-in OAuth
   Bearer token (same cheap path desktop `_tryBearerFetch` uses). Official
   `api.kick.com` has no followed-channels endpoint. Desktop may also use
   cookie / BrowserWindow fallbacks that mobile cannot; when Bearer auth fails,
   Cloudflare challenges, or the payload cannot be parsed, mobile returns
   `unavailable` (reasons such as `kick-signed-out`, `kick-followed-auth-failed`,
   `kick-followed-cloudflare`, `kick-followed-network`, `kick-followed-parse`)
   and Guest Follows keep working.

Go-live observation:

- Guest live status continues to use relay `followed-content/streams` for Guest Follows.
- Twitch signed-in live status uses Helix `GET /streams/followed` when credential + client id are present.
- Kick signed-in live status reuses relay `followed-content/streams` with the
  Guest ∪ Kick-account membership union (Kick has no official live-followed API).
- Missing client ids or signed-out credentials return `unavailable` / empty live lists without breaking guest.

Background poller:

- `createGuestLiveAlertPoller` runs while the app is foreground (`AppState`), default cadence **60s**.
- Each tick calls `followingSession.hydrateLive()`, which reuses `createGuestLiveAlertReconciler`
  (silent first observe; offline→live thereafter). No native FCM requirement for guest.
