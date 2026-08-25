# Electron performance audit — 2026-08-25

## Outcome

StreamFusion is materially faster and leaner on the measured paths. The final unpackaged production build settled at **616–638 MB across five Electron processes**, **0–1% sampled CPU**, and a **40 MB renderer JavaScript heap** while Home was actively autoplaying a muted 640×360 preview and live chat. Home frame pacing was **16.666 ms average / 16.8 ms p95 and maximum**, with **0 of 119 frames above 20 ms**.

The last fresh development proof also closes the largest remaining retention defect. Home's read-only Kick chat no longer owns the hidden authenticated send renderer. Five consecutive create/use/reap cycles returned from as many as five Kick targets and workers to exactly one StreamFusion target every time. After the fifth cycle, Home video and live chat were still healthy, the renderer heap was 70.1 MB, Diagnostics sampled 0.4% CPU, and no helper process accumulated.

A final continuation pass removed the remaining cold-start helper entirely. Existing Kick account rows now hydrate from persisted local state; Kick's browser-capable account reconciliation runs after login, on manual sync, or on the scheduled refresh instead of every renderer startup. After a Twitch Home → Kick stream → Diagnostics cycle, closing the mini-player left **five processes, 878.8 MB development RSS, 0.5% CPU, and a 70.0 MB renderer heap**. The previous equivalent development state was about **1.08 GB** and included a Video Capture utility spawned by Kick's full webpage runtime. The final restart had no Video Capture process, no Kick website runtime, Home autoplayed at 1280×720, and the inspected application log contained no error-level entries.

This is not a claim that every network response finishes in 50 ms or that every machine will hold 60 FPS. The renderer can respond inside one frame; Twitch/Kick/CDN latency remains external. A sub-500 MB total is also incompatible with the measured Windows Electron floor plus required autoplay: the no-video multi-process floor was about 449 MB, and starting Chromium video decoding adds GPU/audio/media working sets. Disabling GPU acceleration could lower one number while directly harming the 60 FPS goal, so it was rejected.

## Before and after

| Surface | Before | After |
| --- | ---: | ---: |
| Hidden Kick helper retention, fresh dev | 1,804 MB / 10 processes; hidden page plus two IVS workers persisted for about four minutes | Five forced helper cycles each returned to one StreamFusion target; early post-reap samples were 967–1,009 MB / 6 processes |
| Diagnostics Resources, fresh dev | Raw one-second history was cloned over IPC on every sample; the renderer grew about 34 MB/min and the run later reached 1,931 MB | Full backend sampling retained; renderer transport capped at 120 points and published every 5 seconds; final four-minute sample was 900.5 MB total / 241.5 MB renderer / 57.1 MB JS heap / 0.2% CPU |
| Clean production Home | Earlier retained-helper runs reached 2.00 GB | 616–638 MB / 5 processes with autoplay and live chat |
| Home preview at source quality | 927–972 MB | 616–638 MB at 360p, about 300 MB lower in like-for-like preview runs |
| Categories | 181 images / 2,451 DOM nodes / ~963 MB renderer | 26 images / 446 DOM nodes in production |
| Categories frame pacing | Not bounded | 16.669 ms average, 16.8 ms p95, 17.0 ms max, 0 frames over 20 ms |
| Search interaction | Slow full-provider/fallback fan-out | 13.6 ms route/UI feedback; ~420.7 ms observed network-populated results |
| Stream navigation | Slow eager player/chat/content work | 26.9 ms route feedback in the final production run; player/chat/content load independently |
| Home read-only chat | Composer and transport churn could remain | Live chat visible; 0 composer fields on Home |
| Restart behavior | Rapid restarts could trigger Kick 429 and fallback amplification | Three rapid restarts plus the final clean restart produced no HTTP 429; active cooldowns now stop fallback work |
| Cold-start Kick follow reconciliation, dev | Hidden Kick website loaded DataZoom/IVS/WebRTC and retained a Video Capture utility; post-navigation idle was about 1.08 GB | Persisted follows hydrate without the website fallback; 5-process post-navigation idle measured 878.8 MB / 0.5% CPU |

## Bottlenecks fixed

- Hidden Kick browser helpers retained renderers, workers, and third-party frames. Operation ownership, generation-safe idle disposal, sender-scoped composer leases, and persisted request continuity now bound their lifetime and protect real Kick quotas across restarts. Read-only receive chat never acquires a send-window lease; a visible authenticated composer does. Reload, renderer crash, and destruction release all leases owned by that renderer.
- Kick cooldown errors used to enter legacy channel lookup and metadata-repair fallbacks, creating extra work precisely when the real provider quota was exhausted. One shared typed rate-limit classifier now stops fallback amplification, preserves the provider's real cooldown, and keeps expected cooldown logs at debug level.
- Kick stream-detail status polling used to wake every ten seconds during the persisted cooldown, repeatedly throwing local guard errors even though the guard correctly blocked the wire. IPC now returns typed retry metadata and the renderer pauses that query until the real cooldown expires.
- Connected Kick accounts used to invoke the browser-capable follow sync on every renderer startup. Startup now trusts persisted rows and reserves that expensive fallback for login, explicit manual sync, or the main-process refresh schedule. Twitch's lightweight startup sync remains unchanged.
- Home fetched too many cross-platform streams and decoded the featured preview at source resolution. The merged result is globally capped and the hero preview requests 360p; full stream pages retain the user-selected quality.
- Home autoplay and chat used separate carousel ownership. One stage now owns selection, media, and read-only chat identity. An unavailable featured stream is skipped once to the next viable candidate instead of retrying the same dead manifest forever.
- Twitch child playlists can legitimately take more than six seconds. Initial playback now uses a 10/16/22-second bounded recovery ladder; established playback and explicit network failures retain the fast 2.5/5.5/7.5-second ladder. A measured 6.467-second playlist recovered without false-fatal teardown.
- Offline Twitch master manifests (404/410) were logged as application errors. They are now classified as an informational unavailable-live condition and drive bounded carousel skip behavior.
- Search, Categories, page dialogs, chat transports, platform handlers, diagnostics, player variants, and other optional features loaded too early or rendered unbounded lists. Query/provider work is collapsed and rate-aware, lists are bounded/virtualized, and optional code is split behind the route or interaction that needs it.
- Signed-out Twitch emotes made guaranteed failing Helix requests, and FFZ's valid `replaces: null` payload failed schema parsing. Signed-out providers are disabled and nullable FFZ fields are normalized.
- Optional FFZ timeouts no longer masquerade as application failures. Provider outages remain visible as warnings while first-party chat and the other emote providers continue normally.
- Chat teardown could disconnect Twitch before the final owner released it. Reference ownership now disconnects once on the final release, so Home-to-stream chat transitions do not churn the transport.
- Diagnostics sampled native processes every second but also cloned the entire growing raw history over IPC and replaced the full React snapshot every second. The backend still retains and samples the full statistical window, while renderer transport is compacted to at most 120 points and published every five seconds. Manual refreshes remain immediate.
- Desktop package start bypassed static validation. `npm start` now runs desktop typecheck and lint before opening the start picker; direct automation scripts stay direct so proofs and CI do not run the same gates twice.

## Long-run resource evidence

The Diagnostics Resources tab is the canonical source. A clean final Home session reported 616–638 MB and 0–1% CPU with active autoplay/chat. Thirteen forced Home → Diagnostics media teardown/remount cycles rose to a Chromium native-media working-set plateau of 1,054 MB, then fell to 1,019 MB after 20 seconds. At that point there were **0 video elements, 444 DOM nodes, and a 33 MB JS heap**. On an already-saturated instance, eight additional cycles reduced renderer+GPU working set from 779.8 MB to 762.4 MB.

The helper-retention development run started at 123 MB / one process and transiently peaked at 1,349 MB / seven processes while startup follow reconciliation used the authenticated helper. Early post-reap samples were 967–1,009 MB / six processes, versus the old 1,804 MB / ten-process peak. That is about a 25% reduction in transient peak memory and three fewer peak processes. After manually selecting a Kick stream, five explicit helper warm/reap cycles produced target counts of `5→1`, `5→1`, `2→1`, `2→1`, and `5→1`. Diagnostics immediately after the stress run reported 1.09 GB, 0.4% CPU, six processes, and a 72.4 MB JS heap.

The same log later exposed a separate Diagnostics-view problem: total development RSS continued rising to 1,931 MB even though the process count stayed at six. A controlled reproduction isolated the climb to the renderer while Resources was visible. Before the fix it grew from 242.9 MB to 349.2 MB in about four minutes. After bounded transport and five-second publishing, the same view stayed between 225.1 MB and 241.5 MB over the measured four-minute window; total memory ended at 900.5 MB and the JS heap ended at 57.1 MB. These short samples did not show an unbounded JavaScript heap after the fix. They do not replace a multi-day soak; a release gate should still fail on sustained growth in process count, working set/private bytes, CPU, long frames, or platform request cadence.

The final fresh checked restart improved that development floor again. With Home autoplay and chat healthy, Electron used five processes. After opening a Kick stream, waiting for 1920×1080 playback and live chat, navigating to Diagnostics, and explicitly closing the mini-player, Resources reported 878.8 MB, 0.5% CPU, five processes, and a 70.0 MB renderer heap. The process tree contained only main, renderer, GPU, network, and audio; the prior Kick-startup Video Capture utility was absent.

## Page and playback proof

- Final Home: one video, ready state 4, autoplaying, muted, 640×360; live chat present; only the global search input and no chat composer.
- Final Kick Home proof: `ensureSendWindowReady()` created the authenticated helper, then the helper page and its workers disappeared after 6.5 seconds while read-only chat stayed live. Repeating this five times did not add processes, break autoplay, or disconnect chat.
- Stream page: route shell in 26.9 ms; live chat and stream content visible; signed-out state correctly shows `Log in to chat`; video reached ready state 4 and autoplayed. One slow Twitch media sample took 10.6 seconds, which was CDN time rather than renderer blocking.
- Categories: bounded DOM/image count and a full foreground 60 FPS sample.
- Search: same-route UI response in 13.6 ms; provider results populated in about 420.7 ms while respecting platform rate limits and avoiding obsolete fallback fan-out.
- Repeated restart: no Kick 429 or new `KickRateLimitError` in the inspected main, network, Chromium, or noise logs. A real 429 is still honored rather than hidden; the app now waits for its cooldown instead of multiplying requests through legacy fallbacks.
- Clean final log: no application errors. Optional FFZ network timeouts are warning-level degradation, not false application errors. The raw preview emitted Electron's expected development-only warnings; Electron notes these do not appear once packaged.

## Lazy-loading evidence

The production output keeps optional features split instead of placing them all in startup code. Examples include Twitch chat (73.21 kB), Kick chat (32.58 kB), their transport/vendor chunks, Twitch HLS (44.10 kB), Kick live player (10.99 kB), diagnostics (44.38 kB), settings chat UI (37.62 kB), mini-player (13.49 kB), and related content (14.51 kB). Main-process IPC feature logs also show handlers loading on demand as the corresponding surface is used.

The remaining build warning says `chat-store.ts` is both statically and dynamically imported. Chat is a Home startup requirement, so forcing that shared store into a separate lazy chunk would not improve this startup path and could increase indirection.

## Verification

- Root dependency policy and lockfile release-age lint: pass.
- Desktop ESLint: pass.
- Desktop and worker TypeScript checks: pass.
- Production Electron Vite build: pass (873 main modules, 2,471 renderer modules).
- Focused regression suites: pass, including player startup recovery, featured-stream skip/360p behavior, network logging, query concurrency, restart rate limiting, chat ownership, emotes, and read-only Home chat.
- Full suite: 592 desktop files / 7,107 desktop tests plus 1 worker file / 15 worker tests, all passing on the final rerun.
- Real Electron production-output proof: pass on Home, stream, Categories, Search, Diagnostics Resources, route cycling, restart continuity, and log inspection.
- Fresh checked development proof: pass on Home autoplay, Kick read-only chat, sender-scoped helper disposal, five helper stress cycles, cooldown logging, and Diagnostics Resources.
- Final checked restart: pass on pre-launch typecheck/lint, 1280×720 Home autoplay, absence of Kick's startup browser/Video Capture runtime, 1920×1080 Kick stream playback, live chat, five-process Diagnostics state, and zero application error-level log entries.
- Explicit TypeScript `any` audit: no explicit `any` in the changed production paths. Tests retain normal `expect.any(...)` matchers.
- React Doctor broad branch audit: 68/100 with 62 findings, largely pre-existing Zod/effect/ref debt outside these focused changes; it did not flag the new composer-retention effect. This is recorded rather than misrepresented as a clean whole-repository React audit.
- React Doctor final changed-code audit: 11 changed React/TypeScript files scanned, no issues found.

## Research applied

The changes follow the official Electron guidance to measure first, defer expensive setup until it is needed, avoid blocking main/renderer work, remove unnecessary network requests, and bundle code. The supplied Oflight guide independently emphasizes lazy loading, bounded DOM virtualization, cleanup, caching, and stopping unused background work; those recommendations map directly to the route chunks, bounded grids, helper reaper, and rate-aware caches measured here. The Brainhub case study is relevant to CPU-heavy native computation, but StreamFusion's measured bottleneck was retained Chromium/media processes and provider latency, so a Rust rewrite would have added complexity without addressing the observed cause. Electron also documents the Chromium-derived multi-process model, which explains why total resident memory is the sum of main, renderer, GPU, network, and audio processes rather than a single JavaScript heap.

- [Electron performance guide](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron process memory API](https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo)
- [Oflight Electron performance guide](https://www.oflight.co.jp/en/columns/electron-performance-optimization)
- [Brainhub Electron performance case study](https://brainhub.eu/library/electron-app-performance)

## Evidence files

- `artifacts/performance-baseline-resources.png`
- `artifacts/performance-after-helper-dispose-resources.png`
- `artifacts/performance-postfix-idle-resources.png`
- `artifacts/performance-postfix-resources.png`
- `artifacts/performance-baseline-renderer.png`
- `.audit/send-window-performance-design.md`
- `.audit/send-window-retention-candidate-a.md`
- `.audit/send-window-retention-candidate-b.md`
- `.audit/send-window-retention-judge.md`
