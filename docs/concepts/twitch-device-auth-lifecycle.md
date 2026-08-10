---
concept: twitch-device-auth-lifecycle
summary: Touch Twitch device auth, startup hydration, secure storage, renderer auth state, or IRC reconnect and a valid account can be erased or appear logged out after restart even when its encrypted envelope is recoverable. Preserve failure classification and envelope semantics; skip for playback-only work that never reads auth or chat credentials.
files:
  - { path: apps/desktop/src/backend/auth/device-code-flow.ts, role: owns polling cadence cancellation and final settlement }
  - { path: apps/desktop/src/backend/auth/twitch-device-auth-window.ts, role: owns popup visibility navigation allowlist and close behavior }
  - { path: apps/desktop/src/backend/auth/twitch-auth.ts, role: validates refreshes persists and explicitly clears Twitch authentication }
  - { path: apps/desktop/src/backend/services/storage-service.ts, role: owns encrypted envelope encoding migration and usable-token checks }
  - { path: apps/desktop/src/backend/ipc/handlers/auth-handlers.ts, role: exposes usable auth status and orders settlement refresh and renderer notification }
  - { path: apps/desktop/src/shared/auth-types.ts, role: defines persisted envelope encoding and renderer auth contracts }
  - { path: apps/desktop/src/store/auth-store.ts, role: reconciles startup refresh results with retained identity and reconnect state }
  - { path: apps/desktop/src/backend/services/chat/twitch-chat.ts, role: refreshes guarded Twitch credentials before IRC reconnect }
  - { path: apps/desktop/src/components/chat/twitch/TwitchChat.tsx, role: requests restored-session IRC authentication through the guarded bridge }
  - { path: apps/desktop/tests/services/twitch-auth-restart.integration.test.ts, role: proves persistence across fresh storage and module boundaries }
  - { path: apps/desktop/tests/store/auth-store.test.ts, role: pins transient permanent and thrown startup refresh behavior }
  - { path: apps/desktop/tests/components/chat/TwitchChat.test.tsx, role: pins guarded restored-session IRC token lookup and reconnect }
---

# twitch-device-auth-lifecycle

## Load this concept when

- Changing Twitch device-code polling, popup navigation, visibility, focus, or close behavior.
- Changing token persistence, encryption, validation, refresh, logout, or auth-status IPC.
- Changing startup hydration, renderer auth reconciliation, or reconnect-required state.
- Changing Twitch IRC startup, credential fetching, or reconnect behavior.
- Diagnosing a hidden popup, a flow stuck on **Connecting**, a false cancellation, or an
  authenticated account that appears logged out after restart.

## The scars

Several failures looked identical in the UI but came from independent seams.

1. Closing the popup aborted polling while Twitch's successful token response was already in
   flight. The completed authorization was then reported as cancellation.
2. Reconnects sometimes loaded from cache without emitting Electron's `ready-to-show`. The page
   was fully loaded in a second window but remained hidden and unfocused.
3. The popup initially allowed too little of Twitch's real sign-in chain. Required Twitch and
   selected identity-provider handoffs were blocked, so polling remained
   `authorization_pending` until expiry and looked frozen.
4. Disconnect cleanup eventually succeeded but renderer feedback lagged. Another seam trusted
   any resolved IPC response and could falsely clear the authenticated UI when the backend
   returned `{ success: false }`.
5. Startup refresh flattened every unsuccessful result or thrown network error into logout.
   The renderer cleared both the durable token and identity even when the backend had classified
   the failure as transient and deliberately preserved valid credentials.
6. Persisted token envelopes did not record whether the payload used Electron `safeStorage` or
   legacy base64 encoding. A fresh process with different `safeStorage` availability could see
   an envelope but fail to decode it.
7. Adding an encoding marker exposed a second boundary. A marked encrypted envelope that was
   temporarily unreadable could be mistaken for an expired usable token, triggering refresh and
   destructive cleanup of credentials that would become readable again later.

Do not collapse these into a generic retry. Each seam needs its own evidence and regression.

## Rules that prevent a repeat

1. Respect the polling interval Twitch returns. Treat `authorization_pending` as normal and
   back off on `slow_down`; faster local polling is not a valid speed optimization.
2. When the popup closes, cancel ordinary pending work but perform the guarded final
   confirmation needed for an authorization response already in flight. A verified success
   wins over cancellation.
3. After token settlement, request popup closure synchronously before token persistence,
   identity refresh, renderer callbacks, or chat startup. Those later steps must not keep the
   private browser window visible.
4. Keep popup navigation allowlisting exact. Include every origin required by the observed
   Twitch sign-in flow and selected identity-provider handoff but never use a wildcard or allow
   unrestricted external navigation.
5. Keep `ready-to-show` for normal presentation and also call `show()` after `loadURL()` resolves.
   Cached reconnects must still become visible and focused.
6. On startup, reconcile refresh outcomes with authoritative backend status. Transient failures
   and thrown validation or network errors preserve both the durable token and authenticated
   identity. A confirmed invalid or revoked credential retains identity and surfaces
   reconnect-required state; it must not masquerade as a transient success.
7. Keep envelope existence separate from token usability. `hasToken()` means durable credential
   material exists; `hasUsableToken()` means it can be decoded now. Renderer-facing auth status
   uses usable-token semantics, while callers intentionally tracking durable storage may retain
   envelope semantics.
8. Persist an explicit `safeStorage` or `base64` encoding discriminator. For legacy unmarked
   envelopes, try `safeStorage` first and use the defensive base64 fallback only after validation;
   then migrate the validated value to marked `safeStorage`. A marked encrypted envelope must
   never silently downgrade to plaintext fallback.
9. Temporary `safeStorage` unavailability is recoverable. Preserve the encrypted envelope and
   identity, do not attempt destructive refresh or clear, expose reconnect-required only when
   authoritative status calls for it, and allow restoration when decryption becomes available.
10. Explicit logout is different from startup recovery and must clear all persisted Twitch auth.
11. Credentials that predate the `authFlow: "device-code"` marker may still be valid Device Code
    credentials. Startup must preserve and validate them instead of inferring their grant family
    from an absent metadata field. Only explicit logout or a confirmed permanent rejection may
    clear them.
12. IRC obtains credentials only through the guarded backend token bridge. The renderer receives
    no access or refresh token in logs or preferences, and reconnect invokes the supplied token
    fetcher again instead of retaining renderer-visible credentials.
13. Disconnect may show a pending state immediately but must not claim success until backend
    cleanup succeeds. Preserve authenticated UI and surface the failure when IPC resolves with
    `success: false` or rejects.

## Deterministic regression seam

Model restart at the real storage boundary with a temporary directory and fake credentials:

1. Process A persists a current device-code credential envelope.
2. Fresh modules and storage in process B hydrate it, classify validation or refresh, and expose
   backend auth status to a newly initialized renderer store.
3. Process C proves the same envelope can be restored after temporary `safeStorage`
   unavailability.

Coverage must prove successful persistence, refresh-token rotation, transient preservation,
invalid or revoked reconnect state, zero refresh and zero clear for a temporarily unreadable
encrypted envelope, later recovery, explicit logout, and absence of credential material in
logger calls. The chat seam must prove that a restored authenticated session connects with an
opaque token fetcher, that reconnect performs another guarded lookup, and that no public send
call is needed.

## Fresh Electron proof outcome

The 2026-08-03 acceptance run used a fresh `npm start` option 1 launch and Electron MCP only.
After authorization, authoritative API / Tokens status reported a connected identity and valid
usable token. StreamFusion alone was closed, its process tree was verified absent, and a second
fresh option-1 launch restored the same authenticated session automatically. Twitch IRC then
reached connected and authenticated state; a non-destructive reconnect-seam probe invoked the
guarded token fetcher once and IRC remained authenticated. No public chat message or follow
operation was performed, and no credential or account-identifying value belongs in proof
artifacts or this concept page.

## What not to conclude from a slow run

The dominant wait can be controlled by the user and Twitch rather than StreamFusion. An
`authorization_pending` response is not an error. Before changing polling or adding retries,
correlate sanitized popup state, blocked-navigation logs, token polling result, and completion
of the final authorization step. Never capture or reproduce account choices, activation URLs,
device codes, OAuth material, tokens, cookies, bearer headers, or credential files.
