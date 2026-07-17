# Slice 01 — Prove complete Category Clip discovery on Twitch and Kick

Status: done
Type: AFK

## Parent

PRD: [Category Page Content Tabs](../prd.md)

## What to build

Run an engineering feasibility spike that proves whether Twitch and Kick can each provide a reliable, complete Category-wide Clip feed without requiring the viewer to sign in. The proof must use native Category identity and include Clips from offline as well as currently live Channels; fan-out over the current Live Stream list is not an acceptable substitute.

For each Platform, exercise the upstream discovery path against representative Categories and record reproducible observations for the supported Clip sorts and time ranges. Establish how pagination behaves, whether the result order remains globally correct across pages, which public or restricted records are returned, and how rate limits, region/account state, malformed cursors, and upstream failures are classified. Define “complete” as all upstream-discoverable public content available to the current viewer and region, excluding records the Platform hides, deletes, makes private, prunes, or cannot play.

The outcome is an evidence-backed capability decision. Mark the Clip track feasible only if both Platforms satisfy the full contract. If either Platform cannot, document the exact failed requirement and keep the Category Clips tab blocked rather than proposing a one-Platform or currently-live-Channel approximation.

## Acceptance criteria

- [x] Reproducible observations demonstrate Category-wide Clip discovery for both Twitch and Kick using native Category identity and without deriving the feed from currently live Channels.
- [x] Signed-out requests are proven to work for both Platforms across representative populated, sparse, and empty Categories, or the failed Platform and requirement are explicitly documented as a release blocker.
- [x] The proof covers `Most Recent` and `Views` ordering plus `Last Day`, `Last Week`, `Last Month`, and `All Time` ranges on both Platforms.
- [ ] Multi-page observations prove globally correct ordering for every supported sort and time range, rather than only sorting each fetched page locally. — Investigated capability failure and release blocker, not outstanding spike work: Twitch's recent sort is unavailable and Kick continuation pages violate global order.
- [ ] Cursor progression and termination are characterized, including empty pages, unchanged cursors, all-duplicate pages, exhaustion, and malformed or expired cursors. — Investigated but unproven release blocker, not outstanding spike work: Twitch expiry and unchanged/all-duplicate cases were not observed, while Kick expiry semantics remain ambiguous.
- [ ] Results retain stable Clip, Platform, Channel, Category, publication-time, duration, thumbnail, View Count, restriction, and playability identity needed by a mixed Category feed. — Investigated capability failure and release blocker, not outstanding spike work: authoritative restriction/playability identity is absent and Kick nested Category identity drifts.
- [ ] The proof records how signed-out, signed-in, region-limited, mature, subscriber-only, deleted, private, pruned, and unplayable Clips are included, excluded, or labeled by each Platform. — Investigated but unproven release blocker, not outstanding spike work: account, region, entitlement, and hidden-record behavior cannot be established from the available sources.
- [ ] Rate limits, authentication changes, transient failures, permanent failures, and upstream response errors are observed and assigned actionable error classifications for each Platform. — Investigated but unproven release blocker, not outstanding spike work: the anonymous internal routes lack contracted rate/auth behavior and forced transient behavior was not observed.
- [x] A concrete completeness statement and known limitations are documented separately for Twitch and Kick, with captured request/response evidence that does not expose credentials or playback secrets.
- [x] The final decision states either that both Platforms meet the shippable Category Clip contract or that the Clips tab remains blocked under the parity rule; no partial-Platform fallback is presented as complete.

## Blocked by

None — can start immediately.

## Comments

- 2026-07-16: Feasibility evidence: [Category Clip discovery](../evidence/01-category-clip-discovery.md). The parity gate failed: Twitch's anonymous native Category source does not provide the required working `Most Recent` order, while Kick's native legacy source returned duplicate and globally misordered continuation pages. Restriction/playability and contracted rate-limit behavior also remain unproven. Keep Issues 04, 06, and 08 blocked; do not substitute a one-Platform feed, live-Channel fan-out, or locally re-sorted approximation.
- 2026-07-16: The feasibility spike is complete with a negative capability result. Criteria 4–8 are intentionally unmet capability requirements, not unfinished investigation: Twitch lacks the required Most Recent feed; Kick continuation pages duplicate and violate global Views/date order; cursor integrity, restriction/playability, account/region, and contracted rate-limit behavior are insufficient or unproven. No further probe can make the current sources shippable without upstream behavior or contract changes. Status set to done; the Category Clips track remains blocked under parity.
