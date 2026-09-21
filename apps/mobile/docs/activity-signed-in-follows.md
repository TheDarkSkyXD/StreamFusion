# Activity signed-in follows (#195)

Activity membership is the union of:

1. **Guest Follows** on-device (always available)
2. **Twitch account follows** via Helix `GET /channels/followed` when a Twitch
   credential is ready and a client id is present
   (`EXPO_PUBLIC_TWITCH_CLIENT_ID`, or the development fixture client id in `__DEV__`)
3. **Kick account follows** — **unavailable** on mobile today. The Kick official
   public API does not expose a followed-channels catalog; desktop uses the legacy
   Kick web API. Mobile degrades with reason `kick-followed-unavailable` and keeps
   Guest Follows working.

Go-live observation:

- Guest live status continues to use relay `followed-content/streams` for Guest Follows.
- Twitch signed-in live status uses Helix `GET /streams/followed` when credential + client id are present.
- Missing client ids or signed-out credentials return `unavailable` / empty live lists without breaking guest.

Background poller:

- `createGuestLiveAlertPoller` runs while the app is foreground (`AppState`), default cadence **60s**.
- Each tick calls `followingSession.hydrateLive()`, which reuses `createGuestLiveAlertReconciler`
  (silent first observe; offline→live thereafter). No native FCM requirement for guest.
