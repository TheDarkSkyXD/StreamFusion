# Cross-judge

## Recommendation

Use `candidate-identity-only.md` as the base, narrowed one step further. Change only `MainRendererPortController.trustedSender()` so `webContents.mainFrame.detached` no longer returns `null`. Keep the existing window, `WebContents`, crash, and `mainFrame.isDestroyed()` guards.

The probe identifies `detached` as the actual bad fact: after recovery, the retained `WebContents` is live, its frame is not destroyed, its URL is the expected app URL, and it dispatches IPC. There is no evidence that `mainFrame.isDestroyed()` is stale in this path. Removing it would widen the change without fixing an observed failure. The transport boundary already supplies the authorization proof for a delivered event: exact bound `WebContents`, current main frame, allowed sender, and exact renderer document.

Do not remove all `mainFrame` lifecycle guards. Remove only `mainFrame.detached`.

## Rubric scores

| Candidate | Lazy IPC recovery | Sender, frame, document checks | Dead/crashed suppression | No new lifecycle/API | Regression and real-path proof | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Identity-only | 5 | 5 | 5 | 5 | 5 | 25/25 |
| Readiness | 5 | 5 | 5 | 1 | 4 | 20/25 |

The identity-only candidate makes the current regression pass by returning the same bound `WebContents`. It leaves both existing IPC boundaries intact, so their exact sender, current-frame, origin, and document checks continue to decide trust. It also retains the guards that matter for dead windows, destroyed `WebContents`, and a renderer Electron still marks crashed. Its focused suite plus disposable Electron renderer-kill proof directly cover the reported failure.

The readiness candidate reaches the same correct security conclusion, but it creates `MainRendererIpcTrust`, changes both IPC adapters and the registry, changes port naming or compatibility, and updates mocks. None of that is required by the observed fault because the existing shared boundary already performs event-local authorization. Its real-path script confirms reload health and a route, but should explicitly invoke the lazy feature after recovery if it is used as the decisive proof.

## Consistency and scope checks

The identity-only candidate is coherent about stable `WebContents` identity and event-local authorization. Its scope is one production file. Its only overreach is recommending removal of both `mainFrame` checks while the evidence singles out `detached`. Its passing-test counts also differ between sections, so use the actual command result rather than either stated total.

The readiness candidate duplicates the existing trusted IPC boundary under a new abstraction. Its examples also leave ownership unclear: the registry is said to construct the trust object, while route registration receives one from outside. That is needless churn for a targeted recovery bug.

## Grafts

Keep the identity-only module map and verification plan. Graft one sentence of readiness's reasoning into the implementation note: the delivered IPC event is the recovery-readiness proof, so do not add a ready channel, reload epoch, or navigation synchronization.

Update the regression test to assert that a live recovered `WebContents` with `mainFrame.detached === true` remains the trusted sender. Preserve or add a separate assertion that `mainFrame.isDestroyed() === true` remains rejected. Keep the existing negative transport tests for a different `WebContents`, subframe, remote document, and `data:` document.
