# Slice 04 - High-confidence Kick pruning

Status: done

## Parent

PRD: ../prd.md

## What to build

Make Kick account-follow sync remove local Kick account-source rows only when the backend has a high-confidence successful Kick followed-channel result. This lets external Kick unfollows sync back into StreamFusion without letting flaky Kick reads, auth challenges, Cloudflare/Kasada responses, ambiguous zero-results, or uncertain fallback scrapes wipe the user's followed list.

This slice should preserve the current safety rule for failed/uncertain Kick syncs, while allowing trusted successful syncs to prune absent account-source rows.

## Acceptance criteria

- [x] Given a high-confidence successful Kick followed-channel sync omits an existing Kick account-source row, that row is pruned locally.
- [x] Given Kick sync returns an error, existing Kick account-source rows are preserved.
- [x] Given Kick sync encounters an auth challenge, Cloudflare/Kasada challenge, or non-JSON/challenge page, existing Kick account-source rows are preserved.
- [x] Given Kick sync returns an ambiguous zero-result from an uncertain fallback path, existing Kick account-source rows are preserved.
- [x] Given Kick sync returns a trusted empty followed-channel list, Kick account-source rows may be pruned.
- [x] Pending unfollow tombstones continue to block re-adoption according to existing pending-aware reconciliation semantics.
- [x] Sync result classification is explicit enough that manual sync failure feedback can distinguish "failed/uncertain, preserved rows" from "successful, applied rows."
- [x] Backend/storage tests cover trusted prune, error preserve, challenge preserve, ambiguous-zero preserve, trusted-empty prune, and pending tombstone behavior.

## Blocked by

None - can start immediately

## Comments

- Closed 2026-07-02: Kick followed-channel results now carry explicit prune confidence; trusted bearer JSON may prune, uncertain BrowserWindow scrape preserves, and manual IPC reports skipped/error syncs as failures. Verified by Kick endpoint, auth-handler, Kick client, and database tests.
