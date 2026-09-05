# Chat recovery fix verification

Application revision: `7405c0e`. Date: September 5, 2026.

The four reproduced recovery defects are fixed. Twitch preserves desired rooms across an account change and reconnects anonymously when token refresh returns null. Kick account changes no longer reset public chat subscriptions, and a failed room retries independently. MultiView JOIN and disposal no longer wait for optional emotes.

## Live Electron checks

The disposable development run `chat-recovery-fixes-20260905` used Twitch `caedrel` and `zizaran`, and Kick `conner` and `shoovy`, added through MultiView search. Local evidence is retained at `.scratch/verify-streamfusion/evidence/chat-recovery-fixes-20260905/`. No chat messages or moderation actions were sent. Kick sign-out changed only the copied local profile.

| Case                                   | Result                                 | Observed evidence                                                                                                                                                                                                                                                                                |
| -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Optional global emotes remain pending  | Pass                                   | Both 7TV preload requests remained held. All four rooms received real service message events over 19.19 seconds: caedrel 75, zizaran 2, conner 20, shoovy 15.                                                                                                                                    |
| Close chat while emotes remain pending | Pass                                   | The toolbar Chat action cleared all room memberships and message buckets before either request was released. No messages arrived during the next four seconds. Reopening after release restored subscriptions.                                                                                   |
| Kick room subscription error           | Pass                                   | Both conner channels were actually unsubscribed and the next SDK authorization failed once. Both replacement subscriptions were acknowledged by the 5.13-second sample. Conner received 19 new stored messages during the observation. Both shoovy subscriptions stayed acknowledged throughout. |
| Kick sign-out with hidden shoovy       | Pass                                   | The real Disconnect Kick action left both rooms subscribed. Conner received 25 messages and hidden shoovy received 7 over 19.16 seconds. Both Twitch rooms also continued.                                                                                                                       |
| Twitch auth loss with hidden zizaran   | Pass under simulated prior auth status | The real preload auth-loss event changed the auth-store flag from true to false. Both Twitch room names survived the reconnect. Caedrel received 80 messages and hidden zizaran received 3 over 29.23 seconds. Both Kick rooms continued.                                                        |

The 310-second renderer network outage also passed. All four histories remained present in every sample, and new service message events arrived without navigation or reload. First incoming samples after restoration were 10.04 seconds for caedrel, conner, and shoovy, and 35.08 seconds for zizaran. Sampling was every five seconds. Recovery remained stable throughout the 90-second restoration observation.

Closing chat after a second Kick subscription failure cancelled the pending retry. By the first sample, 174ms after the fault, all chat-room subscriptions and message buckets were absent. They stayed absent for the next 19.21 seconds. The two unrelated stream-metadata subscriptions remained active on the shared Pusher connection.

The copied Twitch account was already signed out. Its auth-loss check simulated only the prior connected status, preserving the saved user and supplying no credentials. This establishes consumer transition behavior, not a real token expiry at Twitch. Null-refresh and valid-refresh controls use the real service with a fake IRC transport in the permanent regression suite.

The 7TV hold and Pusher authorization failure are explicit dependency-boundary simulations. Successful message data and acknowledgements came from the live services. Holds bypass the production HTTP deadline and are not measurements of real provider latency. Kick's `isAuthenticated` service field reports socket connection; profile-menu state and the auth store establish sign-out separately.

Vite hot updates created versioned service imports. Initial observer results from unversioned duplicate instances were discarded. Final helpers use the exact URLs imported by the running session hook, and actual service message events establish continued delivery. The renderer was fully reloaded after source changes before the reported checks.

Chromium offline emulation exercises actual sockets and wall-clock timers but does not establish more than ten application-level retries. Pusher retries internally, and Twitch's closing socket was delayed by Chromium. The tests separately cover extended retry scheduling. Video players remained buffering in the post-outage capture; this pass certifies chat recovery only. The previously noted missing merged-chat reconnect indication remains a UX follow-up.

Final doctor and database checks passed, with no detected uncaught errors and SQLite `quick_check` returning `ok`. Cleanup removed the isolated run and preserved its evidence.

## Automated verification

The integrated backend chat, component, session, scrolling, and merged-feed checks pass: **494 tests across 25 files**. Desktop TypeScript, full ESLint, scoped Prettier, and independent correctness review pass.

`npm run build` passed before the root `npm run test:e2e` gate. The fresh compiled Electron run `2026-09-05T10-25-49-544Z` passed renderer ownership, preload, rendered shell, and database checks, then cleaned up successfully. Its evidence remains under `.scratch/verify-streamfusion/evidence/2026-09-05T10-25-49-544Z/`. This smoke test establishes compiled startup; the development run above establishes live recovery behavior.

React Doctor reports 90/100. Its two component-state warnings concern existing components. Sequential Twitch JOIN restores cancellation ordering; the filter/map over the small room collection is retained for clarity. No suppression was added. The feature architecture check retains the unrelated existing `feature folder is missing: auth/utils` failure.

Red tests precede their fixes in git history. See the [regression audit log](2026-05-19-audit-log.md) for the test and fix commits. The original [recovery audit](2026-09-05-chat-recovery.md) retains the failing runtime evidence.

Fix Root Causes removed the shared-socket reset and optional-dependency barriers. Model the Domain separated desired Kick membership from acknowledged subscriptions. Prove It Works required live incoming messages and acknowledged subscriptions before marking a recovery check passed.
