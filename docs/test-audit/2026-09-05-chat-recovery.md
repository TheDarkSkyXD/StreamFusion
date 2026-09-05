# Chat recovery audit

Tested revision: `a023d8e`. Date: September 5, 2026.

The remaining recovery checks found three user-visible failure modes: hidden rooms disappear after account loss, a failed Kick room subscription stays stranded, and optional emotes block MultiView chat startup. A separate adapter probe found that Twitch retains stale credentials when its token refresher returns null. The 310-second network outage recovered every chat automatically.

This is a verification report. These newly reproduced defects remain open; this follow-up changes no application code.

## Surface and evidence

The disposable Electron run `chat-recovery-20260905` used the real renderer, preload bridge, platform services, and live rooms added through MultiView search: Twitch `caedrel` and `zizaran`; Kick `conner` and `shoovy`. Launch typecheck/lint, renderer ownership, bridge, and isolated database checks passed.

Local screenshots, measurements, action journals, and rerunnable probes are retained under `.scratch/verify-streamfusion/evidence/chat-recovery-20260905/`. No chat messages or moderation actions were sent. Kick sign-out affected only the copied local profile. Twitch remote logout was not invoked because it revokes the original grant.

Connection assertions read the platform services directly. The merged view's store status was stale despite incoming messages. Kick's service `isAuthenticated` flag reflects socket connection and cannot establish account authentication. Message IDs, actual subscription states, and account-store booleans are reported separately.

## Results

| Case                                          | Result                                                    | Observed evidence                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 310-second renderer network outage            | Pass for chat recovery                                    | Every room retained its history and received new message IDs without navigation or reload. First changed IDs after restoration: caedrel 10.02s, zizaran 15.03s, shoovy 40.09s, conner 45.10s. Sampling interval: 5s.                                                                                                                                     |
| Workspace disposal during an outage           | Pass for disposal; navigation not certified               | Leaving MultiView cleared every room and message bucket. Both services were disconnected by the 15-second restoration sample, and no rooms reopened during the 90-second observation. The uncached Settings route hit the development server's offline module-load error, so this establishes disposal after unmount, not successful offline navigation. |
| Kick sign-out with a hidden room              | Fail                                                      | Real profile-menu **Disconnect Kick** action. The connection changed from conner + shoovy to only conner. Shoovy's last message and count remained unchanged through the 24.18s observation.                                                                                                                                                             |
| Twitch auth loss with a hidden room           | Fail under simulated prior auth status                    | The real preload auth-loss event reached the real auth-store listener. The connection changed from caedrel + zizaran to only caedrel; the visible room resumed anonymously.                                                                                                                                                                              |
| One Kick room subscription failure            | Fail under SDK fault injection                            | Both conner subscriptions remained unsubscribed for all 45 samples, while the shared socket and shoovy stayed healthy. The service still listed conner as connected.                                                                                                                                                                                     |
| Slow optional emote startup                   | Fail under dependency delay                               | On a fresh merged-view renderer, both sockets connected but all four room lists and message buckets remained empty while two 7TV preload replies were held. The UI showed the ordinary empty-chat message. Releasing the requests restored all rooms and messages.                                                                                       |
| Failed optional emote provider                | Recovery passes after rejection; startup dependency fails | A separate provider-level hold delayed the workspace-only shoovy JOIN for 36.31s. JOIN began 2ms after the held provider rejected, and messages followed.                                                                                                                                                                                                |
| Twitch reconnect token refresher returns null | Fail in adapter probe                                     | Real TwitchChatService with fake IRC transport retained an authenticated identity after one null refresh. Both rooms rejoined, but anonymous fallback was not selected. The refreshed-token control passed.                                                                                                                                              |

The outage controls use Chromium offline emulation, scoped to the disposable renderer. They exercise the real transports and wall-clock timers. They do not establish more than ten application-level retry attempts: Pusher also retries internally, and Chromium held Twitch's closing socket until network restoration. Existing service tests separately exercise extended retry scheduling.

The copied Twitch account was already disconnected. Its test supplied a clearly labeled connected/nonexpired status through the preload response while preserving the real saved user, then delivered `auth:twitch-auth-lost`. It proves consumer transition behavior, not a real authenticated-to-expired IRC exchange. The null-token probe uses synthetic credentials and a fake transport, not provider authentication.

Kick public rooms normally authorize locally. The room probe actually unsubscribed the two room channels, failed their next SDK authorization once, and restored authorization immediately. Pusher emitted its real subscription-error event. This proves the application's response to that SDK failure, not that Kick's public server produces it. Switching to conner added history and system rows but did not restore its subscriptions. Navigating away and reopening MultiView restored them and subsequent message IDs.

The emote holds are dependency simulations that bypass the production HTTP deadline. Production 7TV reads have a 12-second default budget; the synthetic 36-second hold is not evidence of an actual 36-second provider request. The first provider probe had cached Twitch emotes and another owner for conner, so only shoovy was blocked. The fresh-renderer preload probe independently confirmed both platforms' workspace startup dependency.

## Repair boundaries and acceptance conditions

- **Account loss:** `KickChat.tsx` and `TwitchChat.tsx` disconnect their shared service and rejoin only the visible room. Preserve all desired rooms at the shared connection boundary. Verify sign-out and sign-in with multiple rooms, without duplicate subscriptions or disturbing the other platform.
- **Kick room recovery:** `kick-chat.ts` treats tracked membership as a completed join and only logs subscription errors. Track/retry the affected subscription with cancellation on release. Require a successful acknowledgement and incoming messages without resetting healthy rooms.
- **Emote startup:** `use-multi-chat-sessions.ts` awaits global emotes before JOIN. Start room membership independently of optional decoration loading. Verify incoming messages and prompt disposal while emotes remain pending or fail.
- **Twitch null refresh:** `runReconnect` keeps cached credentials when the refresher returns null, contrary to its documented contract. Verify anonymous fallback and full room retention, then repeat with valid refreshed credentials as a control.

Merged chat also needs a clear disconnected/reconnecting state. The outage screenshots retain the chat history without explaining the lack of incoming messages. Playback was still buffering in post-outage captures; the chat recovery pass does not certify video recovery.

## Automated checks and limits

The existing Twitch and Kick service suites pass: 64 tests across the node and DOM projects. The isolated null-refresh probe produced one passing control and one expected failure; its temporary test was removed after retaining the source and output locally. No failing probe was added to the normal suite.

The final doctor detected the expected uncached development-module error from the offline Settings navigation. Process ownership and preload remained valid. This error is retained in `outage-60.json`; it is not classified as a compiled-app navigation defect. The disposable run was cleaned up after the probes, preserving its evidence.

Fix Root Causes kept source hypotheses separate from reproduced failures. Prove It Works required live message/subscription observations and a fresh-renderer repeat to rule out cached emotes. Provider rejection and authentication simulations remain explicitly distinguished from real provider events.
