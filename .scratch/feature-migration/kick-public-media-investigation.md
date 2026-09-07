# Kick public media investigation, 2026-09-06

Anonymous direct Node fetches succeeded with no Cookie or Authorization header:

| Surface | Existing provider endpoint | Result |
|---|---|---|
| Category Clips | kick.com/api/v2/categories/grand-theft-auto-v/clips?cursor=0&limit=20&sort=view&time=all | HTTP 200, 20 clips, nextCursor |
| Channel Videos | kick.com/api/v2/channels/xqc/videos?cursor=0&limit=20&sort=date | HTTP 200, array of 20 videos |
| Channel Clips | kick.com/api/v2/channels/xqc/clips?cursor=0&limit=20&sort=date | HTTP 200, 20 clips, nextCursor |

Evidence: kick-public-media-probe.json. Script: probe-kick-public-media.cjs. Captured shape/counts only, not media URLs or signed playback credentials. The existing application adapters use these same public legacy paths and do not require a user's OAuth token. Category clips filter normalized provider category identity; channel reads use the requested public channel.

No native category-wide VOD feed was found. Current anonymous HTML at https://kick.com/category/grand-theft-auto-v links to the category live surface and /clips, with no Videos tab. Kick's current official OpenAPI at https://api.kick.com/swagger/doc.yaml has category metadata endpoints but no video/clip listing endpoints. Snapshot: kick-openapi-current.yaml. This bounds the conclusion: no verified native source; it does not prove no undocumented endpoint could exist. No speculative endpoint probing or substitute fanout was added.

Primary reference: https://help.kick.com/en/articles/14994615-understanding-kick-com-s-homepage-and-finding-content describes live channels, categories and clips. Public category page: https://kick.com/category/grand-theft-auto-v/clips. Official schema: https://api.kick.com/swagger/doc.yaml.

## Existing app Category Videos is active, not dead

Contrary to the older visual inventory, current source has an active Kick Category Videos path:

- frontend/features/discovery/components/screens/CategoryDetail/index.tsx:54 exposes live/clips/videos.
- CategoryMediaTab.tsx calls useCategoryMedia for the selected kind/platform.
- useCategoryMedia.ts:252 enables Kick whenever selected and category identity is usable; no special videos block.
- backend/features/playback/routes/video-routes.ts:765 calls readers[platform].readCategoryVideos.
- kick-playback-reader.ts:191 implements fanout through up to 24 CURRENT live category channels and up to 5 VODs per channel.
- frontend discovery/tests/pages/CategoryDetail.media.test.tsx:280 explicitly expects both Twitch and Kick video cards and item-routed VOD links.

Limitations of this existing curated approximation:

- Channels with no current live stream are absent; this is not all category videos.
- Matching uses category name, not VOD category ID.
- normalizeKickVideo fills missing category from the live channel's supplied category before filtering; unknown VOD categories can therefore be misattributed.
- Sorting only covers the fetched subset, then orderCategoryVideos promotes one item per channel, so it is not globally ordered popularity/date.
- Returned cursor pages live channels, not the native category VOD dataset.

No source edits made because root explicitly said not to remove an active curated feature without reporting the exact path first. Root has these findings for the product/implementation decision. A native parity claim is not justified for this approximation.

Verification: `npx vitest run --project=node src/backend/features/playback/tests/api/platforms/kick/video-endpoints.test.ts src/backend/features/playback/tests/api/platforms/kick/clip-endpoints.test.ts` from apps/desktop: 2 suites / 42 tests passed. Anonymous direct provider probe described above independently verified current public success for the three supported feeds. No browser or live mutation used.

## Curated category accuracy fix, authorized after investigation

Root chose to preserve the active curated feed. Fixed recorded metadata handling instead of adding a source:

- video-endpoints.ts preserves the VOD's category ID as gameId and obtains category name only from the VOD category object; livestream session_title is no longer accepted as a category.
- kick-playback-reader.ts does not borrow current channel category when normalizing a VOD. Category filtering prefers the actual recorded ID; actual recorded name is used only if the recorded ID is absent. Unknown categories and conflicting IDs are excluded.
- Actual channel Videos/Clips and native Category Clips remain public and unchanged in transport.
- Renderer owner adds a concise coverage sentence for Kick/all Videos: 'Kick videos are from channels currently live in this category.' EN/ES and generation are owned by that agent.

Regression evidence: kick-category-membership-red.log. Before fix, test returned records [2,3,4,6] (conflicting ID, actual name, no metadata, title-only), expected [1,3] (matching recorded ID despite rename, actual recorded name without ID). After fix 3 Kick endpoint/IPC suites passed 123 tests; shared Kick client suite passed 42 more. Scoped ESLint and diff check passed. Final TS is being coordinated with the other agent's shared video-handlers test fixture now requiring gameId. No live mutation was made.

Final desktop npx tsc --noEmit passed after the shared fixture update. Kick source edits are frozen.
