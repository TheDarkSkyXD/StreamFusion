---
date: 2026-08-23
topic: resilience-failure-ux-research
status: research-baseline
scope: Electron desktop, React renderer, Twitch and Kick integrations
---

# Resilience and failure UX research

This is the source-backed audit rubric for StreamFusion. It is not a statement that the app already meets these requirements. Product-code findings should be recorded separately and linked back to the checklist IDs below.

The practical goal is simple: a recoverable dependency failure should not become a blank screen, a lost message, an endless spinner, a duplicate action, or a forced sign-in.

## The error contract to standardize first

Every operation that crosses a trust or process boundary should return a typed outcome instead of an arbitrary string or swallowed exception. This table is a recommended StreamFusion contract derived from the HTTP, Electron, React, and platform rules cited throughout this document.

| Class | Typical evidence | Automatic action | What the user sees |
| --- | --- | --- | --- |
| `invalid_input` | Local validation, malformed IPC or API payload | No retry | Field or action-specific correction |
| `unauthenticated` | 401, invalid or expired token | One coordinated refresh, then one safe replay | Usually nothing during successful refresh; "Sign in again" if refresh is permanently rejected |
| `forbidden` | 403, missing scope or role | No retry | The permission or account capability that is missing |
| `not_found` | 404 or deleted channel/resource | No retry | Resource is unavailable, with navigation out |
| `conflict` | 409 or stale state | Refetch authoritative state before another write | State changed; show the refreshed result |
| `rate_limited` | 429, platform rate headers | Pause until the server deadline, then retry only within budget | "Temporarily rate limited" and a retry time if the wait is noticeable |
| `transient` | Connection reset, 408, selected 5xx | Bounded retry with backoff and jitter | Preserve last good data; show reconnecting only when it affects the task |
| `timeout` | Per-attempt deadline exceeded | Retry only if the operation is safe | "Taking too long" with Retry and Cancel |
| `offline` | Strong offline signal plus failed target request | Pause retries; probe after network change or user action | Persistent offline state, stale data retained |
| `canceled` | User action, navigation, teardown | Stop work and suppress error UI | No error toast |
| `corrupt_local_data` | Parse, schema, decrypt, migration, or integrity failure | Quarantine bad durable state or rebuild disposable cache | Explain what was reset and what was preserved |
| `internal` | Invariant, renderer, process, or unknown failure | Isolate, report, and recover the smallest failed region | Recovery action plus a diagnostic ID |

HTTP defines PUT, DELETE, and safe methods as idempotent, and warns clients not to automatically retry a non-idempotent request without another guarantee that replay is safe. `Retry-After` accepts either an HTTP date or seconds. [RFC 9110 sections 9.2.2 and 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods)

## Audit checklist

### VAL: runtime validation at boundaries

- [ ] **VAL-01** Validate user input both syntactically and semantically. Enforce types, finite numeric ranges, string and collection size limits, enumerated values, URL protocols and hosts, and legal combinations of fields. Reject early. OWASP recommends validating every untrusted source, including partner feeds, and distinguishes syntax from business-semantic validation. [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [ ] **VAL-02** Validate every IPC caller and every IPC argument in the main process. Renderer TypeScript types are not a runtime trust boundary. Electron says to validate the sender of every IPC message, and its context-isolation guide recommends one narrow preload method per message rather than exposing a general send API. [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages), [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations)
- [ ] **VAL-03** Runtime-parse all Twitch, Kick, worker, chat, emote, and media responses before they enter stores. Treat valid JSON with the wrong shape as invalid too. Plain `JSON.parse()` only checks JSON grammar and throws `SyntaxError` for invalid text. [MDN `JSON.parse()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse)
- [ ] **VAL-04** Runtime-parse persisted settings, auth envelopes, history, cache entries, and cross-version migrations. Include a schema version and explicit defaults for missing optional values. [MDN `JSON.parse()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse), [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
- [ ] **VAL-05** Return structured error codes and safe metadata over IPC. Do not make the renderer branch on platform error-message text. Twitch explicitly warns clients not to depend on API error strings. [Twitch API concepts](https://dev.twitch.tv/docs/api/guide)
- [ ] **VAL-06** Bound hostile or accidental volume: chat message length, badge/emote arrays, page size, queued sends, downloaded body size, retry counts, and concurrent requests. [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html), [Google SRE, Handling Overload](https://sre.google/sre-book/handling-overload/)
- [ ] **VAL-07** Validate before side effects and validate again at the privileged boundary. Client validation improves feedback; privileged-side validation provides enforcement. [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html#client-side-vs-server-side-validation)

Bad UX to look for: malformed upstream data blanks an entire page, `undefined` silently reaches a store, an IPC handler throws raw internals, or input is cleared after the server rejects it.

### NET: deadlines, cancellation, and response handling

- [ ] **NET-01** Give every outbound request a per-attempt timeout and an overall operation deadline. A timeout must cover body consumption too, not only receipt of headers. [AWS Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/), [MDN `AbortController.abort()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)
- [ ] **NET-02** Combine timeout cancellation with caller cancellation. `AbortSignal.timeout()` distinguishes `TimeoutError` from a user-triggered `AbortError`, and `AbortSignal.any()` can combine signals. [MDN `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- [ ] **NET-03** Abort or ignore superseded work when a page, channel, account, query, or component changes. React documents that responses can arrive out of order and recommends cleanup that aborts the fetch or ignores the stale result. [React `useEffect`](https://react.dev/reference/react/useEffect#fetching-data-with-effects), [React synchronizing with effects](https://react.dev/learn/synchronizing-with-effects#fetching-data)
- [ ] **NET-04** Check HTTP status before decoding a success payload. `Response.ok` is true only for 200 through 299. [MDN `Response.ok`](https://developer.mozilla.org/en-US/docs/Web/API/Response/ok)
- [ ] **NET-05** Distinguish timeout, explicit cancel, DNS/proxy/TLS/network failure, HTTP failure, response parse failure, and schema failure. These require different recovery and user messages. [MDN `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static), [MDN `Response.ok`](https://developer.mozilla.org/en-US/docs/Web/API/Response/ok)
- [ ] **NET-06** Ensure all long-running user actions have Cancel where cancellation is useful, and make Cancel stop network work, body reads, timers, and queued retries. `AbortController.abort()` can stop requests, response-body consumption, and streams. [MDN `AbortController.abort()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)
- [ ] **NET-07** Deduplicate equivalent in-flight reads. This prevents multiple components or windows from multiplying requests and producing inconsistent completion order. [React synchronizing with effects](https://react.dev/learn/synchronizing-with-effects#fetching-data)

Bad UX to look for: endless loading, late results replacing newer ones, closing a tab while work keeps running, cancel producing an error toast, or a 404 being decoded as a successful empty result.

### RET: retries, backoff, jitter, and idempotency

- [ ] **RET-01** Retry only errors classified as transient. Do not retry validation, permission, most 4xx, parse, or schema errors. A timeout is an unknown outcome, not proof that a write did not happen. [AWS Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/), [RFC 9110 idempotent methods](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)
- [ ] **RET-02** Automatically retry only idempotent operations. For POST-style writes such as chat send, follow, moderation, prediction vote, or settings mutation, use a platform idempotency key when one exists, reconcile before replay, or require a new user action. [RFC 9110 idempotent methods](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2), [AWS Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- [ ] **RET-03** Use exponential backoff with jitter, a maximum delay, a maximum attempt count, and an overall elapsed-time budget. AWS explains that retries add load during failure and that jitter prevents synchronized retry bursts. [AWS Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- [ ] **RET-04** Honor `Retry-After` in both allowed forms. For 429, prefer the platform's reset deadline when supplied. [RFC 9110 `Retry-After`](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3), [RFC 6585 429](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)
- [ ] **RET-05** For Twitch Helix, read `Ratelimit-Limit`, `Ratelimit-Remaining`, and `Ratelimit-Reset`; after 429, wait until the reset epoch. [Twitch rate limits](https://dev.twitch.tv/docs/api/guide#twitch-rate-limits)
- [ ] **RET-06** Retry at one layer only. Google documents how retries at several dependency layers multiply load, and recommends that only the layer immediately above the failing dependency retry. [Google SRE, Handling Overload](https://sre.google/sre-book/handling-overload/#deciding-to-retry)
- [ ] **RET-07** Apply a shared retry budget or token bucket per dependency so many channels, views, or windows cannot create a retry storm. Cap queued work and discard obsolete refreshes. [AWS REL05-BP03](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_limit_retries.html), [Google SRE, Handling Overload](https://sre.google/sre-book/handling-overload/#deciding-to-retry)
- [ ] **RET-08** Reset retry state only after a meaningful stable-success period. Do not turn a single successful probe into a flood. [Microsoft Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [ ] **RET-09** Expose manual Retry after the automatic budget ends. Never loop forever behind a spinner. [AWS REL05-BP03](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_limit_retries.html)

Bad UX to look for: duplicate chat/moderation actions, immediate reconnect loops, hidden ten-minute retry chains, every component retrying independently, or a retry countdown that ignores the server deadline.

### OVL: rate limits, breakers, backpressure, and degraded service

- [ ] **OVL-01** Track health separately by platform and capability. A Kick emote outage must not mark Twitch playback or local settings as unavailable. [Google SRE, Handling Overload](https://sre.google/sre-book/handling-overload/)
- [ ] **OVL-02** Add a circuit breaker only for persistent dependency failures where repeated calls waste time or worsen overload. Scope it narrowly, expose closed/open/half-open transitions to telemetry, allow limited probes, and give it an automatic recovery route. [Microsoft Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [ ] **OVL-03** Fail fast while a breaker is open. Serve cached or reduced data when it is safe, mark it stale, and keep unrelated app functions working. Google recommends degraded responses or local copies before returning errors under overload. [Google SRE, Handling Overload](https://sre.google/sre-book/handling-overload/)
- [ ] **OVL-04** Bound every producer-consumer queue: chat events, outbound messages, notifications, image fetches, downloads, captions, and telemetry. Define whether overload drops newest, drops oldest, coalesces, or blocks. [Google SRE, Handling Overload](https://sre.google/sre-book/handling-overload/)
- [ ] **OVL-05** Coalesce refresh and polling work after startup, wake, account change, or reconnect. Add jitter so every installed client does not hit a platform at once. [AWS Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- [ ] **OVL-06** Prioritize user-triggered foreground work over background polling, prefetch, thumbnails, and enrichment. Drop optional work first when constrained. [Google SRE, Handling Overload, Criticality](https://sre.google/sre-book/handling-overload/#criticality)

Bad UX to look for: one sick API disables the whole app, stale results appear current, background refresh starves a clicked action, or recovery triggers a CPU and network spike.

### OFF: offline, sleep, resume, and reconnect

- [ ] **OFF-01** Model at least `online`, `suspected-offline`, `offline`, `reconnecting`, and `degraded`. Do not use a boolean as the whole truth. [Electron `net.isOnline()`](https://www.electronjs.org/docs/latest/api/net#netisonline), [Microsoft Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [ ] **OFF-02** Treat `net.isOnline() === false` as strong evidence of no connectivity, but treat `true` as inconclusive and test the actual dependency. Electron documents this asymmetry; MDN likewise calls `navigator.onLine` inherently unreliable. [Electron `net.isOnline()`](https://www.electronjs.org/docs/latest/api/net#netisonline), [MDN `navigator.onLine`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine)
- [ ] **OFF-03** Pause automatic retries while strongly offline. Retry after a network-change hint, app resume, or explicit user action, with jitter. [Electron `net.isOnline()`](https://www.electronjs.org/docs/latest/api/net#netisonline), [Electron `powerMonitor`](https://www.electronjs.org/docs/latest/api/power-monitor)
- [ ] **OFF-04** Listen for system suspend and resume. On resume, invalidate dead sockets and expired deadlines, re-check tokens, reconnect streams/chat, and refresh only data that became stale. Electron exposes both events. [Electron `powerMonitor`](https://www.electronjs.org/docs/latest/api/power-monitor)
- [ ] **OFF-05** Keep last good browse data and existing chat visible while reconnecting. Label stale data and show its age. Never replace usable content with a full-page spinner during background refresh. [Google SRE, Handling Overload](https://sre.google/sre-book/handling-overload/)
- [ ] **OFF-06** Preserve unsent user text. If safe delivery cannot be guaranteed, show `Not sent` with an explicit retry rather than pretending success. [RFC 9110 idempotent methods](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2), [Twitch chat send failures](https://dev.twitch.tv/docs/chat/irc-migration/#notice)
- [ ] **OFF-07** Account for captive portals, proxies, VPN changes, DNS failure, TLS or clock errors, and platform-only outages. "You are offline" is wrong when only Twitch is failing. [Electron `net`](https://www.electronjs.org/docs/latest/api/net), [MDN `navigator.onLine`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine)

Bad UX to look for: the UI says online because a virtual adapter exists, reconnect spins while asleep, wake produces duplicate sockets, or the user's chat draft disappears.

### AUTH: token lifecycle and account recovery

- [ ] **AUTH-01** Centralize token state and make refresh single-flight per account. Twitch warns that concurrent refreshes can create many access tokens and recommends one refresher that distributes the result. [Twitch refreshing access tokens](https://dev.twitch.tv/docs/authentication/refresh-tokens/#handling-token-refreshes-in-a-multi-threaded-app)
- [ ] **AUTH-02** For Twitch, react to API 401 by refreshing an Authorization Code Grant user token, then replay at most once when the original operation is safe. Twitch discourages relying only on `expires_in` because tokens can become invalid for other reasons. [Twitch refreshing access tokens](https://dev.twitch.tv/docs/authentication/refresh-tokens/)
- [ ] **AUTH-03** Validate Twitch tokens at app start and hourly while maintaining a session, as Twitch requires. End sessions that fail validation. [Twitch validating tokens](https://dev.twitch.tv/docs/authentication/validate-tokens/)
- [ ] **AUTH-04** When Twitch refresh is rejected because the refresh token is invalid, stop the loop and ask the user to authorize again. [Twitch refreshing access tokens](https://dev.twitch.tv/docs/authentication/refresh-tokens/#can-a-refresh-token-become-invalid)
- [ ] **AUTH-05** Kick refresh returns a new access token and refresh token. Replace the credential pair as one durable operation so a crash cannot leave mismatched state. [Kick OAuth 2.1](https://github.com/KickEngineering/KickDevDocs/blob/main/getting-started/generating-tokens-oauth2-flow.md#refresh-token-endpoint)
- [ ] **AUTH-06** Distinguish expired/revoked credentials, missing scope, account mismatch, platform outage, and local secure-storage failure. Only credential or consent failures normally require user authorization. [Twitch authentication](https://dev.twitch.tv/docs/authentication/), [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
- [ ] **AUTH-07** Keep public viewing and browsing available when account-only features lose authorization. Disable affected actions with a clear sign-in or permission remedy. [Twitch authentication](https://dev.twitch.tv/docs/authentication/)
- [ ] **AUTH-08** Store access and refresh tokens as secrets and never include them in logs, diagnostic bundles, URLs, or error UI. Twitch says to safeguard them like passwords. [Twitch authentication](https://dev.twitch.tv/docs/authentication/), [OWASP logging data exclusions](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude)
- [ ] **AUTH-09** Detect unavailable or weak secure storage. Electron notes that Linux synchronous `safeStorage` can fall back to `basic_text`, while the asynchronous API reports temporary unavailability and key rotation. [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)

Bad UX to look for: several simultaneous 401s trigger several refreshes, a revoked token causes an infinite loop, a temporary platform error signs the user out, or a lost account blocks guest playback.

### RTC: chat and real-time recovery

- [ ] **RTC-01** After abnormal WebSocket closure, delay the first reconnect by a random amount and increase subsequent delays. RFC 6455 recommends backoff to avoid denying service during recovery. [RFC 6455 section 7.2.3](https://www.rfc-editor.org/rfc/rfc6455.html#section-7.2.3)
- [ ] **RTC-02** Implement connection liveness, not only `open` and `close`. Twitch EventSub says to reconnect and resubscribe if neither an event nor keepalive arrives within `keepalive_timeout_seconds`. [Twitch EventSub WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events#keepalive-message)
- [ ] **RTC-03** Handle server-directed reconnect differently from connection loss. Use Twitch's `reconnect_url` unchanged and complete the handoff within its grace period; successful handoff retains subscriptions. [Twitch EventSub reconnect message](https://dev.twitch.tv/docs/eventsub/websocket-reference#reconnect-message), [Twitch EventSub close messages](https://dev.twitch.tv/docs/eventsub/handling-websocket-events#close-message)
- [ ] **RTC-04** On an actually lost Twitch EventSub connection, recreate all subscriptions. Twitch does not replay events missed during the gap, so reconcile state with a REST snapshot where correctness matters. [Twitch EventSub connection loss](https://dev.twitch.tv/docs/eventsub/handling-websocket-events)
- [ ] **RTC-05** Deduplicate at-least-once events by stable event/message ID with a bounded retention window. Twitch says it can deliver a notification twice with the same message ID. [Twitch WebSocket reference](https://dev.twitch.tv/docs/eventsub/websocket-reference)
- [ ] **RTC-06** Handle revocation as an authorization or subscription-state change, not as a generic reconnect. [Twitch EventSub revocation](https://dev.twitch.tv/docs/eventsub/websocket-reference#revocation-message)
- [ ] **RTC-07** For Twitch IRC, honor `RECONNECT`, reconnect, and rejoin prior channels. [Twitch IRC `RECONNECT`](https://dev.twitch.tv/docs/chat/irc#reconnect-command)
- [ ] **RTC-08** Track outbound chat as `sending`, `sent`, `not_sent`, or `unknown`. Keep the original text for retry. Never show a failed send as sent. Twitch API chat responses can include a `drop_reason`. [Twitch IRC migration, sending chat](https://dev.twitch.tv/docs/chat/irc-migration/#notice)
- [ ] **RTC-09** Tear down subscriptions, heartbeats, and reconnect timers on channel/account changes. React requires cleanup to mirror connection setup. [React synchronizing with effects](https://react.dev/learn/synchronizing-with-effects)
- [ ] **RTC-10** Bound buffered events and outbound sends. Do not silently accumulate an unlimited queue while disconnected. [Google SRE, Handling Overload](https://sre.google/sre-book/handling-overload/)

Bad UX to look for: chat looks connected but is silent, reconnect duplicates messages, missed state is never reconciled, old-channel messages leak into the new channel, or sends vanish without status.

### MED: playback and media recovery

- [ ] **MED-01** Await `HTMLMediaElement.play()` and update controls only after it resolves. A rejected `NotAllowedError` needs a visible Play action; `NotSupportedError` means the source or format is unsupported. [MDN `HTMLMediaElement.play()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)
- [ ] **MED-02** Treat `waiting`, `stalled`, and terminal `error` as different states. `stalled` means the agent is trying to fetch media but data is unexpectedly absent. [MDN stalled event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/stalled_event), [WHATWG media element](https://html.spec.whatwg.org/multipage/media.html)
- [ ] **MED-03** Classify terminal failures with `MediaError.code`; retain the browser's diagnostic message in scrubbed logs, not as raw user copy. [MDN `MediaError`](https://developer.mozilla.org/en-US/docs/Web/API/MediaError)
- [ ] **MED-04** Use a bounded recovery ladder: short buffer indication, refresh manifest/source, recreate the player while preserving mute/volume/quality intent, then stop with `Reload player` and `Open in browser` actions.
- [ ] **MED-05** Stop recovery when the channel is confirmed offline, authorization is required, the format is unsupported, or the retry budget is exhausted. Do not reload a player forever.
- [ ] **MED-06** Preserve the rest of the workspace when one player fails. A multi-stream app needs isolation per slot.
- [ ] **MED-07** Distinguish autoplay policy, source unavailable, stream offline, geo/account restriction, ad or embed failure, network stall, and decoder/GPU failure in telemetry and user actions.
- [ ] **MED-08** After sleep/resume or renderer recovery, reconstruct player state intentionally. Do not assume the old media pipeline or embedded page is alive.

Bad UX to look for: black player with no state, infinite reload flashes, all players restart because one failed, volume resets on recovery, or autoplay denial is reported as network failure.

### STO: cache, durable storage, migrations, and corruption

- [ ] **STO-01** Classify each stored item as disposable cache, reconstructable index, durable preference/history, or secret. Recovery must never delete broader data than the failed class.
- [ ] **STO-02** Catch read, parse, schema, migration, decrypt, write, rename, permission, disk-full, and quota failures. Web storage and IndexedDB writes can fail with `QuotaExceededError`. [MDN storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [ ] **STO-03** Version durable records. Test migration from every supported version, interrupted migration, unknown future version, and downgrade.
- [ ] **STO-04** Write durable state atomically and keep a last-known-good copy where loss would hurt. Never overwrite the only good settings/auth file before the replacement is complete.
- [ ] **STO-05** Quarantine corrupt durable data for diagnostics, start from safe defaults, and tell the user exactly what reset. Rebuild corrupt caches without signing the user out.
- [ ] **STO-06** Provide narrow repair actions. Electron can clear HTTP cache separately and can target particular browser storage types and origins; avoid a blanket session wipe. [Electron `session.clearCache()` and `clearStorageData()`](https://www.electronjs.org/docs/latest/api/session#sesclearcache)
- [ ] **STO-07** Handle secure-storage key rotation and temporary unavailability. Do not reinterpret decrypt failure as "no account" and silently discard credentials. [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
- [ ] **STO-08** Surface persistence failure when the user believes an action was saved. Keep the in-memory edit available for copy or retry.

Bad UX to look for: corrupted thumbnail cache signs the user out, a failed settings write still shows "Saved", one malformed entry prevents startup, or repair clears every platform cookie.

### ERR: React, renderer, main-process, and child-process failures

- [ ] **ERR-01** Put React error boundaries around independent recovery regions: app shell, navigation, browse content, each player slot, each chat panel, settings, and modal roots. A child render error should replace only that region. React error boundaries can render fallback UI and report the component stack. [React error boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
- [ ] **ERR-02** Handle errors outside React rendering separately: event handlers, async tasks, WebSocket callbacks, timers, and IPC promises do not become safe because an error boundary exists.
- [ ] **ERR-03** Observe Electron `render-process-gone`, `child-process-gone`, `unresponsive`, and `responsive`. Offer reload for a dead or hung renderer and restore the workspace from durable state. [Electron `app` process events](https://www.electronjs.org/docs/latest/api/app#event-render-process-gone), [Electron `webContents` recovery example](https://www.electronjs.org/docs/latest/api/web-contents#contentsforcefullycrashrenderer)
- [ ] **ERR-04** Do not resume normal main-process operation after an uncaught exception. Node says the process is in an undefined state and limits `uncaughtException` to last-resort synchronous cleanup before shutdown. [Node process errors](https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly)
- [ ] **ERR-05** Treat unhandled promise rejection as a defect, record it with context, and fail or isolate according to the owning operation. An empty `.catch()` is not recovery. [Node `unhandledRejection`](https://nodejs.org/api/process.html#event-unhandledrejection)
- [ ] **ERR-06** Attach `error` listeners to Node `EventEmitter` instances that can emit them. Without one, Node throws and can crash the process. [Node errors](https://nodejs.org/api/errors.html#errors)
- [ ] **ERR-07** Start crash collection before renderer creation if enabled, rate-limit reports, and test it with controlled crashes. Electron's crash reporter monitors processes created after initialization. [Electron `crashReporter`](https://www.electronjs.org/docs/latest/api/crash-reporter)
- [ ] **ERR-08** On restart after a crash, detect the prior abnormal exit, offer safe mode or workspace restore, and prevent a crash loop caused by reopening the same page or media state.

Bad UX to look for: one component creates a white window, an unhandled rejection only prints to a hidden console, the renderer reload loses every open stream, or the app relaunches into the same crash forever.

### OBS: actionable telemetry without privacy leaks

- [ ] **OBS-01** Give each user operation a correlation ID that follows renderer, IPC, main process, worker, platform call, retry, and final UI outcome. Record operation name, dependency, attempt, status/code, duration, cancellation source, and app/platform version.
- [ ] **OBS-02** Measure user outcomes, not only thrown exceptions: time to first stream frame, player stall duration, chat disconnect duration, send failure, sign-in recovery, stale-data age, retry exhaustion, and crash-loop recovery. OpenTelemetry defines traces, metrics, and logs as complementary signals, and recommends user-perspective reliability indicators. [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/), [OpenTelemetry observability primer](https://opentelemetry.io/docs/concepts/observability-primer/#reliability-and-metrics)
- [ ] **OBS-03** Redact by allowlist before data leaves the machine. Do not record tokens, cookies, authorization headers, client secrets, message bodies, stream keys, local paths with usernames, or raw user identifiers. [OWASP logging exclusions](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude), [OpenTelemetry sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/)
- [ ] **OBS-04** Make crash upload a user-controlled preference and disclose what is sent. Electron exposes upload enablement for this purpose. [Electron `crashReporter.setUploadToServer()`](https://www.electronjs.org/docs/latest/api/crash-reporter#crashreportersetuploadtoserveruploadtoserver)
- [ ] **OBS-05** Bound local log retention and diagnostic bundle size. Scrub secrets again at export time.
- [ ] **OBS-06** Give user-facing failures a short diagnostic ID that maps to logs without exposing stack traces.
- [ ] **OBS-07** Track retry and reconnect amplification. A falling success rate paired with rising request rate is a retry storm, even if exception totals look ordinary.

Bad UX to look for: support cannot correlate a toast to a request, logs reveal OAuth credentials or chat content, or telemetry says the app is healthy while players remain black.

### A11Y: accessible failure and progress states

- [ ] **A11Y-01** Identify the failed item and describe the error in text. Do not rely on color, icon, or a generic "Something went wrong." [WCAG 2.2 error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification)
- [ ] **A11Y-02** When a correction is known, state it. Preserve the user's input and focus the relevant field or error summary. [WCAG 2.2 error suggestion](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion)
- [ ] **A11Y-03** Announce dynamic results, reconnect states, retry progress, and errors with an existing `role="status"`, `role="alert"`, or suitable live region. WCAG treats an unannounced dynamic status message as a failure. [WCAG status-message failure F103](https://www.w3.org/WAI/WCAG22/Techniques/failures/F103.html)
- [ ] **A11Y-04** Use `alert` only for important, time-sensitive text. Use polite status for routine retry/reconnect updates, and use `alertdialog` when the user must make a choice. [WAI-ARIA alert pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/), [WAI-ARIA alert dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)
- [ ] **A11Y-05** Do not auto-dismiss an important error before users can read or act on it. WAI warns against automatically disappearing alerts. [WAI-ARIA alert pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/)
- [ ] **A11Y-06** Keep Retry, Cancel, Reload player, Sign in, Copy details, and Dismiss keyboard reachable with visible focus. Restored content should return focus predictably.
- [ ] **A11Y-07** Avoid repeated announcements for every background retry. Announce meaningful state transitions and the final result.

Bad UX to look for: toast-only failures, rapidly repeating screen-reader alerts, disabled controls with no explanation, lost focus after retry, or an error that disappears while being read.

### UPD: update failure and recovery

- [ ] **UPD-01** Model updater states explicitly: idle, checking, available/downloading, downloaded, no update, error, and install pending. Electron emits distinct events for these states. [Electron `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/)
- [ ] **UPD-02** Serialize update checks. Electron warns that calling `checkForUpdates()` twice downloads the update twice. [Electron `autoUpdater.checkForUpdates()`](https://www.electronjs.org/docs/latest/api/auto-updater/#autoupdatercheckforupdates)
- [ ] **UPD-03** Handle updater errors without blocking the current working version. A failed background check should not produce a startup modal or disable playback.
- [ ] **UPD-04** After download, offer `Restart now` and `Later`. Electron applies a successfully downloaded update on the next app start even without an immediate `quitAndInstall()`. [Electron updating applications](https://www.electronjs.org/docs/latest/tutorial/updates#step-3-notifying-users-when-updates-are-available), [Electron `quitAndInstall()`](https://www.electronjs.org/docs/latest/api/auto-updater/#autoupdaterquitandinstall)
- [ ] **UPD-05** Flush durable user state before install and restore the prior workspace after restart. Do not force restart during an active download, unsent edit, or moderation action without warning.
- [ ] **UPD-06** Test feed unreachable, invalid metadata, signature failure, interrupted download, insufficient disk, install failure, and first launch after update. Keep a manual download route when automatic recovery fails.
- [ ] **UPD-07** Respect platform differences. Electron's built-in updater supports macOS and Windows, requires signing on macOS, and delegates Linux updates to the distribution package manager. [Electron `autoUpdater` platform notices](https://www.electronjs.org/docs/latest/api/auto-updater/#platform-notices)
- [ ] **UPD-08** Detect repeated post-update crashes and offer safe mode plus release/version details instead of relaunching endlessly.

Bad UX to look for: duplicate downloads, unexplained restart, updater error on every launch, update failure blocking the app, or no recovery route after a bad release.

## Cross-cutting UX rules

These are recommended product rules derived from the source requirements above.

- Keep the last useful state on screen during refresh and reconnect. Add a stale or reconnecting marker instead of erasing content.
- Match the error to the smallest failed region. A thumbnail failure needs a placeholder; a player failure needs player controls; only shell failure needs a full-window fallback.
- Say what failed, what remains safe, what the app is doing, and what the user can do. Do not show raw exception text.
- Preserve intent. Keep form values, chat drafts, selected streams, player mute/volume, scroll location, and workspace layout through recoverable failures.
- Never claim success before authoritative confirmation. Use pending state for writes and reconcile unknown outcomes.
- Silent recovery is appropriate only when it is quick, safe, and does not change user intent. Show progress once waiting becomes noticeable.
- Every automatic recovery loop needs a stop condition, telemetry, and a manual action.

## Failure-injection acceptance matrix

An implementation does not pass this audit because the happy-path unit tests are green. Exercise these cases against the packaged app or the closest real integration layer.

| Injection | Required observation |
| --- | --- |
| Malformed IPC and upstream JSON | Rejected at boundary; owning region remains usable; no sensitive raw payload shown |
| Hanging connection and hanging body | Per-attempt timeout, overall deadline, Cancel works, no endless spinner |
| 400, 401, 403, 404, 409 | Correct non-transient classification and remedy; no blind retry |
| Several concurrent 401s | One token refresh; safe requests replay at most once; permanent rejection prompts once |
| 408, connection reset, selected 5xx | Bounded jittered retry; last good data remains; manual Retry after exhaustion |
| 429 with reset epoch and `Retry-After` date/seconds | No request before deadline; shared platform throttle; useful countdown when visible |
| Offline before and during an action | Correct state, retries pause, draft/input preserved, automatic recovery after a real successful probe |
| Suspend for longer than token/socket lifetime | One controlled resume sequence; no duplicate sockets, polling bursts, or stale completion |
| WebSocket abnormal close, server reconnect, silent heartbeat loss | Backoff, correct handoff or resubscribe, duplicate suppression, gap reconciliation |
| Duplicate and out-of-order events | Idempotent state update; stale event cannot overwrite newer state |
| Chat send acknowledged, rejected, dropped, or outcome unknown | Accurate per-message status and safe explicit retry |
| Media autoplay rejection, stall, source error, decoder error | Correct recovery ladder and copy; other player slots stay alive |
| Corrupt settings, cache, auth ciphertext, and interrupted migration | Narrow recovery; durable data backed up or quarantined; no unrelated logout/reset |
| Storage quota, disk full, permission denied, keychain unavailable | User is not told "Saved"; edit remains available; retry/export path exists |
| React region throw, renderer crash, GPU/child exit, main uncaught exception | Smallest possible fallback or clean restart; workspace restore; no crash loop |
| Telemetry and diagnostic export | Correlation works; tokens, cookies, chat text, stream keys, and personal paths are absent |
| Update feed/download/install failure and post-update crash | Current version remains usable or safe mode appears; manual recovery route exists |
| Keyboard and screen-reader pass | Error identified in text, announced once at the right urgency, action reachable, focus restored |

## Coverage summary

The easy-to-forget areas are usually not the `try/catch` blocks. They are unknown write outcomes, duplicate and out-of-order events, simultaneous token refresh, retry amplification across windows, sleep/resume, stale-cache disclosure, bounded queues, corrupt local state, partial renderer/process failure, privacy-safe diagnostics, accessible async status, and post-update crash loops. Those are first-class audit categories here.

## StreamFusion implementation audit

Audit date: 2026-08-23. This is a static audit of the current working tree, including in-progress local changes. It does not claim that every matching string is a semantic defect, and it does not replace packaged-app failure injection.

### Verdict

StreamFusion already has substantial resilience engineering. The main UX problem is inconsistency, not a lack of `try/catch`: strong central mechanisms coexist with handlers and adapters that bypass them. That produces slow failures, false empty states, raw technical messages, work that continues after the user leaves, and a few blank-window or no-start recovery holes.

### What is already strong

| Area | Current evidence | Assessment |
| --- | --- | --- |
| Connectivity and degraded service | Confirmed main-process probes, retry countdown, React Query online integration, a visible offline banner, per-platform health with hysteresis, status-page polling, and stale browse snapshots. See [`network-status-store.ts`](../../apps/desktop/src/hooks/network-status-store.ts), [`connectivity-service.ts`](../../apps/desktop/src/backend/services/connectivity-service.ts), and [`platform-health.ts`](../../apps/desktop/src/backend/api/unified/platform-health.ts). | Strong. This correctly avoids treating `navigator.onLine` as the whole truth and keeps unrelated features usable. |
| Safe mutation behavior | Global query reads retry, while mutations use `retry: false` so chat, follows, and moderation are not silently replayed. See [`query-provider.tsx`](../../apps/desktop/src/providers/query-provider.tsx#L145). | Strong default for non-idempotent user actions. |
| Platform request recovery | Twitch classifies transient failures, times out requests, honors rate limiting, refreshes auth, and retries. Kick has rate/concurrency controls, auth refresh, health signals, and particularly strong cached public-stream recovery with in-flight deduplication and jitter. | Strong in the specialized clients, but policy differs by path. |
| Auth and real-time connections | Twitch and Kick token refresh are single-flight; chat connections have timeouts, bounded reconnects, teardown guards, and rejoin/resubscribe behavior. | Strong. This prevents common refresh and reconnect storms. |
| Playback isolation and recovery | HLS manifest/level/fragment retries, media/stall recovery, offline handling, player retry exhaustion, and per-slot crash recovery are implemented. | Strong and unusually thorough. |
| Durable user work | Follow-write reconciliation, download persistence, recording journals/recovery, database transactions for important write groups, and caption-model integrity handling exist. | Strong for task-specific durable workflows. |
| Diagnostics | Main and renderer logging, redaction, process hooks, bounded local logs, network logs, bug-report export, health telemetry, and resource monitoring exist. | Strong local support story. |
| Feature error states | Browse, video, following, category detail, downloads, auth, follow actions, and chat drafts have many explicit loading/error/retry or rollback tests and stories. | Good coverage, but not yet a system-wide contract. |
| Runtime validation | Twitch Helix responses are Zod-parsed; worker token input, several auth/moderation paths, persisted browse data, and the newer trusted IPC handler have runtime checks. | Good examples to standardize on. |

### Highest-impact gaps

#### P0 — contain renderer and process failures instead of leaving a blank or undefined app

- Production [`App.tsx`](../../apps/desktop/src/App.tsx#L21) has no React error boundary, route error component, or regional recovery boundary. The only error boundary found is in a development proof panel. [`renderer-error-hooks.ts`](../../apps/desktop/src/renderer/logging/renderer-error-hooks.ts#L63) records uncaught renderer errors but cannot render a fallback. A render exception can therefore remove the usable UI instead of offering **Reload section**, **Reload app**, or **Open logs**.
- [`crash-hooks.ts`](../../apps/desktop/src/backend/logging/crash-hooks.ts#L72) installs an `uncaughtException` listener that logs and then allows the main process to continue. Node explicitly says normal operation is unsafe after an uncaught exception. The safe policy is synchronous last-resort logging, then controlled termination and recovery on relaunch.
- Host renderer recovery only reloads `oom` and `killed`; `crashed`, `abnormal-exit`, `launch-failed`, and `integrity-failure` receive no fallback in [`renderer-crash-recovery.ts`](../../apps/desktop/src/backend/recovery/renderer-crash-recovery.ts#L34). An unresponsive renderer is force-destroyed after eight seconds and marked as a clean shutdown in [`window-manager.ts`](../../apps/desktop/src/backend/window-manager.ts#L273), so the next launch cannot identify that forced recovery.

Target: add shell and regional error boundaries, a renderer-dead/hung recovery screen, a controlled main-process fatal-exit policy, abnormal-exit detection, workspace restore, and crash-loop safe mode. Preserve individual player/chat isolation.

#### P0 — make startup storage failure recoverable

- Core startup calls [`dbService.initialize()` and `storageService.initialize()`](../../apps/desktop/src/main.ts#L539) without a recovery boundary before the app shell is ready.
- [`DatabaseService.initialize()`](../../apps/desktop/src/backend/services/database-service.ts#L252) opens the database and runs migrations directly. The destructive `local_follows` table recreation starts at [line 295](../../apps/desktop/src/backend/services/database-service.ts#L295), but there is no enclosing migration transaction, pre-migration backup, `integrity_check`, quarantine, or narrow repair flow.
- The clean-shutdown marker currently logs an abnormal prior session but only preserves Chromium cache; it does not present recovery choices. See [`startup-session-policy.ts`](../../apps/desktop/src/backend/startup/startup-session-policy.ts#L9).

User harm: one corrupt database, permission problem, interrupted migration, or malformed durable store can prevent the entire app from opening, with no export, repair, or reset-the-broken-part choice.

Target: transactional/versioned migrations, pre-migration backup, integrity check, corrupt-file quarantine, a minimal boot recovery window, and separate actions for rebuilding cache, resetting preferences, and repairing durable user data.

#### P1 — adopt one typed IPC and error contract

A structural scan found 186 direct `ipcMain.handle(...)` registrations under `backend/ipc`, but only eight registrations through [`registerTrustedIpcHandler`](../../apps/desktop/src/backend/ipc/register-trusted-ipc-handler.ts#L66), all in [`user-profile-handlers.ts`](../../apps/desktop/src/backend/ipc/handlers/user-profile-handlers.ts#L50). The newer helper already validates the sender, request schema, response schema, and failure envelope; most handlers do not receive those guarantees.

The same scan found 52 occurrences of the pattern `error instanceof Error ? error.message` in IPC code. Renderer hooks then turn provider or internal strings back into thrown errors, for example [`useStreams.ts`](../../apps/desktop/src/hooks/queries/useStreams.ts#L137) and [`useCategories.ts`](../../apps/desktop/src/hooks/queries/useCategories.ts#L353). This prevents consistent decisions such as **do not retry forbidden**, **offer sign-in**, **show stale data**, or **suppress cancellation** and can expose technical copy.

Target: extend the trusted contract to all IPC boundaries and return a shared discriminated error type based on the contract at the start of this note. Keep diagnostic detail in redacted logs and return a correlation ID to the UI.

#### P1 — give retries one owner and one elapsed-time budget

[`query-provider.tsx`](../../apps/desktop/src/providers/query-provider.tsx#L145) retries every failed read three times without classifying the error. Twitch and Kick requestors can independently make four attempts. Where both defaults apply, one UI read can therefore cause as many as 16 upstream attempts before it fails; nested fan-out can multiply that further. This is an inference from the configured layers, not a claim that every query takes that path.

The query layer has exponential delay but no jitter, no dependency-wide retry budget, no `Retry-After` awareness, and no overall operation deadline. It also retries permanent schema, 400, 401, 403, and 404 failures unless an individual hook opts out. Kick's general retry loop backs off but does not jitter, while the specialized public-stream path does.

User harm: outage screens take too long to settle, several windows or tiles amplify platform load, and a permanent error feels like a frozen app.

Target: classify errors once, retry at the dependency adapter only, pass a deadline/retry context downward, add jitter and a shared per-platform budget, honor rate-reset headers, and expose manual Retry after exhaustion.

#### P1 — propagate cancellation through IPC to the actual work

Some renderer queries receive an `AbortSignal` but only inspect it after IPC returns. [`useStreams.ts`](../../apps/desktop/src/hooks/queries/useStreams.ts#L137) waits for `getFollowed()` and then calls `throwIfAborted()`. The category path similarly checks around calls in [`useCategories.ts`](../../apps/desktop/src/hooks/queries/useCategories.ts#L188). Search and chat replay already demonstrate request-ID cancellation that crosses IPC.

User harm: changing a route, query, channel, or account discards the result but does not stop its network calls, retries, fan-out, timers, or queue slots. Obsolete work competes with the user's current action.

Target: generalize the request-ID/cancel-channel pattern, combine caller cancellation with per-attempt timeout, and require teardown of queued retries and body reads.

#### P1 — stop turning failures into valid empty results

- Cross-platform category search catches each provider and returns `data: []`, then reports overall success in [`category-handlers.ts`](../../apps/desktop/src/backend/ipc/handlers/category-handlers.ts#L325). “No matching categories” and “both providers failed” are indistinguishable.
- [`SidebarFollows.tsx`](../../apps/desktop/src/components/layout/SidebarFollows.tsx#L132) reads loading state but ignores query errors. If no cached/local rows remain, any fetch failure reaches the empty card at [line 300](../../apps/desktop/src/components/layout/SidebarFollows.tsx#L300): “Follow channels to see them here.” That tells an existing user they follow nobody.
- [`kick-client.ts`](../../apps/desktop/src/backend/api/platforms/kick/kick-client.ts#L836) retains convenience methods that collapse a tagged followed-channel failure to `[]`, even though its own comment says callers needing the distinction must use the tagged result.

Target: model `empty`, `stale`, `partial`, and `failed` separately. Keep last good rows, name the failed platform, show data age, and provide a scoped retry. An empty-state invitation must render only after an authoritative successful empty response.

#### P1 — validate every external provider response, not just Twitch

Twitch Helix has extensive Zod response parsing. By contrast, [`kick-client.ts`](../../apps/desktop/src/backend/api/platforms/kick/kick-client.ts#L177) performs `JSON.parse(responseBody) as T`; most shapes in [`kick-types.ts`](../../apps/desktop/src/backend/api/platforms/kick/kick-types.ts) are compile-time interfaces. Several transforms then dereference nested fields as though shape validity were proven.

User harm: an upstream rollout that removes or changes one nested field can throw far from the boundary, blank a region, poison a cache, or become a misleading generic network error.

Target: add Zod schemas at every Kick, emote, chat, and worker response boundary; distinguish JSON syntax failure from schema drift; reject or skip only the malformed item when partial data is safe.

#### P1 — route all outbound reads through bounded network primitives

[`http-client.ts`](../../apps/desktop/src/backend/services/http-client.ts) already implements timeouts, retries with jitter, per-origin concurrency, in-flight deduplication, queues, and a circuit breaker, but only [`twitch-manifest-proxy.ts`](../../apps/desktop/src/backend/services/twitch-manifest-proxy.ts#L715) was found using it in production. Network policy remains distributed across `ky`, Twitch/Kick requestors, Electron `net.request`, and raw `fetch`/`net.fetch`.

Concrete hanging paths include direct, signal-less third-party emote requests in [`7tv-emotes-service.ts`](../../apps/desktop/src/backend/services/emotes/7tv-emotes-service.ts#L19), [`bttv-emotes-service.ts`](../../apps/desktop/src/backend/services/emotes/bttv-emotes-service.ts#L14), and [`ffz-emotes-service.ts`](../../apps/desktop/src/backend/services/emotes/ffz-emotes-service.ts#L13).

Target: share a small policy primitive rather than necessarily forcing every protocol through one class. Require timeout/deadline, cancellation, body-size limit, response classification, concurrency ownership, and telemetry at each adapter.

### Secondary gaps

- **Correlation is feature-specific.** Playback and search have request/trace IDs, but there is no operation ID that consistently follows renderer → IPC → adapter → retry → final UI outcome. Support can export excellent logs but still has to reconstruct causality manually.
- **Failure UX accessibility is uneven.** The network banner uses a live announcement and chat has several `role="status"`/`role="alert"` regions, but the same contract is not enforced across all dynamic error, retry, and reconnect states.
- **Persisted-state validation is uneven.** Some Zustand stores have migration/normalization logic while others rely mainly on TypeScript and defaults. Every durable store needs corrupt, unknown-future-version, and interrupted-write behavior.
- **The update path models states well, but post-update crash-loop safe mode is absent.** A bad release should not repeatedly reopen the same failing workspace.
- **Tests are rich but failure injection is not systematic.** The repository has many unit/integration error cases and Storybook scenarios; the failure-injection matrix above should become a packaged-app verification suite with assertions on visible copy, preserved state, request counts, elapsed time, focus, and log redaction.

### Recommended sequence

1. **Define the contract:** shared `AppError`, retry classification, operation deadline, cancellation handle, provider completion state, and diagnostic ID.
2. **Fix dishonest or terminal UX first:** root/regional error boundaries, sidebar false-empty behavior, partial search results, fatal-process exit/relaunch, and startup storage recovery.
3. **Migrate boundaries:** all IPC through the trusted schema helper; all Kick and third-party responses through runtime schemas; all outbound work through bounded primitives.
4. **Remove retry amplification:** choose one retry owner per call graph, add budgets/jitter/rate deadlines, and propagate cancellation through IPC.
5. **Prove it in the packaged app:** automate the failure-injection matrix and record user-visible outcome, attempts, elapsed time, preserved intent, accessibility announcement, and diagnostic correlation.

### Suggested acceptance targets

- No recoverable component error can produce a blank application window.
- No loading state can remain indefinitely: every operation has a deadline, cancellation path, or deliberately live connection state.
- No authoritative failure renders empty-state copy.
- No non-idempotent user action is automatically replayed without reconciliation or an idempotency guarantee.
- No single user read causes retries at more than one layer.
- Every IPC request and every external response is runtime-validated at entry.
- A corrupt cache, preference store, or database has a narrow recovery route that states what was preserved.
- Every visible failure offers the relevant next action and a diagnostic ID, without exposing raw internal text.
