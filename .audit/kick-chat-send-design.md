# Kick chat send recovery design

## Problem

Kick chat send uses a hidden `kick.com` page because the official endpoint returned successful responses without broadcasting for this unverified app. A committed cookie preflight declares the website session expired before loading that page. This blocks Kick's own SSO bootstrap after a cold start. A later coordinator compounds the defect by opening a visible login window from the Send action.

## Usage

```ts
const result = await sendKickChatMessage(chatroomId, content);
```

The caller sends. It does not inspect cookies, choose a transport, or repair authentication.

## Shape

`kick-send-window.ts` remains the single owner of hidden navigation, SSO rehydration, Sanctum bearer capture, bounded reload, and page-context v2 delivery.

- Remove the pre-navigation cookie rejection. A missing cookie before navigation means cold state, not expired authentication.
- Keep the existing single-flight warmup and reload promises.
- Keep page-context v2 as the only send transport.
- Route IPC directly to `sendKickChatMessage`.
- Delete the visible send-time repair coordinator.
- Remove the broadcaster ID from the send transport contract because only the discarded official endpoint used it.

Authentication becomes expired only after one bounded hidden page load fails to produce both the cookie and bearer. A v2 authentication rejection may reload and retry once. Ambiguous failures never retry.

## Synthesis decision

Candidate A is the base. The independent judge scored it 32 to 26 over the lifecycle-service design. Candidate B's explicit state machine handles viewer generations well, but the current module already owns single-flight warmup, reload, disposal, and stale-window callback checks. Adding a second owner would duplicate those decisions without evidence that it fixes another observed failure.

No graft ships. The proposed generation and reload guards already exist in narrower form. Extra guards would be speculative.

## Tradeoffs accepted

- A cold send may wait for one hidden page load in exchange for automatic SSO recovery.
- The app keeps Kick's undocumented web route in exchange for observed broadcast behavior.
- A genuinely expired website session returns a reconnect error. Send never opens authentication UI.

## Regression test

Start with no default-session cookie. The fake hidden navigation then materializes the cookie and bearer. Readiness must succeed, the v2 send must run once, and no visible window or official API call may occur.

## Cold-restart amendment

Live cold-start evidence invalidated cookie-only recovery. Kick removed the persisted
`session_token` during the next page load and retained only `kick_session`; the Sanctum bearer
that had authorized real v2 traffic existed only in the previous main-process memory.

The final boundary therefore stores the captured Sanctum bearer in a dedicated Electron
`safeStorage` envelope. Normal Kick authentication arms capture before loading kick.com. A cold
sender restores the bearer only in main, requires a durable Kick cookie, and loads the active
channel page before executing the page-context send. Renderer IPC never returns the credential.
Confirmed v2 rejection and explicit Kick logout clear the envelope. Cookie persistence remains a
rolling 400-day horizon renewed once per day during authenticated chat use.
