# Prove a first-party Chat Replay source

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Prove that at least one Platform-owned first-party endpoint can supply stable historical chat for a Video. Produce executable, redacted fixtures and a narrow capability contract that demonstrates Video lookup, cursor pagination, playback offsets, message fidelity, authentication behavior, rate limits, deletions, and representative failures. Do not use a community archive or retain live chat locally.

## Acceptance criteria

- [ ] At least one Platform source returns historical messages addressable by Video and playback offset.
- [ ] Pagination, authentication, rate-limit, deletion, empty, unsupported, and transient-failure behavior are documented from observed responses.
- [ ] Redacted fixtures and automated contract tests prove stable IDs, offsets, sender presentation, badges, and content fragments.
- [ ] The result defines an explicit supported/unsupported capability decision without enabling unfinished UI.

## Blocked by

None - can start immediately

## Comments

- Proven against Twitch's first-party `gql.twitch.tv/gql` `VideoCommentsByOffsetOrCursor` operation with redacted fixtures and observed pagination/failure evidence.
- Verification: 5 focused contract tests, 5,067 full-suite tests, type-check, and production build passed. The scoped Biome check passed.
- Closed by the commit containing this issue file and its source-proof implementation.
