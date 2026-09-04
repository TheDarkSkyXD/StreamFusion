# Proxy-source architecture cross-judge

## Rubric

The design must deliver Xtra-style ordered playlist sources, per-source status, playlist failure fallback, and a hard replacement boundary that disables every custom Twitch ad-block behavior. It must retain existing capability unless removal earns its cost. It must work for the page player, mini-player, multistream slots, and the direct featured-stream HLS preview.

## Scores

| Criterion | Candidate A | Candidate B | Judgment |
| --- | ---: | ---: | --- |
| Exact user outcome | 4 | 5 | B explicitly keeps source health ephemeral, parses `/ping` in a main-owned boundary, and separates replacement routing from transport proxying. A meets playlist behavior but leaves the probe boundary vague. |
| Interface depth and reader load | 4 | 4 | A gives the player a deep request object. B gives call sites one playback hook and confines URL and retry policy to a pure planner. B needs a smaller private cursor API. |
| Migration safety and capability preservation | 2 | 5 | A deletes the credentialed session-wide HTTP proxy and encrypted credentials. B preserves them as an advanced transport feature. |
| Runtime fallback across every Twitch caller | 5 | 3 | A makes a mandatory player request and gives each mounted HLS instance a cursor. B states the intended route behavior but does not yet make all callers, especially the direct featured preview, use its hook. |
| Verification feasibility and diff size | 2 | 4 | A replaces the player interface and removes established main-process features in one wave. B adds one durable preference group and narrow probe IPC while retaining current transport code. |

## Red flags

### Candidate A

- It removes the existing manual HTTP proxy, credential store, IPC, and startup behavior. The grounding permits removal, but this loses a working user capability without showing that playlist sources replace its session-wide transport use cases.
- `useTwitchProxySettings` owns probing. That leaves the external `/ping` request and untrusted JSON boundary vague. The requirement says UI only renders and collects intentions.
- `TwitchPlaybackRequest.resolveDirect` exposes a function-valued acquisition policy through player props. It is workable, but wider than needed if the playback hook can own lazy direct resolution.
- The diff touches storage migration, main startup, IPC, preload, settings, every Twitch player caller, and deletion of proxy tests. That is too much blast radius for the first delivery.

### Candidate B

- `TwitchLiveRouteCursor` should stay private to the route planner or hook. Exporting it leaks retry bookkeeping without helping UI or player callers.
- `onPlaylistHttpFailure` is a necessary player-to-routing signal, but it needs a tight contract. It must fire only for a terminal playlist HTTP failure from the current source attempt, once per HLS instance, after teardown. It must not turn media, decode, abort, or custom-ad-block errors into source advancement.
- The candidate says `TwitchLivePlayer` uses the playback hook, while its example passes the hook result directly to `TwitchHlsPlayer`. That ownership ambiguity risks missing the visible live-player surfaces. The hook must feed both `TwitchLivePlayer` and the direct featured-stream preview, or the player wrapper must become the single adoption point.
- `enableCustomAdBlock: false` suppresses loader installation. It does not alone clear an already visible parent ad presentation cover. `TwitchHlsPlayer.clearPresentationShield()` restores video opacity and audio but does not call the parent `onVerifiedCleanAdPresentation` callback. Mode changes must clear the canvas, poster, and placeholder cover directly in `TwitchLivePlayer`.

## Pick

Use Candidate B as the base.

It delivers the required Xtra playlist-source list without conflating it with StreamFusion's existing session-wide authenticated HTTP proxy. That preserves a real capability and keeps the new source list focused on per-stream playlist routing. Its main-owned status service gives `/ping` parsing one trusted boundary and its source-list preference can migrate without deleting unrelated transport state.

## Grafts into Candidate B

1. Take Candidate A's per-player attempt ownership. Keep the cursor private inside `useTwitchLivePlayback`, reset it on manual reload, channel change, and source-list revision change, and never let one multistream slot advance another.
2. Take Candidate A's exact fallback rules. Advance only after a terminal playlist HTTP failure, try each enabled source once in array order, resolve direct Twitch lazily only at the final attempt, and keep replacement mode active after direct fallback.
3. Take Candidate A's pure URL detail. One resolver adds a missing HTTPS scheme, substitutes the encoded `$channel`, and adds the three Xtra parameters idempotently when requested. One ping builder replaces the path with `/ping` and clears query and hash.
4. Make Candidate B's playback mode explicit at the player boundary. Use a discriminated route whose direct-fallback variant retains `customAdBlock: false`. Do not derive this from separate proxy and ad-block booleans in each caller.
5. Make custom-ad-block suppression immediate. In replacement mode, stop the DOM observer, pass no ad-block status to controls, hide the top-left live-region label, and synchronously hide any existing presentation canvas, poster, or placeholder. The disabled HLS branch must also publish an inactive status.
6. Apply the hook to every Twitch path. This includes `TwitchLivePlayer` users on Stream, mini-player, and multistream, plus the direct `TwitchHlsPlayer` in `FeaturedStreamPreviewPlayer`.

## Rejections

- Reject Candidate A's removal of `ProxyPreferences`, `stream-proxy-service.ts`, proxy IPC, preload methods, and encrypted credentials. Keep those under an Advanced transport section with their existing semantics.
- Reject Candidate A's public `TwitchPlaybackRequest` with `resolveDirect`. Keep lazy resolution inside Candidate B's playback hook.
- Reject Candidate B's exported cursor and ambiguous dual ownership between `TwitchLivePlayer` and `TwitchHlsPlayer`. The hook owns route state. The HLS engine owns reporting the narrow failure event.

## Verification plan

- Pure tests cover source ordering, disabled sources, URL resolution, `/ping`, the `online: false` compatibility case, and final direct fallback.
- Settings tests cover seeded sources, ordered editing, source enablement, deletion without reseeding, checking, online, offline, and stale probe results.
- Player tests prove source-list mode installs no custom loaders and renders no `Blocking ads` label, shield control, status tooltip, DOM observer behavior, or presentation cover. Cover the transition while a custom cover is already present.
- Playback tests cover source advancement only for playlist HTTP failures, direct fallback after every source, reload and revision reset, and independent cursors in two concurrent players.
- Keep and run existing stream-proxy service and IPC tests. Add a targeted Electron test only if the status service's selected session needs proof of proxy egress.

## Verification result

Read the grounding, both candidates, and the design red-flag rubric end to end. The verdict makes no production changes. Candidate B is the base with the listed Candidate A grafts.
