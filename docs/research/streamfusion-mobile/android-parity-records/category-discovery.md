# Android parity record: `category-discovery`

- Capability ID: `category-discovery`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Category discovery section
- Observed `main` at branch start: `aa0e52ab71030daa48f72d5cea1d250e8be07cd8`
- Android owner: Mobile `discovery`
- Progress: `implemented`
- Delivery: `direct`
- Adaptation: Equivalent. Categories live under More. Category Detail keeps Live, Clips, and Videos with a bottom search dock.
- Freshness: `current` for APK `1596d999e5ca19d5404bcfc89a5c182bad55d6397c5cb1946eb5550022844d5e` via `verification/evidence/issue-150-categories.json`

## Desktop outcome

Browse categories and inspect category-specific streams, videos, and clips. Filter by platform, language, tags, time, and sort. Clips sort by views or recency.

## Android outcome

Guest Categories work signed-out without Relay. Categories list Twitch and Kick cards with a Search categories dock. Category Detail keeps Follow as explained-unavailable (`guest-category-follow-requires-account`). Tabs are LIVE, CLIPS, and VIDEOS. Platform All, Twitch, and Kick stay on the merged card. Language chips persist. Clip time chips are day, week, month, and all. Clip sort chips are Views and Recent. Helix Get Clips has no sort param, so recency sorts the fetched page in `composeCategoryDetail`. Kick clips stay explained-unavailable on the official public catalog.

## Required evidence

- `change-gate`
- `api30-journey`
- `official-live-catalog`
- `clips-videos-language-and-tags`

## Evidence residuals

`clips-videos-language-and-tags` stays residual on this APK. Language chips apply to Live only. Helix has no clip or video language query. The 2026-09-12 frames show Sort stayed Recent and Views on Videos. They do not isolate a Clips Recent chip tap. Unit tests cover Views default and Recent created-time order.

## Blocking for public release

Signed-in category Follow stays behind OAuth. OAuth stays on #145 and #146.
