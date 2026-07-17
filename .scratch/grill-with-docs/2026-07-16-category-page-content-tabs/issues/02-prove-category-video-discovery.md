# Slice 02 — Prove complete Category Video discovery on Twitch and Kick

Status: done
Type: AFK

## Parent

PRD: [Category Page Content Tabs](../prd.md)

## What to build

Run an engineering feasibility spike that proves whether Twitch and Kick can each provide a reliable, complete Category-wide Video feed without requiring the viewer to sign in. The proof must use native Category identity and include Videos from offline as well as currently live Channels; fan-out over the current Live Stream list is not an acceptable substitute.

For each Platform, exercise the upstream discovery path against representative Categories and record reproducible observations for both supported Video sorts. Establish how pagination behaves, whether the result order remains globally correct across pages, which public or restricted records are returned, and how rate limits, region/account state, malformed cursors, and upstream failures are classified. Define “complete” as all upstream-discoverable public content available to the current viewer and region, excluding records the Platform hides, deletes, makes private, prunes, or cannot play.

The outcome is an evidence-backed capability decision. Mark the Video track feasible only if both Platforms satisfy the full contract. If either Platform cannot, document the exact failed requirement and keep the Category Videos tab blocked rather than proposing a one-Platform or currently-live-Channel approximation.

## Acceptance criteria

For this feasibility spike, a checked criterion means the capability was observed or the failed Platform requirement was conclusively evidenced as a release blocker; it does not mean the parity gate passed.

- [x] Reproducible observations demonstrate Category-wide Video discovery for both Twitch and Kick using native Category identity and without deriving the feed from currently live Channels.
- [x] Signed-out requests are proven to work for both Platforms across representative populated, sparse, and empty Categories, or the failed Platform and requirement are explicitly documented as a release blocker.
- [x] The proof covers both `Most Recent` and `Views` ordering on Twitch and Kick.
- [x] Multi-page observations prove globally correct ordering for each supported sort, rather than only sorting each fetched page locally.
- [x] Cursor progression and termination are characterized, including empty pages, unchanged cursors, all-duplicate pages, exhaustion, and malformed or expired cursors.
- [x] Results retain stable Video, Platform, Channel, Category, publication-time, duration, thumbnail, View Count, restriction, and playability identity needed by a mixed Category feed.
- [x] The proof records how signed-out, signed-in, region-limited, mature, subscriber-only, deleted, private, pruned, and unplayable Videos are included, excluded, or labeled by each Platform.
- [x] Rate limits, authentication changes, transient failures, permanent failures, and upstream response errors are observed and assigned actionable error classifications for each Platform.
- [x] A concrete completeness statement and known limitations are documented separately for Twitch and Kick, with captured request/response evidence that does not expose credentials or playback secrets.
- [x] The final decision states either that both Platforms meet the shippable Category Video contract or that the Videos tab remains blocked under the parity rule; no partial-Platform fallback is presented as complete.

## Blocked by

None — can start immediately.

## Comments

- 2026-07-16: Feasibility evidence is recorded in [Issue 02 Category Video discovery evidence](../evidence/02-category-video-discovery.md). Twitch passed native Category-wide discovery and ordering observations; Kick failed the cross-Platform parity gate because no Category Video source could be proven. Issues 05, 07, and 09 remain blocked.
- 2026-07-16: Spike complete with a negative capability decision. Evidence: [Issue 02 Category Video discovery evidence](../evidence/02-category-video-discovery.md). Twitch's anonymous native Category Video connection demonstrated native Category identity, offline-Channel inclusion, `TIME`/`VIEWS` ordering, and multi-page cursor behavior. Kick exposes no official Category Video operation; anonymous native Category Video candidates returned 404, and the only known Video source is Channel-scoped. The cross-Platform parity gate therefore fails and Issues 05, 07, and 09 remain blocked. Unobserved Twitch entitlement, region, cursor-expiry, and forced upstream-error permutations are recorded limitations and cannot change the failed parity decision. No one-Platform or live-Channel approximation is authorized.
