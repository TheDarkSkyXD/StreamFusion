# Chat User Info Dialog

Date: 2026-07-29

## Problem Statement

Clicking a username in StreamFusion chat currently opens a centered dialog that mixes public identity information with moderation controls. Moderation actions are exposed too broadly, Platform authority is not consistently verified, and several profile fields use incomplete or incorrect data paths.

The current experience also falls short of the chat context available in Xtra: Recent Chat Messages need the normal rich renderer, the clicked message needs a stable selection model, and safe viewer actions need clearer organization. Twitch and Kick expose different profile, follow, badge, and moderation capabilities, so the dialog must show truthful field-level states rather than inventing parity.

Known correctness gaps include:

- Twitch follow lookup uses an endpoint intended for the authenticated token owner rather than an arbitrary chatter.
- Twitch subscription lookup similarly cannot verify an arbitrary chatter with a normal viewer/moderator token.
- Moderation mutations can use the Channel ID where the authenticated moderator ID is required.
- Kick profile and relationship data are sparse.
- Unknown authority or Platform state can expose actions that should fail closed.
- Moderation history contains Platform-originated records available to StreamFusion, but is not a complete Platform archive.

## Solution

Redesign the existing centered chat user-info dialog as an identity-first surface available to every viewer, with a separate permission-gated Moderation section.

### Public profile

- Open immediately from the clicked username using identity and chat context already in memory.
- Use a clean structured header with avatar, display name, handle, `Account created`, `Following since`, and a dedicated `Badges` section.
- Do not add a banner or bio.
- Show absolute dates in the dialog and relative ages in hover/focus tooltips.
- Resolve data progressively with field-level loading, error, and Retry states.
- Use explicit relationship states:
  - exact follow date when positively known;
  - `Not following` only after authoritative confirmation;
  - `Unavailable · Retry` when the relationship cannot be verified.
- Keep the Badges section visible:
  - use the complete badge set from the selected chatter's newest authored message in the current live-chat session;
  - show one horizontally scrollable row;
  - show `No badges on the latest message` only after a verified empty result;
  - distinguish loading from lookup failure;
  - show full badge name and Platform/source in accessible tooltips.
- Show at most four badges on each Recent Chat Message row.

### Real Platform data

Use this acquisition order for every profile or relationship field:

1. Official Platform API or delivered official event data.
2. Required Platform authorization/scope upgrade.
3. A validated, isolated first-party website fallback adapter.
4. An explicit unavailable state.

Never estimate account age, follow age, subscription state, or moderation state. Schema validation and fallback drift must remain contained inside Platform-specific adapters.

Required canonical scope changes:

- Twitch:
  - add `moderator:read:followers`;
  - add `moderator:read:blocked_terms`;
  - add `moderator:read:chat_settings`;
  - add `moderator:read:moderators`;
  - add `moderator:read:vips`;
  - retain existing manage scopes where Twitch documents them as satisfying the corresponding `channel.moderate v2` permission category.
- Kick:
  - add `events:subscribe`;
  - retain `user:read`, `channel:read`, `moderation:ban`, and `moderation:chat_message:manage`.

All initial connection, reconnect, device-code, token-validation, and refresh paths must use the same canonical scope sets. A reconnect requests every currently missing StreamFusion scope in one consent flow and explains what the additional permissions enable.

### Recent Chat Messages

- Label the section `Recent in this chat`.
- Show up to 10 transient messages StreamFusion observed in the current Channel during the current live-chat session.
- Include:
  - messages authored by the selected chatter;
  - replies addressed to the selected chatter;
  - each row's true author.
- Reuse the normal rich chat renderer, including timestamps, badges, emotes, links, reply context, and the current deleted-message display preference.
- Keep the section visible with `No recent messages in this chat` when empty.
- Update matching messages live while the dialog is open and automatically scroll to the new entry.
- Respect reduced-motion preferences when scrolling.
- Keep the explicitly selected message pinned in the selected-message footer even if it leaves the visible capped list.
- Never allow live insertion or pruning to retarget Reply, Copy, or Delete.

### Public actions

Use a selected-message footer with:

- `Reply`
  - hidden for Guest viewers;
  - visible but disabled with the exact shared Chat Send Eligibility reason for authenticated viewers who cannot currently send;
  - closes the dialog and focuses the composer with reply context when selected.
- `Copy`
  - copies only visible message content;
  - converts emotes to their names;
  - excludes timestamp and username;
  - keeps the dialog open and confirms success.
- `Translate`
  - visible but disabled;
  - labelled `Coming Soon`.
- `View Channel`
  - navigates to the selected chatter's Channel inside StreamFusion and closes the dialog;
  - shows `Couldn’t verify · Retry` when the internal Channel cannot be resolved.
- A secondary icon-only external-link control
  - opens the corresponding Twitch or Kick page independently of internal Channel resolution;
  - has an accessible name and tooltip.

When no message is selected, hide selection-dependent Reply and Copy actions.

### Moderation

- Hide the Moderation section until the authenticated viewer's current-Channel authority is positively confirmed.
- Ordinary viewers and Guests never see moderation tools or Moderation history.
- A confirmed moderator or broadcaster with missing scopes sees a locked `Reconnect <Platform>` state.
- Unknown, stale, or unverifiable current moderation state shows `Couldn’t verify · Retry` and exposes no active actions.
- Use the authenticated moderator's identity for Platform mutations; never substitute the Channel/broadcaster ID unless that viewer is actually the broadcaster.
- Show only actions valid for the target's current state. Never show contradictory actions such as Ban and Unban together.
- `Delete` is available only when the selected item is an undeleted message authored by the profile user.
- Timeout:
  - use `10s`, `1m`, `10m`, `30m`, `24h`, and `7d`, plus Custom;
  - filter presets against the active Platform's supported limits;
  - validate Custom against documented minimum/maximum values;
  - prefer `10m` as the default when supported;
  - show an optional reason only when the Platform can submit it.
- Confirmation severity:
  - Timeout confirms through its duration flow;
  - Ban and Delete require explicit destructive confirmation;
  - Unban acts immediately with success/failure feedback.
- Immediately before Ban, Timeout, Unban, or Delete, revalidate the exact Channel, target user, selected message, authenticated moderator authority, and current Platform state.
- If revalidation detects a change, cancel the mutation, refresh the dialog, and require a new deliberate action.
- While a mutation is pending:
  - prevent duplicate submission;
  - block Escape, outside-click, and Close;
  - expose a visible and accessible progress state.
- On success:
  - keep the dialog open;
  - refresh profile/action state and Moderation history;
  - show a brief success toast.
- On failure:
  - keep the dialog open;
  - preserve entered values;
  - show the exact safe Platform error inline;
  - offer Retry.

### Moderation history

- Title the section `Moderation history`.
- Add the coverage qualifier `Platform actions available to StreamFusion`.
- Show the five newest available Platform-originated records with action, duration/reason when present, acting moderator, and date.
- Provide `View all in Mod Dashboard`.
- Show `No moderation actions available` only after a verified empty result.
- Show `Couldn’t load · Retry` for failure.
- Do not present missing authorization, a partial query, or unavailable event coverage as a verified empty result.
- Do not claim the section is a complete Platform archive.

### Layout, icons, and accessibility

- Retain the centered dialog interaction model.
- Target approximately 560px width and at most 80% of viewport height.
- Use a fixed profile header and action footer around one scrolling body.
- In compact windows, expand to nearly the available viewport while preserving the same dialog structure and safe viewport gutters.
- Use the existing Lucide family beside section headings and text-labelled actions.
- Keep only Close and the secondary external-link control icon-only, with accessible names and tooltips.
- Late-loading content never steals focus.
- Announce errors, reconnect prompts, and pending-operation state through appropriate polite live regions.
- Normal close restores focus to the username that opened the dialog. If that virtualized element no longer exists, restore focus to the nearest stable chat container.
- Reply deliberately moves focus to the composer.
- Reconnect keeps the dialog open but locked. Success refreshes affected content; cancel/failure restores the prior state with Retry.
- Confirmation input may be dismissed before submission. Post-success refresh does not block closing.

### Development surfaces

- Render the same dialog component and states in Electron development and the browser-only development harness.
- Keep production Electron-only.
- Browser development parity exists for visual inspection and debugging; it does not create a separate web product or alternate UI.

## User Stories

- As any viewer, I can select a chatter and understand who they are without seeing controls I cannot use.
- As a Guest, I can inspect identity, badges, dates, and Recent Chat Messages without seeing Reply or moderation tools.
- As an authenticated viewer, I can Reply when eligible or understand the exact Channel restriction when I am not.
- As a viewer, I can distinguish a confirmed non-follow relationship from unavailable Platform data.
- As a viewer, I can inspect rich recent conversation context without mistaking replies from other people as messages authored by the selected chatter.
- As a viewer, live message updates never silently change which message my footer actions target.
- As a moderator or broadcaster, I see only moderation actions that are valid for my current authority and the chatter's current state.
- As a moderator with missing permissions, I can reconnect once for all missing StreamFusion scopes and continue in the same dialog.
- As a moderator, destructive actions are revalidated immediately before execution so stale UI cannot authorize the wrong mutation.
- As a keyboard or assistive-technology user, I can operate the dialog without unexpected focus changes and receive meaningful loading/error announcements.
- As a developer, I can inspect the same UI in the browser development harness while production remains Electron-only.

## Implementation Decisions

- Keep `Recent Chat Messages` as the canonical domain term. It is current-Channel/current-session data, not message history, Chat Replay, or a Platform archive.
- Reuse the existing centered `UserPopout` surface and normal message renderer rather than building a separate profile page or bottom sheet.
- Separate public profile/actions from the permission-gated Moderation section in component structure and state.
- Model field results explicitly: loading, known, confirmed-negative, reconnect-required, unavailable/retry, and error/retry.
- Reuse the existing Chat Send Eligibility source and restriction copy. Do not duplicate eligibility rules in the dialog.
- Keep selected-message identity independent of the capped live Recent Chat Messages collection.
- Treat Platform APIs/events as the origin of moderation data; local SQLite is the persistence/display layer.
- Keep undocumented first-party data fallbacks isolated behind validated Platform adapters and never describe their fields as official Public API guarantees.
- Correlate every destructive-action revalidation response to a unique action attempt and its Channel/user/message tuple.
- Sanitize Platform errors before rendering them; never expose credentials, raw requests, or sensitive implementation details.
- No ADR is required: these are feature-level, reversible interaction and adapter decisions, and the unstable fallback choice is deliberately isolated to reduce reversal cost.

## Testing Decisions

Drive implementation acceptance criteria one at a time through the repository's TDD workflow.

Required coverage:

- Unit tests for explicit field-state mapping, source precedence, follow-state truthfulness, badge-set selection, timeout filtering/validation, error sanitization, and scope-set composition.
- Component tests for Guest, authenticated-ineligible, ordinary viewer, confirmed moderator, missing-scope moderator, loading, empty, unavailable, and failure states.
- Selection tests proving that live insertions and 10-message pruning never retarget Reply, Copy, or Delete.
- Rendering tests for full rich messages, four-badge row cap, header badge overflow/empty/error states, true reply authorship, and deleted-message preferences.
- Accessibility tests for dialog semantics, keyboard navigation, tooltips, polite announcements, focus restoration, Reply composer focus, reduced motion, and blocked dismissal during submitted work.
- Moderation integration tests for current-state revalidation, stale-state cancellation, authenticated moderator ID use, duplicate-submit prevention, success refresh, inline failure/Retry, and exact-message deletion eligibility.
- Auth tests proving initial connect and every reconnect/device-code/token path request and validate the same canonical Platform scope set.
- Platform-adapter contract tests with validated fixtures for official responses/events and first-party fallback schema drift.
- Browser-development parity checks for the same component states.
- Final running-app proof in Electron using Electron MCP; browser verification does not replace Electron verification for this desktop UI.
- Lint, type-check, relevant tests, React diagnostics, and production build must pass before completion.

## Out of Scope

- Translation implementation; only the disabled `Coming Soon` control is included.
- Persistent, cross-session, cross-Channel, or server-fetched chatter message history.
- Banner artwork or profile bio.
- A complete Platform moderation archive where no such API exists.
- Guessing or estimating unavailable account/follow dates.
- A separate web production build; production remains Electron-only.
- A new Reply transport or Kick `chat:write` integration; Reply reuses the existing send path.
- Broad Mod Dashboard redesign beyond linking to its existing full history view.
- Additional moderator role-management tools not valid for the selected chatter's current state.

## Further Notes

- Source grill: [notes.md](notes.md)
- Approved visual references:
  - [public actions comparison](designs/public-actions-comparison.html)
  - [profile header comparison](designs/profile-header-comparison.html)
  - [dialog size and scroll comparison](designs/dialog-size-scroll-comparison.html)
  - [approved icon treatment](designs/dialog-icons-mockup.html)
- Live official Platform documentation was audited during the grill on 2026-07-26 and 2026-07-27. Recheck unstable endpoints, scopes, timeout limits, and first-party fallback schemas during implementation.
- Remaining work is implementation validation, not unresolved product direction.
