# Send-window retention judge

## Verdict

Winner: **Candidate B**

Score:

- Candidate A: **4/7**
- Candidate B: **6/7**

Why: A is the smaller surface, but it misses two required safety properties called out in the rubric: renderer crash/reload cleanup and mutation-operation reaper safety. B is the only candidate that squarely addresses both while still keeping Pusher receive ownership separate from composer retention.

## Rubric

| Criterion | Candidate A | Candidate B | Judge note |
|---|---:|---:|---|
| 1. `showComposer=false` never retains hidden send window | Pass | Pass | Both move retention away from Pusher joins. |
| 2. Real composer keeps first-send warm | Pass | Pass | Both retain only after a real operation creates the window. |
| 3. Multiple composers cannot race a false release | Pass | Pass | A's renderer ref-count is good enough in one renderer; B is stronger with per-lease identity. |
| 4. Pusher receive lifecycle unchanged | Pass | Pass | Both correctly decouple retention from `joinChannel()` / `leaveChannel()`. |
| 5. Renderer crash/reload cleanup | **Fail** | Pass | A explicitly accepts stale retention until broader cleanup; B handles sender reload/crash directly. |
| 6. Smallest typed surface, no explicit `any` | **Best** | Pass | A wins on surface area; B is still acceptably typed. |
| 7. Operation reaper safety for mutation calls | **Fail** | Pass | Current `fetchKickWebApiMutation()` is not wrapped in `beginWindowOperation()`; B fixes that, A does not. |

## Evidence

- Current `kick-send-window.ts` already protects send and GET with `beginWindowOperation()`, but **not** `fetchKickWebApiMutation()`. That leaves follow/pin/delete/ban-style mutations exposed to the idle reaper unless something else is holding retention.
- Current `kick-chat.ts` already shows the renderer-side ref-count shape from A, and `joinChannel()` / `leaveChannel()` no longer own send-window retention. That part is sound.
- A's own tradeoffs section concedes the crash/reload gap. That is directly against criterion 5, so it cannot be the winner on this rubric.

## Strongest graft

Take **A's narrow renderer-facing API** and graft it onto **B's ownership model**:

- Keep a simple renderer/service pair like `acquireSendWindowRetention()` / `releaseSendWindowRetention()` so React callers never manipulate lease ids directly.
- Under that facade, implement B's main-process **per-owner lease set**, sender-scoped cleanup on reload/crash, and mutation-operation guard.

That gives B the required correctness while preserving A's smaller caller surface.
