# Highlight spoken text in local live captions

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Restore the useful behavior demonstrated by the earlier caption concept: local live captions visibly advance through the currently spoken word or phrase. Finalized text stays fully readable, the active word uses the StreamFusion accent plus an underline, and the provisional tail updates in place instead of duplicating cues.

## Acceptance criteria

- [x] Incremental recognizer revisions replace the same live cue rather than accumulating duplicate text.
- [x] Valid timestamped words map from recognizer audio position to the player media clock and visibly highlight the current spoken word.
- [x] Missing, malformed, non-monotonic, out-of-range, or unalignable timing data falls back to highlighting the whole provisional phrase; finalized fallback text receives no invented word highlight.
- [x] Completed words remain full-contrast and readable; highlighting uses both color and underline.
- [x] Reduced-motion users receive no animated color sweep, visible partial spans are hidden from assistive technology, and a separate polite live region announces each stable final phrase once.
- [x] Platform-authored plain cues continue to render unchanged and Picture-in-Picture receives readable plain captions.
- [x] Seek, live discontinuity, and stream switching invalidate old clock mappings and clear provisional text and announcement identity.
- [x] Focused tests and real Electron proof cover partial updates, stale/equal revision rejection, finalization, stream switching, timing fallback, and accessibility semantics.

## Blocked by

- [Persist local captions across Twitch and Kick stream changes](12-persist-local-captions-across-streams.md)

## Comments

- Implemented stable cue identity/revision replacement, strict timestamp validation and fallback behavior, full-contrast word rendering, reduced-motion/accessibility semantics, plain Picture-in-Picture cues, and clock invalidation on seek/discontinuity/switch.
- Real Sherpa output exposed ASCII-space-prefixed word boundaries; the recognizer now supports those alongside SentencePiece `▁` boundaries and carries grouped word end-times through subword tokens.
- Real ASR timings are retrospective, so valid provisional cues retain the latest recognized word until the next revision; finalized cues continue to obey their measured half-open intervals.
- Verification: 79 focused caption tests, TypeScript, scoped Biome, React Doctor, deslop review, and production build all passed.
- Electron proof on the live Twitch stream `TheBurntPeanut` observed one visible active-word span and one visible completed-word span. Artifact: `.scratch/images/issue13-live-active-word-highlight.png`.
- 2026-07-16 follow-up: Twitch local-caption highlights now use Twitch's accessible dark-theme accent (`TWITCH_COLORS.accent`, `#BF94FF`) instead of Storm Crimson. Kick and platform-authored captions remain unchanged. Electron proof: `.scratch/images/twitch-local-caption-purple-proof.png`.
