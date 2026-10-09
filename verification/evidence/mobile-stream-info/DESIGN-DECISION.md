# Stream card design decision

The Twitch reference expands avatar, verified channel name, two-line stream title, category, and horizontal tag pills with the player controls. It collapses metadata after the controls hide. Chat stays visible below the action row.

Candidate A uses the existing effective controls visibility. Candidate B adds a presentation store and a reducer. The independent judge scored A 8 out of 10 and B 3 out of 10 against interaction fidelity, chat and player identity, existing behavior, state ownership, and verification coverage. These scores compare the sketches, not runtime quality.

Use A. Keep the existing timer and derive card expansion from its effective visibility. Remove the tap that selects Info. Preserve explicit Info and Related behavior, recorded comments, and the player stage key. Graft B's target-reset, stale-timer, and overlapping-hold verification cases without its new state owner.

Use the existing WatchInfo union for metadata. Put rendering in the watch feature. Keep language and tags in a horizontal list. Keep follow and channel navigation callbacks. Match the Twitch action row with a real Subscribe handoff. A feature-owned capability and Expo adapter open the documented Twitch subscription URL. The app does not purchase a subscription.

The target screenshots use Twitch's light watch theme. Apply StreamFusion's existing dark tokens to the same layout. This is a palette choice inferred from the existing product design system. It does not establish exact pixel equality with the reference.

Experience First shaped persistent chat and the horizontal tag row. Model the Domain chose WatchInfo and one derived expansion flag. Laziness Protocol rejected a second presentation store. Separate Before Serializing Shared State gives one worker ownership of the code and the lead ownership of emulator evidence. Prove It Works requires fresh Android captures and user-facing interaction checks.

Same-instance guarantees cover portrait card expansion and collapse. Existing fullscreen and Picture-in-Picture behavior may unmount the portrait chat region and will be checked separately.

Twitch documents the subscription page destination in [How to subscribe](https://help.twitch.tv/s/article/how-to-subscribe?language=en_US).
