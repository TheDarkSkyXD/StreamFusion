# Android parity record: Chat, Predictions, Integrations, API tokens Settings

- Capability IDs: `panel:chat`, `panel:predictions`, `panel:integrations`, `panel:api-tokens` (+ matching `screen:settings-*`)
- Desktop baseline: `ChatSettingsSection.tsx`; Settings tabs Predictions / Integrations / ApiTokenPanel in `Settings/index.tsx`; `ChatDisplayPreferences` + `PredictionPreferences` in `auth-types.ts`
- Android owner: Mobile `settings` (+ auth account snapshots for Integrations / API tokens)
- Progress: `implemented` (Settings panels searchable and persisted)
- Delivery: `adapted`
- Freshness: this commit on `main`

## Desktop outcome

Settings → Chat persists `chatDisplay` appearance/emote/event toggles. Predictions persists `predictions.style` (`native` | `unified`). Integrations hosts AccountConnect. API tokens shows read-only Twitch/Kick token status (never the secret).

## Android outcome

More Settings includes four panels:

1. **Chat** — mobile-appropriate density, timestamps/format, font/emote size, readable/theme username colors, 7TV/BTTV/FFZ emotes + badges/paints, animated/overlay/system emotes, message limit, recent-on-join, notices, deleted-message mode, moderation highlight, polls/predictions-in-chat. Stored as `chatDisplay.v1` with the desktop field shape.
2. **Predictions** — style `native` / `unified` as `predictions.v1`, with disclosure that the widget applies when predictions UI lands.
3. **Integrations** — guest-safe Twitch/Kick status summary + Accounts handoff (reuses auth panels; no crash when disconnected).
4. **API tokens** — read-only status derived from account session snapshots; never surfaces token values; links to Accounts/Integrations.

## Intentional skips (desktop chrome that does not apply on mobile Watch chat)

- Chat panel width (`chatWidthPct` / `chatWidthPx`) and hide-panel position — desktop docked layout.
- Hover smooth / mouseover pause modes — pointer chrome.
- Quick-emote action bar and Twitch pin-duration dialog — desktop moderation/composer chrome.
- Live chat previews and highlight-style visual cards — desktop Settings previews; mobile uses choice rows.
- Full AccountConnect embed inside Integrations — mobile opens the existing Accounts screen instead.
- IPC `tokenStatus` probe with Validate now — mobile derives status from the signed-in session snapshot.

Desktop-only fields above remain in the stored `chatDisplay` defaults for round-trip compatibility but are not exposed in the mobile UI.

## Required evidence

- Unit tests: render + save for each panel; preference round-trip; guest-safe Integrations/API tokens
- Local Settings search: `chat`, `predictions`, `integrations`, `token`
