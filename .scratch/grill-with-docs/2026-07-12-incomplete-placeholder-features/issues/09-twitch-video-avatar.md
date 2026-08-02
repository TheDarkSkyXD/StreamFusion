# Show Channel avatar on Twitch Videos

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Fix the Twitch Video experience so the owning Channel's avatar is resolved and displayed consistently when a viewer opens a Video, including direct navigation where route metadata may be incomplete. Preserve the existing proxied-image boundary for Twitch CDN images.

## Acceptance criteria

- [ ] A Twitch Video displays its Channel avatar when opened from an in-app Video card.
- [ ] Direct navigation to a Twitch Video resolves and displays the avatar without relying on optional route metadata.
- [ ] Missing or failed avatar data uses the existing intentional fallback without leaving a permanent loading skeleton.
- [ ] Regression tests reproduce the missing-avatar data path and pass after the fix.
- [ ] The running Electron app verifies the avatar on an actual Twitch Video.

## Blocked by

None - can start immediately

## Comments

- Resolved the owning Twitch Channel through the existing Channel query when Video metadata or route state omits an avatar, while retaining the proxied-image boundary and intentional fallback.
- Regression coverage verifies card navigation, direct navigation, and failed/missing-avatar behavior; scoped player/image tests, lint, type-check, and build passed.
- Electron proof on Twitch Video `2817099532` confirmed one visible 56 x 56 `xQc` avatar. Evidence: `.scratch/images/twitch-video-avatar-proof.png`.
