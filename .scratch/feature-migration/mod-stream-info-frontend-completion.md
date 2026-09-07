# Stream info and final authority regressions

Implemented the root-assigned frontend scope. No live moderation or browser automation performed.

## Behavior

- `StreamInfoTool.tsx` in moderation/components/screens/Mod/channel/workspace edits title, category via existing category search, language, tags, and the provider's six editable content labels. Current provider-managed labels remain visible and read-only. Only changed fields are sent; category clearing and explicit label disabling are supported. Failed saves retain the draft. Successful PATCH receipt triggers a fresh read; readback errors remain visible and block further writes.
- Channel Tools registers Edit Stream Info behind an independent broadcaster-only `channel:manage:broadcast` permission. Remote moderators receive a native Twitch link. Go-live notification/rerun options explicitly hand off to Twitch.
- `capabilities/channel-tools.ts` defines the typed neutral port; the Electron adapter validates normalized reads and update receipts against the shared schemas, and uses the existing allowlisted category search bridge. Backend/shared implementation owned by finish_feature_storage.
- `ToolError` and other shared tool buttons now explicitly use type=button. Category-search Retry cannot submit a dirty stream-info form.
- `ChannelWorkspace.tsx` retains known tool registrations for the same account/channel during transient authority checks, replacing privileged content with an access notice. Existing dock slots restore automatically once authority returns. Video/chat identity remains stable. A confirmed hidden role still closes the remote workspace via ModChannelPage.
- Old blanket-scope expectations in auth/useModerationAuthority and chat/UserPopout tests now assert independent tool scopes, retained moderator history, and timeout-snapshot denial.
- All new strings plus panel filter and AutoMod coverage strings are in en/es and generated catalogs.

## Evidence

- `mod-auth-tool-regressions.log`: 13 DOM suites / 120 tests pass.
- `mod-stream-info-auth-layout-tests.log`: 16 DOM suites / 148 tests pass, including automatic dock restoration and stable media instances.
- `mod-stream-info-tests-final.log`: 8 stream-info tests pass after adding stale category response and invalid tag coverage.
- `mod-stream-info-lint.log`, `mod-stream-info-lint-final.log`: scoped ESLint clean.
- `mod-stream-info-boundaries.log`: feature layout and 19 ESLint boundary proofs pass.
- `mod-stream-info-types.log`: full desktop TS passed. The next run temporarily caught the other worker's active ModChannelPage story spy typing; owner fixed it and confirmed final whole desktop TS plus scoped lint exit 0.
- `mod-stream-info-i18n-final.log`: final retry completed successfully and checked all 50 complete display-language catalogs. No generator remains running.

## Visual fixtures

`pages-moderation-channel-channeltools--ready` contains a local stream-info/search/update fixture plus existing tools. Other states: `--remote-moderator`, `--permission-required`, `--provider-error`, `--loading`. No live API is used. Parent owns actual UI verification. The full ModChannelPage fixture is owned by finish_provider_ownership.

## Primary API reference

Twitch API reference: https://dev.twitch.tv/docs/api/reference#modify-channel-information and https://dev.twitch.tv/docs/api/reference#get-content-classification-labels. Broadcaster token/scope and PATCH receipt semantics stay enforced in the backend. Unsupported native-only fields are not fabricated in the frontend.
