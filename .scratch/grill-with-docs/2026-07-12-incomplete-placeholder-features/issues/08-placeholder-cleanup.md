# Clean up misleading placeholder scaffolding

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Finish the milestone with semantic cleanup. Remove feature stubs superseded by real capability-gated surfaces, remove documentation claims that empty component scaffolds are product features, and rename vague intermediate-state comments precisely while preserving legitimate input hints, loading skeletons, cached-data states, multiview host surfaces, and proxy image fallbacks.

## Acceptance criteria

- [ ] The permanent Chat Replay placeholder panel and disabled Subtitles/CC placeholder are gone because their real surfaces own those locations.
- [ ] Empty component scaffolds are no longer documented as undefined future features.
- [ ] The Twitch badge-parser comment explicitly describes deferred BadgeResolver resolution rather than calling it a placeholder.
- [ ] Legitimate placeholder attributes, skeletons, cache states, host surfaces, and image fallbacks remain unchanged.
- [ ] A targeted search and relevant tests prove there are no remaining misleading feature-stub markers in scope.

## Blocked by

- [02-caption-selection-and-overlay.md](./02-caption-selection-and-overlay.md)
- [05-first-platform-chat-replay.md](./05-first-platform-chat-replay.md)

## Comments

- Removed only the superseded feature-stub markers and clarified deferred `BadgeResolver` enrichment; legitimate input hints, skeletons, cached states, multiview WCV hosts, and proxy fallbacks were preserved.
- Targeted misleading-stub search returned zero matches. Focused parser/caption/Video suites passed 46/46, along with type-check and production build.
- Evidence: `.scratch/grill-with-docs/2026-07-12-incomplete-placeholder-features/evidence/08-placeholder-cleanup-proof.md`.
