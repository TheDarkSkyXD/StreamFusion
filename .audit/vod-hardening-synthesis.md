# VOD live-link hardening synthesis

Candidate A is the base. It isolates VOD live-link authority behind `useVodLiveLink`, requires a fresh post-mount response, matches the current route, fails closed, and polls every 30 seconds while visible.

Candidate B's `requirePlatform` cleanup remains because it removes unsafe route casts. Its shared `useStreamByChannel` option and page-level authority predicate were rejected because they coupled VOD policy to the live-page cache and left route rules in the caller.

The cross-judge selected candidate A on cache isolation, route ownership, bounded polling, and interface depth. Focused hook and page tests prove the initial stale-cache case, live response, lookup error, route switch, and later live-to-offline transition.
