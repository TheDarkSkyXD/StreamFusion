---
module: apps/desktop/backend/twitch-gql
tags: [predictions, twitch-gql, pubsub-replacement, investigation-incomplete]
problem_type: integration_issue
created: 2026-05-18
status: investigation_incomplete
---

# Twitch viewer-side prediction read — investigation findings

## Context

The viewer-prediction widget plan (`docs/plans/2026-05-18-002-feat-viewer-prediction-widget-plan.md` U2) assumed a viewer-side GQL prediction read query exists in twitch.tv's web client now that PubSub (`predictions-channel-v1.<channel_id>`) was shut down on 2026-04-14. This doc captures what was confirmed and what remains unknown after a session of probing the renderer from inside StreamForge via electron-mcp.

## Confirmed

- **Anonymous web Client-Id works for at least some operations.** `ChannelPointsContext` returns HTTP 200 with a populated 112KB response body when called with `Client-Id: kimne78kx3ncx6brgo4mv6wki5h1ko` and no `Authorization` header, against `https://gql.twitch.tv/gql`. This contradicts the codebase's documented stance at `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-client.ts:58-65` which claims web Client-Id trips integrity without a paired integrity token. Either integrity is enforced per-operation (not globally) or the comment is partly outdated. Worth re-verifying against more sensitive operations (read-prediction, MakePrediction) when an active prediction is available.
- **`ChannelPointsContext` does NOT carry prediction data.** The response includes channel id, display name, automatic rewards, community-points settings, and `self.communityPoints` (null when anonymous) — but a case-insensitive search for `predict` in the 112KB body returned zero matches. Predictions live in a separate query, not bundled with the points context.
- **`window.electronAPI.auth.getToken('twitch')` returned `null` for `accessToken`** during this session. The app shows 54 followed channels in the sidebar and known-live status indicators (xQc 20.1K viewers on Twitch, multiple Kick streams), suggesting auth IS wired elsewhere — possibly the IPC `getToken` returns null when called from a non-stream-page renderer context, or the user is using guest mode for following. Verify when re-attempting the U3 spike (MakePrediction needs an authenticated Bearer).

## Unconfirmed (still blocked)

- **Whether a viewer-readable GQL prediction read operation exists at all.** Candidates worth trying when an active prediction is happening:
  - `Channel(login: "xqc") { predictionEvent { ... } }` — single-active-prediction shape (legacy)
  - `PredictionsEvents` (operation name)
  - `ChannelPointsPredictionsContext`
  - `PredictionContextByChannelLogin`
  - The Xtra reference client (`reference/Xtra For-Twitch-Better-Functions-etc-master/app/src/main/java/com/github/andreyasadchy/xtra/util/chat/PubSubWebSocket.kt`) used PubSub topic `predictions-channel-v1.${channelId}` — never had a GQL fallback. Xtra's later Hermes WebSocket support (`HermesWebSocket.kt`) may carry predictions on the same topic name post-PubSub-shutdown — worth investigating.
- **Whether Twitch's current web client uses GQL polling or a WebSocket channel for predictions.** Capture this by:
  1. Opening twitch.tv in a browser
  2. Navigating to an active-prediction channel (find one via the predictions category on streamcharts.com or similar)
  3. Watching DevTools Network tab through the full lifecycle: ACTIVE → LOCKED → RESOLVED
  4. Recording: operation name, request body / persistedQuery hash, response shape, AND any WebSocket frames carrying prediction events

## Probe helper for next session

When the user has an active-prediction Twitch channel open in the StreamForge app, this snippet can be pasted into the renderer console (or fired via electron-mcp) to test a candidate operation name and capture the result:

```js
(async () => {
  const operationName = "PredictionsEvents"; // or candidate name
  const variables = { channelLogin: "xqc" };  // or current channel
  const hash = "<sha256-from-network-tab>";
  const r = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko" },
    body: JSON.stringify([{
      operationName,
      variables,
      extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
    }]),
  });
  window.__predResult = { status: r.status, body: (await r.text()).slice(0, 2000) };
  console.log("predResult", window.__predResult);
})();
```

## How this affects the plan

- **U2 is blocked on confirmation** until either (a) a viewer-side GQL read query is identified, or (b) Hermes WebSocket is confirmed as the new real-time path, or (c) an authenticated EventSub-on-own-channel hybrid is accepted (currently in Deferred to Follow-Up Work).
- **U3 (MakePrediction)** can be spiked the moment auth tokens are accessible to a renderer probe — the mutation hash `b44682ec...` is documented, but live verification requires an active prediction to vote on.
- **U6/U7** stay blocked on U2/U3 outcomes.

## Recommended next step

User navigates twitch.tv directly (in a regular browser, NOT the StreamForge app) to an active-prediction channel. Captures DevTools Network tab traffic through one full prediction lifecycle. Pastes findings here. The plan's investigation-first execution note on U2 anticipated this — the gap was assuming StreamForge's renderer could substitute for browser DevTools on twitch.tv, which it cannot (the app doesn't load twitch.tv's web client; it speaks to twitch.tv's API directly).

## Second-pass attempt via Playwright (also incomplete)

Tried driving a Playwright browser to "shop" for a channel with an active prediction. Visited 14 live Twitch channels across multiple categories (Slots, Just Chatting, plus high-traffic variety / FPS / League): `summit1g`, `caedrel`, `sodapoppin`, `xqc`, `trainwreckstv`, `kaicenat`, `caseoh_`, `imperialhal__`, `theburntpeanut`, `moistcr1tikal`, `maya`, `loltyler1`, `hasanabi`, `shroud`. None had an active prediction at the moment of probe (~10:00 PM CT, weekend). DOM selectors checked: `[data-test-selector*="prediction"]`, `[data-a-target*="prediction"]`, `[class*="community-prediction"]`, `[class*="prediction-card"]`, `[class*="prediction-page"]`, plus chat-panel scan for any button text matching `^(See Details|Predict)$`.

Captured 25+ GQL operation names that fire on a typical channel load — none mention "prediction" in any form. **Strong signal that twitch.tv's web client does NOT poll for predictions on channel load; the prediction-read query is fired reactively when some push notification (WebSocket / SSE / IRC tag) tells the client a prediction has started.** Without an active prediction in flight, no prediction-read traffic surfaces regardless of which channel is visited.

Operation names confirmed to fire on channel load (no Prediction-named op among them): `BitsConfigContext_Channel`, `StreamChat`, `TrackingManager_RequestInfo`, `VideoPlayerPixelAnalyticsUrls`, `ChannelSkins`, `Prime_PrimeOffers_PrimeOfferIds_Eligibility`, `ChatList_Badges`, `ChatList_ActiveCharityCampaign`, `ChatInput`, `SharedChatModeratorStrikes`, `ChannelPage_SubscribeButton_User`, `ChannelRoot_AboutPanel`, `ActiveGoals`, `CommunitySupportSettings`, `IsParticipatingDJ`, `GuestListQuery`, `OneTapSettings`, `StreamEventCelebrationsChannelPageBadge`, `GuestStarChannelPageCollaborationQuery`, `CollaboratorListQuery`, `RealtimeStreamTagList`, `StreamMetadata`, `UseLiveBroadcast`, `UseLive`, `CelebrationEmotes`, `SettingsNotificationsPage_User_Portal`, `TitleMentions`, `PlaybackAccessToken_Template`, `CostreamingDiscoveryContextQuery`, `StreamRefetchManager`, `SharedChatSession`, `ChannelCollaborationEligibilityQuery`, `GetHypeTrainExecution`, `ExtensionsForChannel`, `GuestStarBatchCollaborationQuery`, `SideNav`.

**Conclusion:** finding the prediction-read operation requires being on a channel WITH an active prediction at the moment of capture. The probability of any random channel having one at any random moment is genuinely low (predictions are 5–10 minute windows, intermittent). Autonomous channel-shopping is high-cost / low-yield.

## Third-pass research — the answer is "no public path exists" (added 2026-05-18)

Dispatched a focused web researcher to check Twitch dev docs, third-party client source code (Chatterino, Frosty, Xtra, DankChat), and Twitch developer forums. Authoritative findings:

- **EventSub `channel.prediction.*` is architecturally broadcaster-gated by design.** The `channel:read:predictions` and `channel:manage:predictions` scopes authorize the token owner's own channel only — a viewer cannot self-authorize to read another broadcaster's predictions. Confirmed by Twitch staff in the [2021 announcement thread](https://discuss.dev.twitch.com/t/announcing-apis-and-eventsub-for-polls-and-predictions/31539) ("only the broadcaster can use it, not their mods") and the [current EventSub subscription types docs](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/). This has not changed.
- **Helix `GET /helix/predictions` has the same scope constraint** — polling not viable for viewers on other channels.
- **Chatterino2 (the most active third-party Twitch client) does NOT have a viewer-side prediction read path.** Their PubSubManager (`src/providers/twitch/PubSubManager.cpp`) subscribes ONLY to `community-points-channel-v1.*` — no prediction topic. Their CHANGELOG documents prediction commands (`/prediction`, `/lockprediction`, `/completeprediction`, `/cancelprediction`) added in 2.5.5-beta.1 — all broadcaster-only. **If Chatterino doesn't have a viewer-side read path, the path doesn't exist publicly.**
- **Xtra (`AndreyAsadchy/Xtra`) was archived October 2022.** It's not a current reference — its PubSub-based prediction reader hasn't been maintained since long before the PubSub shutdown. References to Xtra as a "post-PubSub" path were stale.
- **PubSub shutdown date correction:** the shutdown happened **2025-04-14, not 2026-04-14** as the plan and earlier discovery doc state. The earlier external research agent appears to have misread the date in the Twitch forum thread. Either way: PubSub is gone, and the conclusion holds.
- **twitch.tv's own web client almost certainly uses an internal authenticated WebSocket channel** (Hermes WebSocket — `wss://hermes.twitch.tv/v1`) that's not exposed to third parties. It receives a push when a prediction starts, then fires a reactive GQL read. Third-party clients without Hermes subscription have no trigger.

**Conclusion: viewer-side prediction READ on Twitch is not feasible through any public documented API for broadcasters the viewer doesn't own.** The brainstorm's premise that we could ship a "Twitch viewer-side prediction widget" was based on an outdated understanding of the post-PubSub landscape. The Adversarial P0-1 finding in the plan was correct: this query may not exist, and the research confirms it.

## What this means for the plan

The Twitch side of this feature has three remaining options, each with significant scope changes from the brainstorm:

1. **Own-channel-only via EventSub** — the broadcaster authorizes `channel:read:predictions` on their own token, EventSub WebSocket subscribes to `channel.prediction.*`. Works ONLY when the signed-in user IS the broadcaster of the channel being viewed (i.e., dev / QA / self-testing). Doesn't help viewers watching other channels. This was already in the original plan's `Deferred to Follow-Up Work` as a hybrid option.
2. **Rip Twitch viewer widget from this plan entirely.** Ship Kick-only (where empirical Pusher capture is still viable). Acknowledge that no third-party Twitch client offers viewer-side prediction reads today.
3. **Reverse-engineer twitch.tv's internal Hermes WebSocket and persisted GQL hashes.** Technically feasible from Electron (we can intercept the renderer's WebSocket frames if we load twitch.tv directly). But: persisted GQL hashes rotate (Twitch has changed `MakePrediction` once on 2025-11-11), Hermes is undocumented and subject to breakage, and this approach is in the gray zone of Twitch ToS. Other unofficial clients accept this risk; we'd be doing the same.

Whichever option is picked, U3 (`MakePrediction` mutation) inherits the same constraints — if the user can't read the prediction, voting on it is moot.

## Sources (verified)

- [EventSub Subscription Types — dev.twitch.tv](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/) — scope requirement
- [Legacy PubSub Deprecation Thread](https://discuss.dev.twitch.com/t/legacy-pubsub-deprecation-and-shutdown-timeline/58043) — shutdown timeline (2025-04-14)
- [Announcing APIs and EventSub for Polls and Predictions](https://discuss.dev.twitch.com/t/announcing-apis-and-eventsub-for-polls-and-predictions/31539) — broadcaster-only confirmation
- [Prediction API — dev.twitch.tv](https://dev.twitch.tv/docs/api/predictions) — Helix endpoint scope
- [chatterino2 CHANGELOG](https://github.com/Chatterino/chatterino2/blob/master/CHANGELOG.md) — EventSub migration history
- [chatterino2 PubSubManager.cpp](https://github.com/Chatterino/chatterino2/blob/master/src/providers/twitch/PubSubManager.cpp) — no prediction topic
- [AndreyAsadchy/Xtra](https://github.com/AndreyAsadchy/Xtra) — archived October 2022

## Kick: no public docs either, but Pusher capture is still feasible

- [KickEngineering/KickDevDocs](https://github.com/KickEngineering/KickDevDocs) — last updated Feb 2025, no prediction endpoints documented
- [Bukk94/KickLib](https://github.com/Bukk94/KickLib) — no prediction classes
- [fb-sean/kick-website-endpoints](https://github.com/fb-sean/kick-website-endpoints) — references Pusher events gist but no prediction event names listed
- Documented `App\Events\PollUpdateEvent` suggests an analogous `App\Events\PredictionUpdateEvent` (or similar) likely exists, but the schema is unknown until empirical capture from a live kick.com session with an active prediction.

Kick stays empirically capturable — U4 / U5 are still actionable when a Kick prediction is active. Twitch is the platform that needs the scope decision.
