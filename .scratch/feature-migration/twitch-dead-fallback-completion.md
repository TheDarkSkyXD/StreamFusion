# Remove unused fake Twitch stream fallback

Repository-wide production TypeScript/TSX caller search found no caller of `TwitchDiscovery.getStreamsByUserIds`. Removed that dead facade method, its misleading `trying GQL` warning and comments, and the obsolete cross-feature test that expected guest access to fabricate an empty list. Removed its unused endpoint mock entry. No replacement fallback was added.

The feature-owned `stream-endpoints.getStreamsByUserIds` implementation remains unchanged. Its existing request, 100-ID limit, page size/cursor behavior, schema validation, user enrichment and error propagation remain intact. Added three regressions for failed primary page propagation, genuine provider-empty preservation without extra enrichment request, and failed metadata enrichment propagation. Existing transformed-success/cursor and boundary tests remain.

Verification:
- `twitch-dead-fallback-tests.log`: 60 tests pass across endpoint and composed provider suites.
- `twitch-dead-fallback-transport-tests.log`: 36 shared requestor tests pass, including mocked HTTP/auth/retry lifecycle.
- `twitch-dead-fallback-lint.log`: scoped ESLint exit 0.
- `twitch-dead-fallback-types.log`: only concurrent Kick moderation worker test references (removed deleteKickMessage/channelSlug API) fail; owner notified. No errors from this slice.
- Follow-up graph search finds no facade method/test/mock reference. The only remaining production definition is the explicitly retained endpoint helper.

No live Helix request was performed: the local TwitchRequestor primary path requires a user token and the assigned facade had no caller. No credentials were extracted or permissions changed. This verifies request behavior through the real endpoint and requestor code with controlled responses, not a claim of live Twitch availability.

Pending Kick status localization was also completed: en/es `chat.kickConnection` keys and all 50 generated catalogs (`kick-status-i18n-final.log`). The first nested chat group exposed two highlight-card key types that assumed every top-level key was a string; they now use i18next leaf ParseKeys. Scoped lint and 49 KickChat tests pass (`kick-status-locale-tests.log`).
