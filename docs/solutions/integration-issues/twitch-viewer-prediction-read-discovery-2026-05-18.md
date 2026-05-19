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
