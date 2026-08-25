# Electron performance audit — 2026-08-25

## Outcome

StreamFusion is materially faster and leaner on the measured paths. The final unpackaged production build settled at **616–638 MB across five Electron processes**, **0–1% sampled CPU**, and a **40 MB renderer JavaScript heap** while Home was actively autoplaying a muted 640×360 preview and live chat. Home frame pacing was **16.666 ms average / 16.8 ms p95 and maximum**, with **0 of 119 frames above 20 ms**.

This is not a claim that every network response finishes in 50 ms or that every machine will hold 60 FPS. The renderer can respond inside one frame; Twitch/Kick/CDN latency remains external. A sub-500 MB total is also incompatible with the measured Windows Electron floor plus required autoplay: the no-video multi-process floor was about 449 MB, and starting Chromium video decoding adds GPU/audio/media working sets. Disabling GPU acceleration could lower one number while directly harming the 60 FPS goal, so it was rejected.

## Before and after

| Surface | Before | After |
| --- | ---: | ---: |
| Worst retained Kick helper session | 2.00 GB / 10 processes | 616–638 MB / 5 processes on clean production Home |
| Home preview at source quality | 927–972 MB | 616–638 MB at 360p, about 300 MB lower in like-for-like preview runs |
| Categories | 181 images / 2,451 DOM nodes / ~963 MB renderer | 26 images / 446 DOM nodes in production |
| Categories frame pacing | Not bounded | 16.669 ms average, 16.8 ms p95, 17.0 ms max, 0 frames over 20 ms |
| Search interaction | Slow full-provider/fallback fan-out | 13.6 ms route/UI feedback; ~420.7 ms observed network-populated results |
| Stream navigation | Slow eager player/chat/content work | 26.9 ms route feedback in the final production run; player/chat/content load independently |
| Home read-only chat | Composer and transport churn could remain | Live chat visible; 0 composer fields on Home |
| Restart behavior | Rapid restarts could trigger Kick 429 | Three rapid restarts plus the final clean restart produced no HTTP 429 |

## Bottlenecks fixed

- Hidden Kick browser helpers retained renderers, workers, and third-party frames. Operation ownership, generation-safe idle disposal, chat-aware retention, and persisted request continuity now bound their lifetime and protect real Kick quotas across restarts.
- Home fetched too many cross-platform streams and decoded the featured preview at source resolution. The merged result is globally capped and the hero preview requests 360p; full stream pages retain the user-selected quality.
- Home autoplay and chat used separate carousel ownership. One stage now owns selection, media, and read-only chat identity. An unavailable featured stream is skipped once to the next viable candidate instead of retrying the same dead manifest forever.
- Twitch child playlists can legitimately take more than six seconds. Initial playback now uses a 10/16/22-second bounded recovery ladder; established playback and explicit network failures retain the fast 2.5/5.5/7.5-second ladder. A measured 6.467-second playlist recovered without false-fatal teardown.
- Offline Twitch master manifests (404/410) were logged as application errors. They are now classified as an informational unavailable-live condition and drive bounded carousel skip behavior.
- Search, Categories, page dialogs, chat transports, platform handlers, diagnostics, player variants, and other optional features loaded too early or rendered unbounded lists. Query/provider work is collapsed and rate-aware, lists are bounded/virtualized, and optional code is split behind the route or interaction that needs it.
- Signed-out Twitch emotes made guaranteed failing Helix requests, and FFZ's valid `replaces: null` payload failed schema parsing. Signed-out providers are disabled and nullable FFZ fields are normalized.
- Chat teardown could disconnect Twitch before the final owner released it. Reference ownership now disconnects once on the final release, so Home-to-stream chat transitions do not churn the transport.
- Root start bypassed static validation. `pnpm start` now runs desktop typecheck and lint before opening the start picker.

## Long-run resource evidence

The Diagnostics Resources tab is the canonical source. A clean final Home session reported 616–638 MB and 0–1% CPU with active autoplay/chat. Thirteen forced Home → Diagnostics media teardown/remount cycles rose to a Chromium native-media working-set plateau of 1,054 MB, then fell to 1,019 MB after 20 seconds. At that point there were **0 video elements, 444 DOM nodes, and a 33 MB JS heap**. On an already-saturated instance, eight additional cycles reduced renderer+GPU working set from 779.8 MB to 762.4 MB.

That evidence rules out an unbounded React/JavaScript heap leak in this stress case; Chromium retains reclaimable decoder/GPU allocator capacity after repeated media construction. It does not replace a multi-day soak. A release gate should still sample process count, per-process working set/private bytes, CPU, long frames, and platform request cadence at fixed intervals and fail on a sustained upward trend.

## Page and playback proof

- Final Home: one video, ready state 4, autoplaying, muted, 640×360; live chat present; no input/composer.
- Stream page: route shell in 26.9 ms; live chat and stream content visible; signed-out state correctly shows `Log in to chat`; video reached ready state 4 and autoplayed. One slow Twitch media sample took 10.6 seconds, which was CDN time rather than renderer blocking.
- Categories: bounded DOM/image count and a full foreground 60 FPS sample.
- Search: same-route UI response in 13.6 ms; provider results populated in about 420.7 ms while respecting platform rate limits and avoiding obsolete fallback fan-out.
- Repeated restart: no Kick 429 in the inspected main, network, Chromium, or noise logs.
- Clean final log: no application errors. The raw preview emitted Electron's two expected disabled-web-security warnings; Electron notes these do not appear once packaged.

## Lazy-loading evidence

The production output keeps optional features split instead of placing them all in startup code. Examples include Twitch chat (73.21 kB), Kick chat (32.47 kB), their transport/vendor chunks, Twitch HLS (44.10 kB), Kick live player (10.99 kB), diagnostics (44.38 kB), settings chat UI (37.62 kB), mini-player (13.49 kB), and related content (14.51 kB). Main-process IPC feature logs also show handlers loading on demand as the corresponding surface is used.

The remaining build warning says `chat-store.ts` is both statically and dynamically imported. Chat is a Home startup requirement, so forcing that shared store into a separate lazy chunk would not improve this startup path and could increase indirection.

## Verification

- Root dependency policy and lockfile release-age lint: pass.
- Desktop ESLint: pass.
- Desktop and worker TypeScript checks: pass.
- Production Electron Vite build: pass (873 main modules, 2,471 renderer modules).
- Focused regression suites: pass, including player startup recovery, featured-stream skip/360p behavior, network logging, query concurrency, restart rate limiting, chat ownership, emotes, and read-only Home chat.
- Full suite: 7,094 desktop tests plus 15 worker tests, all passing on the final rerun.
- Real Electron production-output proof: pass on Home, stream, Categories, Search, Diagnostics Resources, route cycling, restart continuity, and log inspection.

## Research applied

The changes follow the official Electron guidance to measure first, defer expensive setup until it is needed, avoid blocking main/renderer work, remove unnecessary network requests, and bundle code. Electron also documents the Chromium-derived multi-process model, which explains why total resident memory is the sum of main, renderer, GPU, network, and audio processes rather than a single JavaScript heap.

- [Electron performance guide](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron process memory API](https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo)

## Evidence files

- `artifacts/performance-baseline-resources.png`
- `artifacts/performance-after-helper-dispose-resources.png`
- `artifacts/performance-postfix-idle-resources.png`
- `artifacts/performance-postfix-resources.png`
- `artifacts/performance-baseline-renderer.png`
- `.audit/send-window-performance-design.md`
- `.logs/streamfusion-2026-08-25T08-12-27-823Z.log`
