---
date: 2026-05-24
topic: settings-expansion-xtra-port
---

# Settings Expansion — Port Xtra's Chat + Player/Stream Settings

## Summary

Additively expand the existing Settings page with seven areas adapted from the Xtra Android Twitch client: a new **Chat** tab (plus a quick in-chat **gear**) wired into the live Twitch+Kick renderer, a **player control-button** visibility section, cross-platform live **buffer** tuning, a Twitch-only outbound **HTTP proxy** with **stream-token/codec** advanced controls, a **read-only API-token/session** panel, and **auto-check + frequency** on the existing Updates tab. Delivered in phases, Chat first.

---

## Problem Frame

StreamForge today exposes almost no user-facing configuration. The Settings page has six tabs but only three do anything substantive (default quality, ad-block toggle, prediction widget style); everything about how chat looks, how the player behaves, and how the stream is fetched is hardcoded. A viewer who finds the chat text too small, the emotes too noisy, or the player chrome too cluttered has no recourse. A power user who wants lower latency, wants to route stream requests through their own proxy, or wants to see whether their token is still valid has nothing.

Xtra — a mature open-source Twitch client already vendored in-repo at `reference/Xtra For-Twitch-Better-Functions-etc-master` — has spent years accumulating exactly these controls across eight preference screens. It is a proven menu of what stream-app users want to tune. The gap is that StreamForge has the rendering surfaces (a unified chat renderer, an HLS.js player for both platforms, an ad-block token pipeline, an electron-updater) but no settings layered on top of them, and the one preference type that does exist for chat (`ChatPreferences`) is defined but never read by the renderer.

---

## Actors

- A1. **Everyday viewer** — wants chat readable and the player uncluttered. Reaches for the in-chat gear (quick subset) and the Chat tab; rarely opens the advanced areas.
- A2. **Power user / tinkerer** — wants latency control, an outbound proxy, advanced stream-token behavior, and token diagnostics. The audience for buffer, proxy, playback-token, and the API-token panel.
- A3. **Electron main process** — the only place an outbound proxy / session change and the Twitch access-token request can actually be applied; the renderer cannot set these directly, so several requirements route through it.

---

## Key Flows

- F1. **Adjust chat appearance from the gear**
  - **Trigger:** Viewer opens the in-chat gear and changes font size / emote size / density / timestamps.
  - **Actors:** A1
  - **Steps:** Open gear → change a control → value writes to the global chat preferences → renderer re-applies to visible and incoming messages.
  - **Outcome:** Chat re-renders live; the same value is reflected if the viewer later opens the full Chat tab.
  - **Covered by:** R5, R10, R11, R12

- F2. **Toggle an emote provider**
  - **Trigger:** Viewer disables 7TV (or BTTV/FFZ) in the Chat tab.
  - **Actors:** A1
  - **Steps:** Toggle provider off → preference persists → emote system stops loading/rendering that provider on next channel load (or a prompted reload).
  - **Outcome:** That provider's emotes render as plain text; other providers unaffected.
  - **Covered by:** R7, R10

- F3. **Configure and enable a proxy** (Twitch)
  - **Trigger:** Power user enters proxy host/port (+ optional credentials) and selects which request classes to route.
  - **Actors:** A2, A3
  - **Steps:** Enter settings → enable → main process applies the proxy to the chosen Twitch stream/token requests on next stream load.
  - **Outcome:** Selected requests egress through the proxy; disabling restores direct requests.
  - **Covered by:** R19, R20, R21

- F4. **Validate the current token**
  - **Trigger:** Power user clicks "Validate now" in the API/Tokens panel.
  - **Actors:** A2, A3
  - **Steps:** Action re-checks the signed-in token against the platform → panel updates validity/expiry/scopes.
  - **Outcome:** Viewer sees whether the session is healthy; an expired/invalid result surfaces a reconnect affordance.
  - **Covered by:** R26, R27

---

## Requirements

**Foundation & integration**
- R1. Additive only. The existing Settings tabs (Playback, Ad-Block, Predictions, Integrations, Updates, About) and their current behavior remain unchanged. New settings appear as new sidebar sections, plus extensions to the existing Playback and Updates tabs.
- R2. All new settings persist through the existing preferences mechanism (`UserPreferences` → `preferences` IPC → storage), each as its own preference group so older installs hydrate with defaults under the shallow top-level merge.
- R3. Settings live-apply without an app restart wherever feasible. Any setting that cannot live-apply (e.g., buffer, proxy) states so in its row and applies on the next stream/chat (re)load.
- R4. Each new section is reachable from the Settings sidebar following the existing `SidebarItem` pattern and visual style (dark theme, storm-accent).

**Chat — full tab (applies to Twitch + Kick)**
- R5. A new "Chat" tab groups settings into Appearance, Emotes & badges, Messages & events, and Behavior.
- R6. Appearance settings per the table below.

  | Setting | Behavior on desktop | Default |
  |---|---|---|
  | Bold usernames | Render sender names in bold | Off |
  | Readable color for uncolored users | Assign a deterministic readable color to users with no chosen color | On |
  | Theme-adapted username color | Lift low-contrast username colors for the dark theme | On |
  | Timestamps + format | Show per-message time; format choice (e.g. `HH:MM`, `h:mm a`) | Off / `HH:MM` |
  | Font size | Message text size, px | 13 (range ~10–20) |
  | Emote size | Emote render height, px | 28 (range ~16–56) |
  | Message density | Line spacing/padding: Cozy vs Compact | Cozy |
  | Chat width | Width of the docked chat panel | App default |

- R7. Emotes & badges toggles (each On by default): enable 7TV / BTTV / FFZ (independently), animated emotes (play vs freeze), zero-width/overlay emotes, 7TV name paints, 7TV cosmetic badges, 7TV personal emotes, 7TV live cosmetic updates, system-message emotes.
- R8. Messages & events: message limit (default 500, range 50–1000, oldest pruned beyond it); recent-messages-on-join + its limit (default On / 100); show subscription/raid/user-notice lines; show polls; show predictions; show message-deletion + chat-clear notices; first-time-chatter highlight. (All On by default.)
- R9. Behavior: hide the chat panel entirely — maps to the existing `ChatPreferences.position: "hidden"` rather than a new flag. (Default Off.)
- R10. Chat settings apply to both platforms' messages. Display settings (size, timestamps, density, bold/colors) re-render live; emote-provider and event toggles may apply on the next channel load and must say so if not instant.

**Chat — in-chat gear (quick subset, global)**
- R11. The in-chat gear exposes a quick subset — font size, emote size, density, timestamps, show badges, message limit — editing the **same global values** as the Chat tab (no per-channel scope). The gear exists on both Twitch and Kick chat.
- R12. The gear includes a "More settings" affordance that opens the full Chat tab.

**Player control buttons (both platforms, where the control exists)**
- R13. A "Player controls" section toggles visibility of individual player buttons/overlays. The candidate set is the table below; planning confirms which already exist in our player and drops/marks any that don't.

  | Control / overlay | Default | Note |
  |---|---|---|
  | Quality selector | On | |
  | Playback speed (+ presets) | On | VOD-relevant; naturally absent on live |
  | Aspect-ratio toggle | On | |
  | Restart player | On | |
  | Seek to live | On | Live only |
  | Volume | On | |
  | Fullscreen | On | |
  | Chat toggle | On | |
  | Chat-input toggle | Off | |
  | Show channel / title / category | On | |
  | Show uptime | On | |
  | Show viewer count (+ icon) | On | |
  | Rewind / forward + amounts | On / 10s | Amounts configurable (R14) |
  | Audio-only mode | Off | If supported — else dropped in planning |
  | Subtitles / CC | Off | If supported — else dropped in planning |
  | Audio compressor | Off | If supported — else dropped in planning |

- R14. Rewind/forward seek amounts are configurable from a preset list of seconds.
- R15. Toggling a control off only hides its chrome; it does not disable the underlying capability (hiding Volume does not mute).

**Buffer (live, Twitch + Kick)**
- R16. A "Buffer" section exposes live latency-vs-stability controls mapped to HLS.js semantics — target live latency, forward buffer length, max buffer, and a low-latency-mode toggle. Applies to both live players (both run HLS.js).
- R17. A "reset to defaults" restores the app's tuned values; the player's current hardcoded buffer values become those defaults.
- R18. Buffer changes apply on the next stream load; the section states this.

**HTTP proxy (Twitch stream requests)**
- R19. A "Proxy" section configures an outbound HTTP/HTTPS proxy — host, port, optional username/password — plus toggles for which request classes route through it: playback access token, multivariant playlist, media playlist (mirroring Xtra's selective proxying).
- R20. The proxy is applied to the selected Twitch stream/token requests via the Electron main process (A3). Credentials are stored like other sensitive values and never logged.
- R21. Proxy is Off by default. Enabling with an empty host is a safe no-op (must not break stream requests).

**Playback / stream-token advanced (Twitch; reconciled with ad-block)**
- R22. Advanced stream-token controls — supported codecs, device-id (+ "randomize device-id"), player type, include-GQL-token, extra stream headers, skip-video-access-token — surface as advanced options associated with the existing Playback/Ad-Block area, not a standalone section, because they feed the same Twitch access-token request the ad-block (VAFT) system already manipulates.
- R23. These controls must not conflict with ad-block. Where the ad-block pipeline owns a token parameter, the advanced control either defers to it or is the single source of truth; planning resolves the exact ownership.
- R24. `hide_during_ads` is explicitly excluded (the app blocks ads).
- R25. Defaults match the app's current working token request. The group carries an "advanced — can break playback" framing.

**API / Tokens (read-only)**
- R26. An "API / Tokens" section shows, read-only: current Twitch (and Kick) signed-in user id + login, token presence/validity, expiry, and granted scopes. No editable client-IDs, redirects, or token-paste fields.
- R27. A "Validate now" action re-checks the current token against the platform (Twitch Helix `/validate`; Kick equivalent) and refreshes the displayed validity/expiry/scopes. An invalid/expired result surfaces the existing reconnect affordance.
- R28. Token values are never shown in full or logged — status, expiry, and scopes only.

**Updates (extend the existing tab)**
- R29. The existing Updates tab gains an "automatically check for updates" toggle and a check-frequency selector; the current check-now and pre-release controls stay.
- R30. The update source URL stays fixed (not user-editable).

---

## Acceptance Examples

- AE1. **Covers R6, R10.** Given chat is open with messages visible, when the viewer turns Timestamps on, then each visible and subsequent message shows the time in the chosen format without reconnecting.
- AE2. **Covers R7, R10.** Given 7TV emotes are rendering, when the viewer disables 7TV and reloads the channel, then former 7TV emotes render as plain text while BTTV/FFZ/native emotes still render.
- AE3. **Covers R8.** Given message limit = 500, when the 501st message arrives, then the oldest message is pruned so the buffer stays at 500.
- AE4. **Covers R11, R12.** Given the viewer changes font size in the in-chat gear, when they open the full Chat tab, then the tab shows the same font-size value (one global setting, two surfaces).
- AE5. **Covers R13, R15.** Given the Volume control is toggled off, when the player loads, then no volume button appears but audio still plays at the current volume.
- AE6. **Covers R19, R20, R21.** Given a valid proxy host/port with "media playlist" selected, when a Twitch stream loads, then media-playlist requests egress through the proxy; when the proxy is disabled, the same requests go direct.
- AE7. **Covers R27.** Given a token that has expired, when the viewer clicks "Validate now", then the panel shows the token as invalid/expired and offers reconnect — without exposing the token value.
- AE8. **Covers R29.** Given auto-check is on with frequency = daily, when the app runs, then it checks for updates at most once per day automatically, and the manual "check now" still works on demand.
- AE9. **Covers R16, R18.** Given the viewer lowers target live latency, when the current stream is still playing, then the section indicates the change applies on next load, and after reloading the stream the player tracks closer to the live edge.

---

## Success Criteria

- An everyday viewer can make chat readable (size, timestamps, density) and declutter the player from either the gear or the Chat tab, and the change is visible immediately or on the next obvious reload.
- A power user can tune live latency, route Twitch stream requests through their own proxy, and see at a glance whether their token is valid — without editing anything that can silently break auth.
- The existing Settings tabs and their behavior are untouched; every new setting persists across restarts and hydrates with a sensible default on older installs.
- `ce-plan` can produce a phased implementation plan from this doc without having to invent which settings exist, what they default to, which platform/surface they affect, or which are deferred.

---

## Scope Boundaries

- **Android-only items are dropped:** PiP/minimize, sleep timer (+picker/lock), device-admin, double-tap gestures, background-audio/PiP, keep-screen-on, audio-focus, handle-audio-becoming-noisy, move-player-freely, rounded-corner padding.
- **On-device chat translation is dropped** (Xtra uses Android ML Kit; no desktop equivalent in scope).
- **Raw Twitch protocol toggles are dropped:** chat WebSocket / SSL / PubSub — StreamForge uses its own Hermes/EventSub + Pusher transports.
- **Deferred (need backend the app doesn't have yet):** channel-points auto-collect / notify, raid auto-switch.
- **Locked down for safety:** editable Helix/GQL client-IDs, redirects, and paste-your-own-token fields (401 footgun — Client-Id must match the token's client_id); editable update URL.
- **Not part of this work:** Xtra's other preference screens (theme, UI, downloads, debug, player-menu ordering) — not requested.
- **Per-channel chat overrides** are out — chat settings are global only.
- **Kick proxy / Kick stream-token / Kick codecs** are out — those controls are Twitch-stream-specific. (Buffer is the one stream-side area that does apply to Kick.)

---

## Key Decisions

- **Chat settings are global, not per-channel.** Gear and tab edit the same values; avoids per-channel persistence and override-resolution complexity.
- **Chat appearance simplified to font-size + emote-size + density** (+ message limit) rather than Xtra's four separate size sliders (overall %, text, emote, badge). Lower cognitive load; the four-slider model can be revisited if users ask.
- **Buffer is one cross-platform live control.** Both players run HLS.js, so there's no reason to split Twitch/Kick; the current hardcoded HLS values become the exposed defaults.
- **Playback/stream-token "extras" fold into the existing Playback/Ad-Block area**, not a standalone group, because they feed the same Twitch access-token request the ad-block (VAFT) pipeline manipulates.
- **API tokens are read-only and the update URL is fixed** — both for the same safety reason (avoid breaking auth / update integrity).
- **Reuse existing infrastructure:** the preferences persistence chain (new top-level groups), the in-chat gear already present in chat, and electron-updater for auto-check.
- **Defaults are desktop-sensible, not Xtra's mobile numbers.**

---

## Dependencies / Assumptions

- `ChatPreferences` is currently defined but **not read by the renderer** (verified) — chat display settings require wiring into the chat renderer, which is real implementation work, not just a toggle.
- Both Twitch and Kick players use **HLS.js** (verified): the Twitch live player carries its own `Hls` config; Kick live + both VOD paths use a shared `HlsPlayer`. Buffer wiring touches both sites.
- The **ad-block / VAFT pipeline owns Twitch token parameters**; the advanced playback-token controls overlap it and need explicit reconciliation (R23).
- The **outbound proxy requires Electron main-process** session/agent plumbing; the renderer only collects + persists settings.
- Emote-provider enable/disable assumes the **emote manager** can load/unload per provider and trigger a re-render (or apply on next channel load).
- The **electron-updater** integration supports configurable auto-check + frequency.
- Quality gates are **tsc + vitest** (repo biome lint is baseline-red); git autocrlf converts LF→CRLF; tests use the better-sqlite3→node:sqlite vitest shim.

---

## Outstanding Questions

### Resolve Before Planning

- (none — the scope forks were resolved in dialogue.)

### Deferred to Planning

- [Affects R16, R17][Technical] Exact HLS.js parameter mapping (target live latency / forward buffer / max buffer / low-latency) and confirming both the Twitch custom-config site and the shared `HlsPlayer` consume the new buffer settings.
- [Affects R22, R23][Technical] Precise ad-block/VAFT ↔ advanced-token-control ownership: which token params ad-block already sets, and how user overrides layer on without breaking ad-block.
- [Affects R7, R10][Technical] Emote-manager changes needed for per-provider enable/disable and live (or next-load) re-render.
- [Affects R26, R27][Needs research] Kick token-validation endpoint equivalent for the read-only token panel (Twitch Helix `/validate` is known).
- [Affects R11, R12][Technical] Whether the existing in-chat gear is reused as-is for the quick subset and added to Kick chat.
- [Affects R13][Technical] Which candidate player controls actually exist in the current player components (confirm/drop audio-only, subtitles, audio compressor).
- [Affects R29][Technical] electron-updater auto-check scheduling + frequency persistence mechanism.
