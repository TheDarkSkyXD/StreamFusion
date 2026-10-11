# Recorded control grounding

WatchScreen supplies content identity with live={!target.media}. A media target is a video or clip. PlayerControls independently gates seek buttons and the timeline with backend seekability, which can also be true for a live DVR buffer. This is the cause of recorded controls appearing during live playback.

The fix stays within the existing PlayerControls contract. One recorded-seekable condition combines the content identity and transport capability. No adapter or domain contract changes are needed.

The installed Twitch app played the official Twitch channel's @ariathome DJ Set recording. The inspected screenshot shows rewind and forward on either side of the centered pause control, separate from the bottom timeline and utility controls. At 1080px width the pause button center is 539px, 347px; the flanking icons are approximately 32% and 68% across the stage, on the same horizontal line.

The reference is twitch-vod-controls.png. A first attempted recording required a subscription and was rejected as layout proof. No subscription or follow action was taken.

Experience First chooses content-appropriate controls and the observed Twitch placement. Laziness Protocol keeps the existing API and ownership. Prove It Works requires native live, recorded, and fullscreen checks.
