# Fallback cleanup

The reviewed inventory identified at least 23 workflow units; lexical keyword counts are not behavior counts. Keep necessary outage handling and legacy migration while removing dead or unsafe substitutes.

- Twitch dead ID-reader wrapper: removed by renderer review owner; its real Helix endpoint remains and failures propagate. 96 focused tests.
- Kick dead moderation wrappers: removed by provider owner; current official routes remain. 64 focused tests include single-request failure behavior.
- Kick broadcaster batches: root retained bounded read retries but removed silent skipping and empty-success substitution after request failures. A failed sub-batch now rejects the whole lookup. The coalescing entry is released so retry can succeed. Existing identity refresh catches errors and retains stored records. Before:76 adapter tests. After:93 adapter/identity tests; scoped lint passed.
- Credential base64 writes: removed after a synthetic Windows Electron safeStorage round trip. New secrets must encrypt before replacing stored values or caches. Legacy reads remain supported; failed upgrades preserve the valid account and retry later. 514 authentication tests, 48 overlapping tests and the Windows encryption contract passed.

Guest media steering: public category videos and clips must work without a Twitch account. The renderer owner is replacing the authenticated category read with a verified anonymous GQL primary. The provider owner is auditing other public-read authentication gates. Account-specific writes remain permission checked.

No live moderation writes were performed. Tests verify request boundaries and error behavior; they do not establish authorization on an authenticated production channel.
