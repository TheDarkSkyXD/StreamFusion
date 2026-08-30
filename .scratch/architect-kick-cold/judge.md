# Kick cold-path architecture verdict

## Verdict

Use Candidate A as the base. It removes the unnecessary `/chatroom` wait from the route gate without changing the renderer, IPC, `UnifiedChannel`, hidden-window slot, or ID mapping. It also states the required in-flight rule. Candidate B reaches the same route result but leaves the concurrent-mode rule unspecified and makes an internal loading choice public.

Keep the settings mode private. `getChannel` maps its existing `freshChatroomSettings` intent to a private `"embedded" | "refresh"` read mode. `getPublicChannel` must not expose a `chatroomSettings` option.

Keep the direct `getPublicChannel` default fresh. That preserves its current contract. The normal route calls the private reader with `"embedded"`, while `getChannel(..., { freshChatroomSettings: true })` calls it with `"refresh"`. This is the narrowest design that removes the cold-path work without silently changing a direct caller's result.

## Scores

Scores are out of five.

| Criterion | Candidate A | Candidate B | Judgment |
| --- | ---: | ---: | --- |
| Removes card and chat gate work | 5 | 5 | Both remove the second request from the normal `getChannel` path. |
| Preserves IDs and explicit freshness | 5 | 5 | Both keep the three distinct Kick IDs and the existing fresh request. |
| Preserves serialized window stability and request rate | 5 | 4 | A keeps the slot and removes one route request. B does too, but its public option makes fresh work easier to reintroduce. |
| Small coherent type and interface change | 5 | 3 | A keeps the mode private. B exports transport-adjacent policy. |
| Deterministic red and green seam under two seconds | 5 | 2 | A can reject an unexpected second call immediately. B's never-resolving mock fails through a test timeout. |
| Correct inline and fresh in-flight sharing | 5 | 2 | A says refresh cannot join embedded. B does not change the slug-only in-flight record or define compatibility. |
| Honest runtime measurement | 4 | 3 | A separates the skipped and measured stages and does not claim it explains the full gap. B records zero for a stage that did not run. |

## Required grafts and corrections

Take Candidate B's compatibility posture only. Preserve the historical fresh default for direct `getPublicChannel` callers. Do not take its public settings-mode option.

Move Candidate A's one-request regression test from direct `getPublicChannel` to normal `getChannel`, since direct lookup remains fresh. Keep the existing direct default test as a two-request compatibility test. Use an immediate rejected second mock for the one-request test so the red run fails without waiting for Vitest's timeout.

Keep Candidate A's in-flight compatibility predicate. Include both priority and settings mode in the stored record. An embedded request may join a refresh. A refresh must start its own read when the stored promise is embedded-only. The existing single BrowserWindow slot remains the only serialization mechanism. Add the deferred-promise test for this exact asymmetric rule.

Adopt Candidate A's staged log, with one correction. Emit `chatroomSettingsMs` only when refresh work ran. Do not report `0` for an omitted stage. Name the mode and retain queue, load, and extraction timings. Treat the first before-and-after cold-route capture as a hypothesis check, not proof that this one request caused the full 25.4-second gap.

## Evidence

`getPublicChannel` currently fetches `/chatroom` after it has parsed the channel payload. `getChannel` already accepts `freshChatroomSettings`, and `useChatSettingsSync` sends that request after `KickChat` mounts. The in-flight map is currently keyed only by slug and priority. Its record must gain the private mode before a fresh request can safely avoid an embedded-only result.

The two current direct callers only consume identity, verification, display data, or avatars. That makes embedded data safe for the route. It does not justify a silent default change for every future direct caller.

## Principles applied

Laziness Protocol selected the private mode and rejected a new public option. Boundary Discipline kept legacy transport policy inside `channel-endpoints.ts`. Foundational Thinking required the in-flight record to represent freshness before sharing a promise. Prove It Works selected the immediate-failure regression seam. Fix Root Causes selected removal of the settings await instead of semaphore tuning.
