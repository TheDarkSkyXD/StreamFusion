# Existing moderation tools implementation contract

- Frontend owner: renderer_integration_review. Backend/shared owner: finish_feature_storage.
- Separate verified account/channel role from tool-specific scope grants. Preserve own-channel entry while verification runs, fresh-role checks, and backend authority on every mutation.
- Introduce provider-neutral existing-tool capability and normalized DTOs. Electron adapter maps allowlisted Twitch commands and validates read shapes. Composition supplies adapter; components never consume vendor payloads.
- Panels: Shield authoritative read/update, AutoMod level policy, blocked-term paging/add/remove, poll/prediction creation and lifecycle. Use explicit loading/error/empty/success, disable concurrent mutations, retain errors, refresh authoritative data after actions. No remote actions during development.
- Poll and prediction permission checks are independent and broadcaster-only. Existing ban/unban/mod/VIP panels get independent gates. Unsupported remote-broadcaster operations offer Twitch handoff.
- Reuse docking layout/pinned constraints. New UI stays in moderation components, neutral contracts in capabilities, validation/permission workflows in domain, Electron mapping in adapters, wiring in composition. Feature tests cover partial grants, stale reads, invalid responses and mutation failures.
- No new-feed widget UI in this slice. No shared-file edits by frontend owner; negotiate additions directly with backend owner.
