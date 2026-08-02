# Clip and Video Sharing: Grilling Session Notes
Date: 2026-07-12 · Goal: Define how the existing Share control should work for Clips and Videos across Twitch and Kick.

## Summary / key decisions

- Use visual mockups when layout, menu, success, or error-state decisions would benefit from seeing the options.
- Share is a one-click action that copies the Platform's public content link for the Clip or Video.
- Playback and download media URLs, including direct MP4/HLS or signed URLs, are never share targets.
- Share appears only on playback surfaces: the Clip dialog and the Video page. Clip and Video cards remain uncluttered.
- The clipboard payload is the plain public URL only. Video links do not include playback timestamps, titles, captions, or StreamFusion deep links; Clip links likewise contain only the public Clip URL.
- Share is playback-dependent. It is unavailable when the Clip or Video cannot be played successfully in StreamFusion, even if a public Platform URL is known.
- “Playback succeeds” means the player has a resolved source, is ready to play, and has no known playback error. Actual autoplay or user-initiated playback is not required.
- On successful copy, the Share button temporarily becomes “Copied” with a checkmark and a “Link copied” toast also appears.
- If clipboard copying fails, the button remains “Share” and an error toast says “Couldn’t copy link. Try again.” The user can retry immediately; there is no automatic retry or manual-copy dialog.
- The temporary “Copied” button state lasts two seconds, then resets to “Share.” A later successful copy restarts the timer.
- Share remains visible but disabled until playback is ready. Its tooltip/title explains: “Share is available when this Clip/Video is ready to play.”
- Twitch and Kick Clips and Videos ship together; partial Platform coverage does not complete the feature.
- The internal content contract carries an explicit public `shareUrl` (a Public Content Link), separate from playback and download URLs. The renderer must not infer sharing from an overloaded media `url` field.
- Clip and Video surfaces use one shared renderer-side clipboard action built on `navigator.clipboard`, including the copied-state timer and success/error toasts. No new Electron clipboard IPC is introduced.
- The default control uses a Share icon plus “Share”; its successful state uses a checkmark plus “Copied.” It is never icon-only.
- On the Video page, the metadata action order is Follow → Share → Download → Watch Live. Share does not live inside Platform player controls.
- If an API omits `shareUrl`, StreamFusion may use a verified, content-specific Platform fallback. If no verified fallback exists, Share remains disabled; it never guesses or substitutes the Channel page.

## Q&A log

### Q1 — Visual companion
- Asked: Should the grill show visual mockups when UI choices arise, or remain text-only?
- Captured: The user selected visual mockups.
- Doc updates: none
- Flags: none

### Q2 — Default Share action
- Asked: Should Share copy the public content link, open the Windows share panel, or open a StreamFusion destination menu?
- Captured: The user selected copying the Platform's public content link.
- Doc updates: none; this is feature behavior rather than glossary language
- Flags: none

### Q3 — Share-control surfaces
- Asked: Should Share appear only on playback surfaces, on playback surfaces and content cards, or only as a card-hover action?
- Captured: The user selected playback surfaces only: Clip dialog and Video page.
- Doc updates: none
- Flags: none

### Q4 — Video timestamp and clipboard payload
- Asked: Should shared Video links preserve current playback time?
- Captured: No. The user clarified that Share “just copys the video link.” This resolves the payload as the plain public URL only, with no timestamp or surrounding text. Apply the same URL-only rule to Clips.
- Doc updates: none
- Flags: none

### Q5 — Share availability
- Asked: Should Share remain available whenever a public link is known, only when playback succeeds, or always use a constructed link?
- Captured: The user selected only while the content plays successfully. A known public link alone is not sufficient to enable Share.
- Doc updates: none
- Flags: Define the precise playback milestone that enables Share -> product owner

### Q6 — Share enablement milestone
- Asked: Should Share enable when the player is ready with a resolved source, after the first rendered frame, or only after the user presses Play successfully?
- Captured: Enable Share when the player is ready with a resolved source and no known playback error. Autoplay blocking does not keep it disabled.
- Doc updates: none
- Flags: none

### Q7 — Successful-copy feedback
- Asked: Should success use a toast only, a temporary “Copied” button state plus toast, or only the temporary button state? A visual comparison was provided in `designs/share-success-feedback.html`.
- Captured: The user selected the temporary “Copied” button state plus a “Link copied” toast.
- Doc updates: none
- Flags: Decide how long the temporary “Copied” state lasts -> product owner

### Q8 — Clipboard failure
- Asked: Should a clipboard failure keep Share available with an error toast, disable Share, or open a manual-copy dialog?
- Captured: Keep Share available and show “Couldn’t copy link. Try again.” so the user can retry immediately.
- Doc updates: none
- Flags: none

### Q9 — Copied-state duration
- Asked: Should “Copied” remain for two seconds, three seconds, or until pointer/focus leaves?
- Captured: Two seconds. Repeated successful copies may restart the two-second timer.
- Doc updates: none
- Flags: none

### Q10 — Unavailable Share presentation
- Asked: Should unavailable Share remain visible and disabled with an explanation, stay hidden until ready, or be disabled without explanation?
- Captured: Keep it visible and disabled with a tooltip/title explaining that sharing becomes available when the Clip or Video is ready to play.
- Doc updates: none
- Flags: Finalize exact content-specific tooltip wording during implementation

### Q11 — Platform coverage
- Asked: Should the first release cover Twitch and Kick together, Twitch first, or Clips on both with Twitch-only Videos?
- Captured: Twitch and Kick together for both Clips and Videos.
- Doc updates: none
- Flags: Kick Video currently loses the public page URL while routing to the Video page; the implementation must add safe canonical-link plumbing rather than copying the existing overloaded `url`/playback source

### Q12 — Public-link data contract
- Asked: Should StreamFusion carry an explicit public `shareUrl`, construct Platform links in the UI, or reuse the existing overloaded `url` field?
- Captured: Add an explicit public `shareUrl` field and preserve the Kick Video Public Content Link through the data and routing path. Keep it separate from playback/download URLs.
- Doc updates: Added “Public Content Link” to `CONTEXT.md`.
- Flags: none

### Q13 — Clipboard integration seam
- Asked: Should copying use a shared renderer action with `navigator.clipboard`, new Electron main-process clipboard IPC, or duplicated component-local logic?
- Captured: Use a shared renderer-side action with `navigator.clipboard` for both Clip and Video surfaces.
- Doc updates: none
- Flags: none

### Q14 — Share button presentation
- Asked: Should the control use icon plus text, text only, or icon only?
- Captured: Use a Share icon plus “Share,” switching to a checkmark plus “Copied” after success.
- Doc updates: none
- Flags: none

### Q15 — Video-page placement
- Asked: Should the Video metadata actions be Follow → Share → Download → Watch Live, preserve Follow → Download before Share, or put Share inside player controls? A visual comparison was provided in `designs/video-share-placement.html`.
- Captured: Use Follow → Share → Download → Watch Live, matching the Clip dialog order and keeping player controls unchanged.
- Doc updates: none
- Flags: none

### Q16 — Missing public-link fallback
- Asked: If the API omits the public link, should StreamFusion use only verified Platform URL patterns, require `shareUrl` with no fallback, or copy the Channel page?
- Captured: Use a verified content-specific fallback where one exists; otherwise disable Share. Never guess a Kick link or substitute a Channel page.
- Doc updates: none
- Flags: Implementation must document/test the approved fallback patterns for each Platform and content type

## Open flags (pending input)
