# Candidate 1

Use a shared host-native `recordingFixturePath(fileName)` helper for valid recording fixtures. Keep hostile paths explicit in rejection tests.

Add a test-only adblock reset that clears stream ownership, URL indexes, detector scopes, backup promises, rendition state, segment cache, callbacks, reload guards, and timers. Run it from `afterEach`. Replace fixed microtask counts with waits on reload callbacks, network calls, or returned playlists.

Put pending revocation IDs on each EventSub subscription entry. Resolve a revocation entry by the subscription-ID map or by payload type plus broadcaster ID. A late POST must consume a matching revocation ID without publishing stale local state.

Extract the auth-header and Kick follow-grid predicate strings into dependency-free leaf modules. Import those leaves from the production owners and DOM tests. Assign the SQLite shim parity test only to Vitest's Node project.

Tradeoff. One test-only adblock reset export gives failed assertions reliable cleanup. Per-entry revocation ownership bounds state lifetime.
