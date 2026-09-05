# StreamFusion

A desktop client for watching live streams and recorded videos on Twitch and Kick. One app, two providers, one unified experience.

## Language

### Providers and identity

**Platform**:
The provider a piece of content lives on. `"twitch" | "kick"`. Every Channel, Stream, Video, Clip, and Follow is keyed by exactly one Platform.
_Avoid_: Provider, vendor, network.

**Twitch**:
The Amazon-owned streaming platform. Uses GQL + Helix REST + Hermes WebSocket for IRC chat.
_Avoid_: ttv (use only inside identifiers Twitch itself defines).

**Kick**:
The streaming platform built on Pusher WebSocket for chat. Public reads do not require auth.
_Avoid_: KCK, kick.com (use only in URLs).

### Content

**Channel**:
A broadcaster's home on a Platform. Has a slug, a numeric id, badges, and (optionally) a live Stream right now.
_Avoid_: Broadcaster page, profile, account.

**Stream**:
A live broadcast happening on a Channel right now. Has a category, a viewer count, and a playback URL.
_Avoid_: Live, broadcast, show.

**Video**:
A recorded VOD attached to a Channel. Past Streams or uploads.
_Avoid_: Recording, archive.

**Clip**:
A short, user-curated excerpt from a Stream or Video.
_Avoid_: Highlight, snippet.

**StreamSlot**:
One of N addressable render containers in the multiview layout. A StreamSlot retains a Stream's layout membership even while playback is suspended. When active, it owns that Stream's player instance, SlotPresence, and (after the per-stream isolation work) renderer process. Distinct from the Stream itself — a Stream can be loaded into any slot; a slot can hold any Stream or be empty.
_Avoid_: Tile, pane, view, window.

**PlaybackBudget**:
The user-configurable number of StreamSlots allowed to play concurrently (minimum 1, default 4, no hard maximum). It limits decoder and slot-process cost without limiting how many channels the user may keep in the layout. Overflow slots remain visible and suspended until activated. Persists with the other multistream preferences.
_Avoid_: MultiviewCap, maxStreams, streamLimit, multistreamLimit.

**SlotPresence**:
The user-attention state of a StreamSlot: `"focused" | "background" | "hidden"`. `focused` is the slot the user is actively watching (full quality, full buffer, audio). `background` is on-screen but unfocused in multiview (degraded quality, trimmed buffer, muted). `hidden` is not rendered right now (collapsed tab, off-screen) — the HLS instance is torn down entirely. The slot state machine drives quality, buffer config, and process lifecycle from this single attribute.
_Avoid_: visibility (CSS-overloaded), mode, focus.

**Follow**:
The authenticated user's persistent relationship to a Channel. Distinct from a moderator relationship.
_Avoid_: Subscription (subscription is a paid Twitch-only concept), bookmark.

**Guest Follow**:
A local Follow created while the user is not authenticated to that Follow's Platform. It remains separate from account Follows after sign-in and can still drive StreamFusion experiences such as followed-channel browsing and live notifications.
_Avoid_: Bookmark, local subscription.

**Live Notification**:
An app alert that a followed Channel's Stream has started. It applies to both authenticated Follows and Guest Follows.
_Avoid_: Mock notification, live badge, system message.

### Cross-platform plumbing

**ChannelRef**:
A discriminated reference to a Channel that crosses the IPlatformReader seam: `{ kind: "slug", value } | { kind: "id", value }`. Replaces the overloaded `channelId: string` callers used to pass. The adapter resolves to its provider's underlying lookup.
_Avoid_: channelId (overloaded), login, slug-or-id.

**IPlatformReader**:
The common read-side seam every Platform's adapter implements: streams, channels, categories, follows, videos, clips. Platform-only features (Twitch polls, EventSub; Kick public reads) live behind their own capability interfaces — they are not part of IPlatformReader.
_Avoid_: PlatformClient (the old `IPlatformClient` interface from `unified/platform-client.ts` that nothing implemented), PlatformAPI, PlatformService.

**Capability interface**:
A narrow seam covering one Platform-specific or optional concern (e.g. `IPlatformPredictions`, `IPlatformEventSub`). A Platform's adapter implements whichever capability interfaces apply. Callers ask `clients.for(platform).as(IPlatformPredictions)` and get either the adapter or `null`.
_Avoid_: Optional method, feature flag.

**Unified type**:
A Platform-neutral DTO produced by adapters: `UnifiedStream`, `UnifiedChannel`, `UnifiedVideo`, etc. Defined in `backend/api/unified/platform-types.ts`. Adapters own the transformation from provider-native shapes.
_Avoid_: Common type, normalised type.

**OAuth2Session**:
The Platform-neutral wrapper around an authenticated session: owns single-flight refresh dedup, auth-lost emission, and credential storage through capability ports. Constructed by `createOAuth2Session({ credentials, refresher })`. Platform-specific lifecycle (Twitch's proactive refresh scheduler, Kick's Cloudflare cookie purge) wraps it from the outside, not from within.
_Avoid_: AuthService, AuthClient, OAuth2Client.

**ChatConnection**:
The Platform-neutral lifecycle seam every chat adapter implements: `connect | disconnect | on | sendMessage | joinChannel | leaveChannel`. Defined in `@streamfusion/core/chat`; Desktop supplies provider-specific argument and event types while its Twitch and Kick services retain the sockets, credentials, commands, and reconnect behavior.
_Avoid_: ChatService, ChatClient, IRCConnection (Twitch-only flavour).

**Chat Send Eligibility**:
Whether the authenticated viewer is allowed to send a message in the current Channel right now, after Platform auth, follow, subscription, verification, and chat-mode rules are considered. Distinct from draft editing: a viewer can type a draft even when they are not currently eligible to send it.
_Avoid_: canSend (implementation flag), input disabled state.

**ChatWorkspace**:
The set of Channel chats retained for one MultiView layout. Its channel sessions remain active independently from the visible chat presentation, so changing tabs does not leave and rejoin channels.
_Avoid_: ChatPanel list, hidden chats, socket group.

**Merged Chat Feed**:
One chronological, source-labeled view of the messages retained by a ChatWorkspace. It references the canonical per-channel message buckets and does not create duplicate chat sessions or hidden message lists.
_Avoid_: combined chat store, copied messages, all-chat panel.

**Channel Chat Tab**:
The interactive single-Channel presentation inside a ChatWorkspace. Selecting a Channel Chat Tab changes which composer and moderation surface is visible without changing workspace membership.
_Avoid_: separate connection, chat instance, channel window.

**channelKey**:
The canonical bucket identifier used by the chat store and message batcher: a composite string `${platform}:${normalizedChannelSlug}` (e.g. `"kick:xqc"`, `"twitch:xqc"`). Built only via `buildChannelKey(platform, channelSlug)` in `store/chat-store.ts` — never assembled inline. The helper trims whitespace, removes a leading IRC `#`, and lowercases the slug. Keys `state.messagesByChannel` and `state.pausedChannels`, and scopes the `addMessageBatched` flush timer so each channel batches independently. Distinct from `ChannelRef`, which may use a provider ID and represents a lookup rather than a chat bucket.
_Avoid_: chatroomKey, roomKey, bare platform string.

**PlatformHealth**:
The per-Platform reachability state observed from this app: `"healthy" | "degraded" | "down"`. `degraded` means a rolling failure-rate threshold of remote TRANSIENT failures (timeouts, 5xx) has tripped — the platform is up but flaky. `down` means a short-fuse burst of Chromium net::ERR_* — the LOCAL network/GPU service has crashed and every request will fail until it restarts. Owned by `backend/api/unified/platform-health.ts`. Callers consult `isPlatformHealthy(platform)` before issuing a request and serve stale-success cache when unhealthy; main → renderer IPC fires on transitions so the UI can show a degraded-platform banner.
_Avoid_: outage flag, network-down, isOnline (overloaded with browser navigator).

### Renderer ↔ main

**electronAPI**:
The single contextBridge surface the renderer is allowed to call. Defined in `preload/index.ts`, typed by `shared/electron-api-types.ts`. Renderer code reaches the main process through nothing else.
_Avoid_: IPC bridge, window bridge.

**IPC channel**:
A string constant in `shared/ipc-channels.ts` that names a request/response pair handled by `ipcMain.handle`. Channels are the only cross-process message types.
_Avoid_: Event, message, route.

### Diagnostics

**DiagnosticsSnapshot**:
A coherent point-in-time view of one StreamFusion app instance. It combines current diagnostic observations, bounded histories, derived summaries, and the availability of each diagnostic source.
_Avoid_: DiagnosticsPayload, DashboardData, page data.

**ProcessObservation**:
A timestamped observation of an operating-system or Electron process identity and its measured state. Observation does not grant permission to control the process.
_Avoid_: Process, ProcessMetric, task.

**ProcessSignalTarget**:
A current StreamFusion descendant process whose identity and ancestry have been independently validated for a Diagnostics signal action. It is not created by displaying or retaining a ProcessObservation.
_Avoid_: ProcessObservation, PID target, owned process.

**ManagedRuntime**:
A StreamFusion-owned lifecycle entity, such as a StreamSlot, caption session, download, or recording. It may have no process, one process, or different processes over its lifetime; lifecycle actions target the ManagedRuntime through its owner rather than one observed process.
_Avoid_: OwnedProcess, child process, PID target.

**RecoveryAction**:
A user-requested Diagnostics intervention that either signals a ProcessSignalTarget or asks a ManagedRuntime owner to perform a lifecycle action.
_Avoid_: Kill button, process command, automatic recovery.

**RecoveryAttempt**:
A canonical observation of one RecoveryAction request, its validated target, and its execution outcome. It records what Diagnostics tried without granting permission to repeat the action.
_Avoid_: Toast, audit log, retry job.

**Canonical observation**:
A timestamped source record captured by a diagnostic collector. It is the evidence from which diagnostic summaries are derived.
_Avoid_: Raw data, log line, dashboard row.

**Derived diagnostic summary**:
A reproducible calculation over canonical observations, such as a grouped failure count or slow-span ranking. It is never an independent source of truth.
_Avoid_: Stored summary, canonical aggregate, report row.

**DiagnosticLogEntry**:
A canonical observation describing an event emitted by a StreamFusion runtime source. It may reference a TraceSpan, ManagedRuntime, or ProcessObservation, but it does not become part of those records.
_Avoid_: Log, event, trace message.

**Trace**:
A correlated set of TraceSpans representing one end-to-end StreamFusion operation across runtime and process boundaries.
_Avoid_: Request chain, session, log group.

**TraceSpan**:
A canonical observation of one timed operation and its outcome. It may reference a parent TraceSpan and related diagnostic records.
_Avoid_: Trace, timer, performance entry.

**DiagnosticFailure**:
A derived diagnostic summary that classifies a failed TraceSpan, error DiagnosticLogEntry, or collector failure and links back to that evidence.
_Avoid_: Error log, exception, canonical failure.

**Failure fingerprint**:
A stable key derived from an operation, source, error type, normalized message, and stable application frame or status. It groups equivalent DiagnosticFailures after volatile values are removed.
_Avoid_: Exact error text, stack hash, manual failure tag.

**DiagnosticSourceStatus**:
The availability of one diagnostic source: `"ready" | "stale" | "unavailable" | "unsupported"`. It distinguishes zero observed activity from data that could not be collected.
_Avoid_: Health, empty state, collector boolean.

**DiagnosticReport**:
An immutable, user-created export of a DiagnosticsSnapshot, a description, and selected attachments.
_Avoid_: Snapshot, automatic report, telemetry upload.

**DiagnosticArtifactRef**:
An opaque reference to a log, report, or other file inside a main-owned diagnostic root. It contains only safe display metadata; the main process resolves it for a specific Open, Reveal, or Delete action, and the renderer never receives its absolute path.
_Avoid_: File path, absolute path, artifact path.

**PerformanceSubject**:
A stable diagnostic identity for a route, named renderer boundary, ManagedRuntime, or ProcessObservation to which performance evidence can be attributed. It supports correlation only and never grants recovery authority.
_Avoid_: Component instance, metric owner, recovery target.

**AttributionSession**:
A bounded, user-started interval of detailed performance collection for one PerformanceSubject, its descendants, and explicitly related runtimes. Only one may be active, and it ends before its collection cost can materially change the behavior being investigated.
_Avoid_: Profiling mode, global profiler, diagnostics session.

**ResourceSample**:
A canonical observation of resource measurements for the StreamFusion app, a ProcessObservation, or a ManagedRuntime. A metric may be absent when its diagnostic source does not support the current platform.
_Avoid_: Metric row, process log, performance snapshot.

**ResourceHistory**:
Bounded local evidence collected while the app runs, including when Diagnostics is closed. A dedicated SQLite recorder retains recent fine samples for an hour, minute summaries for seven days, hourly summaries for 90 days, and up to 32 five-minute before/after incident windows. Summaries preserve sampled CPU/RAM maxima and their original timestamps. Diagnostics offers real time, five minutes, 30 minutes, one hour, 24 hours, seven days, 30 days, and 90 days, with contributing processes, renderer activity, gaps, and storage status directly on the page. Closing the app preserves history; reopening resumes collection and marks the closed interval as a gap. Historical process identity survives exit and confers no recovery authority.
_Avoid_: Log history, continuous profiler, proof of causation.

**CollectionGap**:
An interval where a diagnostic source could not produce a trustworthy ResourceSample, such as during system sleep. It represents unknown activity, not zero activity.
_Avoid_: Zero sample, missing point, downtime.
