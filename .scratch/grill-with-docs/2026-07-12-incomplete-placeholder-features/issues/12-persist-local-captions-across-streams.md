# Persist local captions across Twitch and Kick stream changes

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Make the selected caption source durable across stream changes and app restarts. A Twitch-to-Kick or Kick-to-Twitch switch keeps Local live captions selected, clears the old words immediately, starts one recognizer session for the new stream, and ignores late audio or results from previous generations.

## Acceptance criteria

- [x] Caption preferences persist the explicit source, enabled state, language, model, and appearance through the existing preferences service.
- [x] Twitch-to-Kick and Kick-to-Twitch switches retain Local live captions without showing Unavailable or silently resolving to Off.
- [x] A switch clears stale cues and rejects old-generation audio and recognition results.
- [x] Restarting StreamFusion restores the Local live captions selection only after preference hydration and starts exactly one session for the current supported single live stream, including under React StrictMode.
- [x] If the saved model is missing or removed, the logical Local live captions selection remains intact and enters install-required state without acquiring a recognizer lease.
- [x] MultiView acquires zero local recognizer leases and does not mutate the saved selection; local recognition is offered only by an explicit supported single-stream surface.
- [x] Same-channel manifest refresh keeps one logical session, while a true channel or platform switch replaces it exactly once.
- [x] Focused tests and real Electron verification cover both switch directions, stale-result rejection, restart persistence, missing-model restoration, and MultiView suppression.

## Blocked by

- [Deliver local English captions on live streams](11-local-live-captions.md)

## Comments

- Completed 2026-07-15. Persisted Local source, enabled state, language, model identity, and appearance restore only after preferences hydrate; React StrictMode starts one surviving lease.
- A same-channel manifest URL refresh keeps the current lease. Twitch-to-Kick-to-Twitch changes replace it once per true stream identity, clear the prior cue immediately, and reject late audio/results from the old session.
- Missing or explicitly removed model files leave the logical Local selection intact in `install-required` and acquire no recognizer lease. MultiView passes an explicit suppression capability to both platform players, exposes no Local UI, acquires zero leases, and cannot mutate the saved single-stream choice.
- Real Electron proof selected Local on live Twitch `vanillamace`, switched to live Kick `DeenTheGreat` without reopening Subtitles/CC, observed the Twitch cue disappear and fresh Kick text appear, then closed/restarted StreamFusion with the same user-data directory and observed fresh Kick text without selecting captions again. Entering MultiView exposed no Local captions UI; returning to single-stream Twitch immediately resumed fresh local text, proving the saved choice was not mutated. Evidence: `.scratch/images/issue12-twitch-to-kick-persisted-local-captions.png` and `.scratch/images/issue12-kick-persisted-local-caption-clean.png`.
- Verification: 45/45 focused persistence regressions and 30/30 post-format critical tests passed; scoped Biome, TypeScript, production build, and deslop review passed.
