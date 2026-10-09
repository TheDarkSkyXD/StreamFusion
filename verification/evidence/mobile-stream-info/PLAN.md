# Mobile stream information card

## Visual parity workflow

- [x] Establish the baseline first, before any migration: a visual regression harness that screenshots the current component across its states, plus the target when matching two implementations. No baseline, no parity claim. A blocking prerequisite, not a follow-up.
- [x] Anti-shortcut clauses, stated and held: no harness modifications, no baseline tampering, no component restructuring to make a diff pass. If the baseline looks wrong, stop and ask, don't edit it.
- [x] Migrate one component at a time. Parallelize across worktrees, one owner per component (the **separate-before-serializing-shared-state** principle skill). Shared primitives migrate first as a blocking phase.
- [ ] Pixel-exact parity: failed. The aligned card region has 97.74% differing pixels. Existing dark tokens and live provider data differ from Twitch. The interaction and card structure are implemented; exact pixel equivalence is not claimed. See README.md.
- [x] Run **Opening a PR** per component or per safe batch. Skip the PR because the user requires commit and push to main.

## Throughput checkpoint

- [x] Blocking first steps. Capture Twitch and current StreamFusion on the Android emulator. Trace existing watch state and chat mounting. Compare two implementation sketches before edits.
- [x] Independent workstreams. Readonly design candidates own separate files. One implementation owner changes the watch UI. The lead drives the emulator and verifies the result.
- [x] Shared mutable state. One owner writes watch files. The lead owns emulator state and evidence. Unrelated existing changes stay outside the commit.
- [x] Smallest safe decomposition. Keep this within the existing watch feature and data contracts. Preserve one player and one chat instance through card expansion.

## Architecture phases

- [x] Ground.
- [x] Sketch.
- [x] Agree. No approval checkpoint requested.
- [x] Implement.
- [x] Scrap: no extra presentation store was retained. Native evidence prompted fixed action sizing.

## Arena phases

- [x] Frame.
- [x] Fan out.
- [x] Cross-judge.
- [x] Pick.
- [x] Graft.
- [x] Verify.

## Requested outcome

Match the Twitch Android stream information UI shown by tapping a live player. Keep chat visible underneath. Preserve working follow, channel navigation, player controls, fullscreen, and Picture-in-Picture.

Capture the original layouts unchanged. Dynamic video, avatars, stream text, and chat cannot establish pixel equivalence across different apps. Compare the static card geometry separately and report any mismatch. Never claim exact parity without measured evidence.
