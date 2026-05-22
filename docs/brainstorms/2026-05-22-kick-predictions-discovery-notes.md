---
date: 2026-05-22
topic: kick-predictions-discovery-notes
companion-to: 2026-05-18-viewer-prediction-widget-requirements.md
---

# Kick Predictions — Discovery Notes

Companion to `docs/brainstorms/2026-05-18-viewer-prediction-widget-requirements.md`. Written during a `/ce-debug` → `/ce-brainstorm` chain on 2026-05-22 after the user reported "I don't see Kick predictions when signed in" and `kick-chat.ts` was confirmed to have no Pusher binding for prediction events.

Two-stage discovery. **Stage 1** (remote research — community libraries, public docs) returned a dead end: no third-party Kick client had implemented predictions and Kick's public API does not cover them. **Stage 2** (Playwright into kick.com + direct download of the Next.js bundle from `assets.kick.com`) recovered the full prediction surface from kick.com's frontend code. The remainder of this doc is Stage 2 evidence.

---

## Confirmed: feature mechanic

From `help.kick.com` (Predictions guides for streamers + viewers) + Kick's frontend bundle:

- Streamers / moderators start predictions via the `/prediction` chat command (or the in-UI "create prediction" tile). Two outcomes. Viewer-specified duration.
- Viewers see a **banner above chat** with a `predict` button. Same panel also reachable from the **Channel Points** menu.
- Bet range: **10 to 250,000 channel points**.
- Streamer or moderator resolves by picking the winning outcome.
- Winners split the pool proportionally to their stake.
- **24-hour refund** if no outcome is selected after the prediction concludes.
- Prediction state values seen in the frontend: `ACTIVE`. Bundle implies additional values (transition strings include "lock", "delete", "choose outcome", "deleted") but the exact set of state strings beyond `ACTIVE` was not directly extractable — confirmable from the first live event.

---

## Pusher subscription (Stage 2 evidence)

### Channel name

```
predictions-channel-${channelId}
```

**Not** the chat channel. Kick uses a dedicated per-channel Pusher channel for prediction events. Channel id is the numeric channel id (the same id the chat uses — `useChatroomContext().channelId`).

Source: chunk `0ha56cz8ufind.js`:
```js
let t=`predictions-channel-${e}`;
return s(t,"PredictionUpdated",l),s(t,"PredictionCreated",o),
       ()=>{i(t,"PredictionUpdated",l),i(t,"PredictionCreated",o)};
```

### Event names

Only **two** event names exist:

1. **`PredictionCreated`** — fires when a prediction first becomes active. Payload includes the full prediction. kick.com's handler clears any existing `user_vote` on receive (suggesting this can fire when a new prediction supersedes a previous one even within the same session).
2. **`PredictionUpdated`** — fires for **all state changes after creation** (vote count tick, lock, resolve, cancel). Payload carries the new prediction state. State transitions (LOCKED, RESOLVED, CANCELED) ride on the `state` field of the prediction inside this event, not as separate events.

Both events are **plain string names**, not the `App\Events\X` namespace used by the chatroom channel. Note this divergence — `kick-chat.ts` binds names like `App\\Events\\ChatMessageEvent`, but prediction events do not carry the `App\\Events\\` prefix.

### Payload shape

```js
// Both events:
{ prediction: <Prediction> }
```

`Prediction` shape (inferred from frontend consumption):

```ts
{
  id: string;
  title: string;
  state: "ACTIVE" | string;       // others observed transition labels: locked, resolved, canceled
  outcomes: [Outcome, Outcome];   // exactly 2
  winning_outcome_id?: string;    // set when resolved
  duration: number;               // seconds
  created_at: string;             // ISO timestamp
  user_vote?: {                   // the viewer's own stake; only populated when authed
    outcome_id: string;
    total_vote_amount: number;
  };
}

type Outcome = {
  id: string;
  title: string;
  total_vote_amount: number;
  // icon colors picked at render time, not on the payload:
  //   outcome[0] uses #18FBB0 (green)
  //   outcome[1] uses #FEA0A0 (pink)
};
```

### Auth gating in kick.com's UI

The kick.com subscription is **gated by `session.status === "authenticated"`** — guests on kick.com do **not** subscribe to `predictions-channel-{id}`:

```js
if(!r||"authenticated"!==a.status) return;
let t=`predictions-channel-${e}`;
return s(t,"PredictionUpdated",l), s(t,"PredictionCreated",o), ...
```

Two unverified questions follow:

1. Is the channel itself a **public Pusher channel** (anonymous subscription succeeds), or is it `private-`/`presence-`-prefixed under the hood (requires Pusher auth endpoint)? The frontend code does not prefix the channel name, suggesting public — but kick.com's Pusher instance is configured separately and may enforce auth on this channel even without the prefix.
2. Is the auth gate a kick.com UX choice ("guests can't vote, so no point subscribing") or a hard requirement?

**Planning task**: in StreamFusion, attempt anonymous subscription to `predictions-channel-{id}` first. If it succeeds, predictions show for guests AND signed-in users (better than kick.com's native behavior). If it fails, fall back to subscribing only when the StreamFusion user is signed in with Kick.

---

## REST API (Stage 2 evidence)

Source: chunk `00d8vh9mhsenj.js`. All under `assets.kick.com`-fronted but call to `kick.com/api/v2/...`.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/v2/channels/{channelSlug}/predictions/latest` | Returns the channel's currently active or most-recently-ended prediction. Used for mid-session join seed (R14 in `2026-05-18` reqs). | Likely auth optional for read; verify. |
| GET | `/api/v2/channels/{channelSlug}/predictions/recent` | Historical list. Not in our R-set. | Same. |
| POST | `/api/v2/channels/{channelSlug}/predictions/vote` | Cast a viewer vote (R8). Body: `{ outcomeId, amount }`. | Required (session-cookie auth, same surface as `kick-mod-mutations.ts`). |
| PATCH | `/api/v2/channels/{channelSlug}/predictions/{predictionId}` | Streamer/mod actions (lock, resolve, delete). Out of viewer-widget scope but documented here for completeness. | Mod-only. |

`channelSlug` is the URL slug (e.g. `ramee`), not the numeric id. The Pusher channel uses the numeric id, the REST endpoints use the slug — two id surfaces in this feature alone. (See also `memory/project_kick_dual_id_followups.md` for the broader dual-id pattern in Kick's API.)

---

## Frontend UI references (helpful for our parity work)

From chunk `00d8vh9mhsenj.js`:

- Translation namespace: `"Predictions"` (i18n key root).
- Components: `PredictionBanner`, `PredictionHeader`, `PredictionOptions`, `PredictionOutcomeField`, `PredictionOutcome.Title/Stats`, `PredictionTimer`.
- Icon set: `PredictionsOption1Icon` (green `#18FBB0`), `PredictionsOption2Icon` (pink `#FEA0A0`).
- Button labels (i18n keys): `predict`, `manage`, `not_now`.
- Chat tile event: `CHANNEL_POINTS_PREDICTION_TILE` — a chat message variant that renders a "create prediction" tile for broadcasters (`ep.chatroomEventManager.emit(ex.EventType.CreatePrediction, void 0)`). Out of viewer scope but explains why mod-side prediction UI lives in the chat message stream on kick.com.

Our existing `PredictionBanner` (`apps/desktop/src/components/chat/PredictionBanner.tsx`) already uses the right color tokens — outcome-1 green / outcome-2 pink — without our team having seen kick.com's. That parity was a good guess; we can confirm it without changes.

---

## Implication: the user's original question

The original `/ce-debug` question was "why don't I see Kick predictions when signed in if I see them as guest?"

The answer is now overdetermined:

1. **StreamFusion side**: `kick-chat.ts` has no binding for either Pusher event. Predictions cannot reach the widget in either auth state. The only path to populate the widget today is the dev injection in `ChatSimTool`, which is auth-agnostic. The user's observed "see as guest" was almost certainly a stale dev injection.
2. **kick.com side**: even on kick.com itself, predictions are auth-gated — guests are the **less** likely state to see them, the opposite of what was reported. This confirms (1): the observation was about StreamFusion, not kick.com.

The fix is unambiguous: bind `PredictionCreated` and `PredictionUpdated` on a new `predictions-channel-{id}` Pusher subscription in `kick-chat.ts` (or a sibling service), normalize the payload to `UnifiedPrediction`, emit `predictionUpdate`. Frontend wiring is already complete.

---

## What this means for `/ce-plan`

The 2026-05-18 requirements doc's Outstanding Questions section has these items now **resolved** (move them out of "Deferred to Planning" and into the planning input as confirmed facts):

- **R8 (Kick vote endpoint):** `POST /api/v2/channels/{channelSlug}/predictions/vote`, body `{ outcomeId, amount }`. ✅
- **R12 (Kick Pusher event names):** `PredictionCreated`, `PredictionUpdated` on `predictions-channel-{channelId}`. Payload `{ prediction }`. ✅
- **R14 (mid-prediction-join seed):** `GET /api/v2/channels/{channelSlug}/predictions/latest`. ✅
- **R22 (unified prediction model):** Kick payload shape now known (see `Prediction` type above) — normalization mapping is straightforward. ✅

Still unresolved / require planning judgment:

- Anonymous vs auth-gated subscription (see "Auth gating in kick.com's UI" above). Planning task: probe behavior in StreamFusion. Default to attempting anonymous; degrade to auth-gated on subscription-error.
- Exact state strings beyond `ACTIVE`. Planning task: capture from the first live `PredictionUpdated` after a streamer locks/resolves.
- Exact error shapes from `POST /predictions/vote` (insufficient balance, outcome locked, already voted). Planning task: capture during dev test against a real channel.
- Channel-points balance fetch endpoint (R7). Bundle references `ChannelPointsQueries.points(channelSlug)` — endpoint URL not extracted in this discovery pass; likely `GET /api/v2/channels/{channelSlug}/me/channel-points` or similar. Planning task: extract from same bundle if needed.

### Suggested phasing for the implementation

Now that discovery is done, the build can phase cleanly:

1. **Phase 1 — Kick read-only banner (small).** New Pusher channel subscription in `kick-chat.ts` (or sibling), the two event bindings, normalization to `UnifiedPrediction`, emit `predictionUpdate`. Plus the `GET /predictions/latest` seed on channel mount. This is the smallest cut that addresses the user's stated pain.
2. **Phase 2 — Kick viewer voting.** `POST /predictions/vote` + balance fetch + the active-vote UI. Adds R6-R11 for Kick.
3. **Phase 3 — Twitch real-time parity.** PubSub `predictions-channel-v1.{channel_id}` + the same widget plumbing. Independent of phase 1/2; could run in parallel.
4. **Phase 4 — Twitch viewer voting.** Twitch GQL `MakePrediction`. Same shape as phase 2.
5. **Phase 5 — Settings UI for native vs unified style toggle (R20-R24).** Pure frontend.
6. **Phase 6 — Dev tooling parity (R28, R29).** Add the Twitch poll injection buttons that mirror the existing Kick poll buttons. Trivial.

Phase 1 is the smallest meaningful slice — it's the one the user explicitly asked about. Phases 2+ are the larger build.

---

## Sources

### Stage 1 (background)

- [Guide to Predictions for Viewers — Kick.com Help Center](https://help.kick.com/en/articles/11043577-guide-to-predictions-for-viewers)
- [Guide to Predictions for Streamers — Kick.com Help Center](https://help.kick.com/en/articles/11182854-guide-to-predictions-for-streamers)
- [How the new live betting Predictions feature works on Kick — win.gg](https://win.gg/how-new-live-betting-predictions-feature-works-kick/)
- [KickEngineering/KickDevDocs Issue #20 — Websocket-based events](https://github.com/KickEngineering/KickDevDocs/issues/20)
- [KickEngineering/KickDevDocs Issue #141 — Enable Channel Points reward creation and redemption tracking via API](https://github.com/KickEngineering/KickDevDocs/issues/141)
- [cibere/kick.py — endpoints.json](https://github.com/cibere/kick.py/blob/main/endpoints.json) (lacks predictions; useful for negative result)

### Stage 2 (direct evidence)

- `assets.kick.com/main/_next/static/chunks/0ha56cz8ufind.js` — Pusher channel name + event binding
- `assets.kick.com/main/_next/static/chunks/00d8vh9mhsenj.js` — REST endpoints + Prediction shape + frontend components
- `assets.kick.com/main/_next/static/chunks/0qyk4p8r50i-a.js` — viewer + broadcaster UI components, `CHANNEL_POINTS_PREDICTION_TILE`, color tokens
- Captured via Playwright navigation to `kick.com/ramee` (channel suggested by the user) then direct download of the Next.js chunks listed in `document.scripts`. Bundle snapshot dates from `2026-05-22T11:34:06 GMT` (`Last-Modified` header).
