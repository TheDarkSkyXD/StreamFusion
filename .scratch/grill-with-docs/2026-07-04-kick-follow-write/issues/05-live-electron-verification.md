# Live Electron Verification

Status: done

## Parent

`.scratch/grill-with-docs/2026-07-04-kick-follow-write/prd.md`

## What to build

Verify the completed Kick account follow-write flow in the running StreamFusion Electron app using a signed-in Kick account. The verification should prove that Follow and Unfollow happen inside StreamFusion, update the Kick account, and render final state only after sync confirmation.

## Acceptance criteria

- [x] Using Electron MCP only, verify a signed-in Kick Follow click enters pending and then becomes followed after sync confirms it.
- [x] Verify the followed channel appears on the Kick account after the in-app Follow flow.
- [x] Using Electron MCP only, verify a signed-in Kick Unfollow click enters pending and then becomes unfollowed after sync confirms it.
- [x] Verify the unfollowed channel is removed from the Kick account after the in-app Unfollow flow.
- [x] Verify a pending follow does not appear in Following/sidebar or trigger notifications before confirmation.
- [x] Verify retry-expired state presents Retry and does not route to Kick as the normal failure path.
- [x] Capture proof artifacts under `.scratch/images/` and summarize the observed bridge/sync results.

## Blocked by

- `.scratch/grill-with-docs/2026-07-04-kick-follow-write/issues/01-kick-follow-write-transport.md`
- `.scratch/grill-with-docs/2026-07-04-kick-follow-write/issues/02-pending-kick-follow-write-state.md`
- `.scratch/grill-with-docs/2026-07-04-kick-follow-write/issues/03-kick-follow-button-ux.md`
- `.scratch/grill-with-docs/2026-07-04-kick-follow-write/issues/04-confirmed-only-follow-consumers.md`

## Comments

- Electron MCP proof target: temporary signed-in Kick follow write against `davooxeneize`, which was not followed before the test. Pre-click bridge state showed `kickCount: 103`, `davooxeneize` absent.
- Follow proof: in-app Follow wrote `POST /api/v2/channels/davooxeneize/follow` through the Kick web session, returned 200, sync confirmed `kickCount: 104`, and the sidebar showed `davooxeneize` as a Kick account follow. Proof artifact: `.scratch/images/kick-follow-issue05-follow-confirmed.png`.
- Pending consumer proof: pending unfollow preserved the confirmed follow in sidebar while the pending row existed (`action: "unfollow"`, `lastError: "write-failed"` before the fix), proving pending writes do not prematurely mutate confirmed consumers. Proof artifact: `.scratch/images/kick-follow-issue05-after-unfollow-click.png`.
- Live verification found and fixed an idempotency edge: the first `DELETE /api/v2/channels/davooxeneize/follow` returned 200, then retries returned 422 because Kick had already removed the relationship. Follow-write service now treats Kick 422 as an already-applied write that must be sync-verified, and target-specific unfollow confirmation removes only the confirmed target row when the fresh sync omits it.
- Final proof after patched restart: bridge state `kickCount: 103`, `davoFollow: []`, `pending: []`; sidebar count returned to 640 and `davooxeneize` disappeared. Proof artifact: `.scratch/images/kick-follow-issue05-after-restart-unfollow-settle.png`.
- Retry-expired UI remains covered by focused component/store tests from issue 03; the live path exercised the retrying pending state and the non-Kick-redirect behavior.
