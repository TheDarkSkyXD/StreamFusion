# StreamFusion — Competitive Research

Research date: 2026-05-13. Scope: open-source projects on GitHub (and a few notable web tools) that overlap with StreamFusion's positioning as a **unified, cross-platform desktop app for watching Twitch + Kick live streams with integrated chat**.

## TL;DR

- **No mature, well-maintained Electron-based desktop app that unifies Twitch + Kick video viewing exists today.** StreamFusion's niche on the desktop is genuinely uncrowded.
- The closest *desktop* competitors are either **Twitch-only** (streamlink-twitch-gui, Chatterino2, Chatty, Orion) or **chat-only** multi-platform aggregators (AxelChat, UniChat). None bundle unified video + chat + ad-block + persistence in one Electron app.
- The closest *functional* competitors are **web-based multi-stream viewers** (multistream.me, multitwitch.tv, stream-sync.com, multistream.watch). They are mature, free, and zero-install — but trade away native performance, Twitch ad-block, local persistence, and integrated chat.
- A wave of **early-stage Tauri/React clones** appeared in late 2025 / early 2026 (UniChat, ilanzgx/multistream, StremGrid, MultiStreamZ, V-Streaming). Most have ≤4 stars. They validate the demand but pose no immediate threat.

## 1. Direct competitors — unified Twitch + Kick viewers

| Project | Stars | Form | Stack | Platforms | Notes |
| --- | --- | --- | --- | --- | --- |
| [multistream-viewer (pjmagee)](https://github.com/pjmagee/multi-stream-viewer) | 4 | Web (PWA) | Blazor WASM + FluentUI | Twitch, Kick, YouTube | Grid/stack/horizontal layouts; integrated chat; URL sharing. Hosted on GitHub Pages. MIT. |
| [ilanzgx/multistream](https://github.com/ilanzgx/multistream) | 4 | **Desktop** | Tauri + Vue + Vite | Twitch, Kick, YouTube | Lightweight desktop multistream viewer with integrated real-time chat. Closest stack analogue to StreamFusion. |
| [MultiStreamZ (obrunuaf)](https://github.com/obrunuaf/MultiStreamZ) | 0 | Web | React + Vite + TS | Twitch, Kick | Resizable grid. Deployed on Vercel. |
| [StremGrid (ALEXFSX)](https://github.com/ALEXFSX/StremGrid) | 0 | Web | React + Vite + TS | Twitch, Kick, YouTube | Synchronized audio control, customizable grid, live detection. |
| [TKMultiviewer (timswhatever)](https://github.com/timswhatever/TKMultiviewer) | 0 | Web | CSS/HTML | Twitch, Kick | "(Almost) unlimited" streams simultaneously. |
| [MultiStream-Viewer (Floree1)](https://github.com/Floree1/MultiStream-Viewer) | 0 | Web | HTML/JS | Twitch, Kick | Customizable layouts. Spanish-language project. |
| [GhostViewer (ghostmade)](https://github.com/ghostmade/GhostViewer) | 0 | JS app | JavaScript | Twitch, Kick | "Privacy-first viewer." Very new (May 2026). |
| [panoptic-live/panoptic](https://github.com/panoptic-live/panoptic) | 0 | Closed-source app (this repo is just issues) | n/a | Twitch, Kick, YouTube, TikTok, video, IRL, sports | Wide-net multi-platform viewer; only the issue tracker is public. |
| [naakir/twitch-multistream-viewer](https://github.com/naakir/twitch-multistream-viewer) | 0 | Web | JS | Twitch only | Up to 8 streams. Mentioned for completeness — no Kick. |

**Read:** StreamFusion is essentially the only project in this list with serious engineering investment (monorepo, tRPC IPC, SQLite persistence, HLS player tuning, Twitch ad-block). The web entries lack native performance/ad-block; the desktop entries are toy-stage.

## 2. Unified-chat aggregators (overlap on the chat-integration feature)

| Project | Stars | Stack | Platforms | Video? | Notes |
| --- | --- | --- | --- | --- | --- |
| [AxelChat](https://github.com/3dproger/AxelChat) | 274 | Qt + React widgets | Twitch, YouTube, Kick, TikTok, Discord, Telegram, Rumble, Trovo, 40+ more | No | Most mature multi-platform chat aggregator. Core is proprietary; widgets are OSS. Streamer-side, not viewer-side. |
| [UniChat (rusnakdima)](https://github.com/rusnakdima/UniChat) | 1 | Tauri + Angular + Rust | Twitch, Kick, YouTube | No | Mixed/split feeds, overlay widgets, OAuth refresh. MIT. New (Mar 2026). |
| [Kickflip (prsek)](https://github.com/prsek/Kickflip) | 0 | n/a | Kick only | No | Standalone Kick chat client à la Chatterino. Stub project. |

**Read:** These compete only on chat — StreamFusion does chat *and* video in one app, which is its main differentiator vs. AxelChat (the only one with real traction).

## 3. Twitch-only desktop alternatives (no Kick)

| Project | Stars | Stack | Notes |
| --- | --- | --- | --- |
| [streamlink/streamlink-twitch-gui](https://github.com/streamlink/streamlink-twitch-gui) | **2,849** | NW.js + EmberJS | The incumbent. Multi-stream browse + launch via Streamlink/external player. No in-app chat rendering; uses external chat app. No Kick. Stack is aging. |
| [Chatterino2](https://github.com/Chatterino/chatterino2) | **2,470** | C++ / Qt | De facto Twitch chat client. Chat only. Plugin ecosystem. No video, no Kick. |
| [chatty/chatty](https://github.com/chatty/chatty) | 891 | Java/Swing | Twitch chat client with stream-monitoring features. No video, no Kick. |
| [alamminsalo/orion](https://github.com/alamminsalo/orion) | 315 | C++ / Qt / mpv | **Archived** cross-platform Twitch client. Closest historical analogue to StreamFusion's UX. Abandoned — signals opportunity. |
| [vaverix-twitch-bot](https://github.com/vaverix/vaverix-twitch-bot) | 8 | Electron + Vue | Multi-channel Twitch chat. Niche. |

**Read:** The two giants in this category (streamlink-twitch-gui, Chatterino2) are *Twitch-only* and *don't combine video + chat in one polished app*. StreamFusion's positioning is meaningfully different — combine, don't fragment.

## 4. Twitch ad-block tools (overlap on one StreamFusion feature)

StreamFusion bundles Twitch ad-block as one feature. Standalone ad-block projects:

| Project | Stars | Form | Notes |
| --- | --- | --- | --- |
| [ttv-ublock](https://github.com/odensc/ttv-ublock) | 891 | uBlock extension | **Archived**. Was the most popular. |
| [Purple-adblock](https://github.com/arthurbolsoni/Purple-adblock) | 499 | Browser extension | Active; server-side signature approach. |
| [Twitch-HLS-AdBlock](https://github.com/instance01/Twitch-HLS-AdBlock) | 269 | Browser extension | HLS-level interception. |
| [streamlink-ttvlol](https://github.com/2bc4/streamlink-ttvlol) | 257 | Streamlink plugin | TTV.LOL proxy integration. |
| [luminous-ttv](https://github.com/AlyoshaVasilieva/luminous-ttv) | 147 | Rust proxy | Russia-region playlist trick. |
| [hawolt/twitch-adblock](https://github.com/hawolt/twitch-adblock) | 142 | Java | Newer entrant (Jan 2026). |
| [twitch-hls-client](https://github.com/2bc4/twitch-hls-client) | 70 | Rust CLI | Minimal CLI watcher with ad-block built in. |

**Read:** These are single-purpose tools (mostly browser extensions). They don't compete with StreamFusion holistically — but they do mean the ad-block-only audience already has good tooling, so StreamFusion's ad-block needs to be solid to be a real reason to switch.

## 5. Recorders / archivers (adjacent, not direct competition)

These are streamer/archivist tools, not viewers. Mentioned because they share the Twitch/Kick API surface.

- [StreamWarden (YouG-o)](https://github.com/YouG-o/StreamWarden) — 15★ — Java desktop monitor + recorder for Twitch/YouTube/Kick.
- [StreamVault (kinderdat)](https://github.com/kinderdat/StreamVault) — 2★ — Electron archiver for Twitch/YouTube/Kick.
- [Ultimate-Twitch-Archiver](https://github.com/1vrb/Ultimate-Twitch-Archiver) — 2★ — Twitch automation + restream.

**Opportunity:** Recording / DVR could be a future StreamFusion feature; no entrenched leader.

## 6. Web-based multi-stream viewers (functional competitors, not on GitHub)

These are the realistic **substitute** users reach for today instead of installing a desktop app:

- [multistream.me](https://multistream.me/) — Twitch / Kick / YouTube / Trovo.
- [multitwitch.tv](https://www.multitwitch.tv/) — original; Twitch-only.
- [multiwatch.net](https://multiwatch.net/) — Twitch / YouTube / Trovo / Kick.
- [stream-sync.com](https://www.stream-sync.com/) — Twitch / Kick / YouTube. Per [their own blog](https://www.stream-sync.com/blog/best-multitwitch-alternatives), they market themselves as the only major multistream viewer with Kick support.
- [escharts.com/multistream-viewer](https://escharts.com/multistream-viewer) — multi-platform.
- [streamscharts.com/tools/multistream-viewer](https://streamscharts.com/tools/multistream-viewer) — multi-platform.

**Read:** These are the *real* competition in user mindshare. StreamFusion's wedge against them:

1. **Native performance** — one process vs. N iframes / N browser tabs.
2. **Twitch ad-block** baked in — web tools usually relay official embeds with ads.
3. **In-app chat with emotes** — web tools mostly iframe Twitch/Kick chat.
4. **Auto-retry / robust HLS** — web embeds reload on every drop.
5. **Local SQLite persistence** — followed channels, layouts, etc. survive without auth round-trips.
6. **Offline-capable shell** — works without third-party hosting being up.

## 7. Recent Tauri/React entrants (signals, not yet threats)

A clear pattern: late-2025 / early-2026 saw a cluster of new Tauri-based desktop attempts at this same niche. All very low-star.

- [V-Streaming (vantisCorp)](https://github.com/vantisCorp/V-Streaming) — 0★ — Tauri + React; AI-flavored. Kick + Twitch.
- [UniChat](https://github.com/rusnakdima/UniChat) — 1★ — chat-only.
- [OmniStreamStudio](https://github.com/phaylali/OmniStreamStudio) — 1★ — broadcasting tool.
- [ilanzgx/multistream](https://github.com/ilanzgx/multistream) — 4★ — multi-stream viewer.

**Read:** Tauri is the modern default for new entrants. StreamFusion's Electron choice is heavier in bundle/memory but provides a more mature ecosystem for HLS/video — not a current disadvantage given competitor traction is near-zero.

## Strategic gaps & opportunities for StreamFusion

| Gap | Who's there now | StreamFusion opportunity |
| --- | --- | --- |
| YouTube Live in the same app | UniChat, multistream-viewer, panoptic | Add YouTube Live to leapfrog streamlink-twitch-gui (which is Twitch-only) and match feature scope of stream-sync.com. |
| Mobile (iOS/Android) unified client | Nothing — [Twire](https://github.com/twireapp/Twire) is Android Twitch-only | Wide-open. React Native or Capacitor could reuse much of the desktop codebase. |
| Recording / DVR | StreamWarden, StreamVault (low traction) | Bundle as power-user feature. |
| Mature, polished Electron unified viewer | **No one** | This is exactly StreamFusion's lane today. |
| Plugin / extension API à la Chatterino | Chatterino has plugins | Future moat. Plugin SDK over tRPC. |
| Active maintenance of an unified app | Orion archived; ttv-ublock archived; many web tools have stale UIs | Reliability and ongoing dev itself is a wedge. |

## Bottom line

**StreamFusion has no equally-positioned, equally-built peer on GitHub today.** The competitive landscape is:

1. A 2.8K-star Twitch-only desktop incumbent on aging tech (streamlink-twitch-gui).
2. A 2.5K-star chat-only desktop incumbent (Chatterino2).
3. A 274-star multi-platform chat aggregator with a proprietary core (AxelChat).
4. A long tail of <5-star toy projects converging on the same idea.
5. Mature web-based multi-stream viewers that are StreamFusion's true substitute in user behaviour.

The strategic moat is **execution quality and breadth in one app**: unified Twitch + Kick video + chat + ad-block + persistence + auto-retry, packaged natively. Add YouTube Live and mobile to widen the lead.

## Sources

- [Streamlink Twitch GUI](https://github.com/streamlink/streamlink-twitch-gui)
- [Chatterino2](https://github.com/Chatterino/chatterino2)
- [AxelChat](https://github.com/3dproger/AxelChat)
- [UniChat](https://github.com/rusnakdima/UniChat)
- [Chatty](https://github.com/chatty/chatty)
- [Orion](https://github.com/alamminsalo/orion)
- [multi-stream-viewer (pjmagee)](https://github.com/pjmagee/multi-stream-viewer)
- [ilanzgx/multistream](https://github.com/ilanzgx/multistream)
- [MultiStreamZ](https://github.com/obrunuaf/MultiStreamZ)
- [StremGrid](https://github.com/ALEXFSX/StremGrid)
- [TKMultiviewer](https://github.com/timswhatever/TKMultiviewer)
- [GhostViewer](https://github.com/ghostmade/GhostViewer)
- [panoptic](https://github.com/panoptic-live/panoptic)
- [V-Streaming](https://github.com/vantisCorp/V-Streaming)
- [Purple-adblock](https://github.com/arthurbolsoni/Purple-adblock)
- [Twitch-HLS-AdBlock](https://github.com/instance01/Twitch-HLS-AdBlock)
- [streamlink-ttvlol](https://github.com/2bc4/streamlink-ttvlol)
- [StreamWarden](https://github.com/YouG-o/StreamWarden)
- [StreamVault](https://github.com/kinderdat/StreamVault)
- [multistream.me](https://multistream.me/)
- [stream-sync.com](https://www.stream-sync.com/blog/best-multitwitch-alternatives)
- [multitwitch.tv](https://www.multitwitch.tv/)
- [multiwatch.net](https://multiwatch.net/)
