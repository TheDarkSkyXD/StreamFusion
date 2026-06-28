# Twitch OAuth Scopes

**Document Name:** Twitch OAuth Scope Policy  
**Date:** June 20, 2026  
**Status:** Active

## Policy

StreamFusion requests the full current Twitch app scope set on every Twitch connect, reconnect, and device-code authorization flow.

The canonical list lives in:

```text
apps/desktop/src/shared/auth-types.ts
```

Use `TWITCH_APP_SCOPES` for the full app permission set and `TWITCH_MOD_ACTION_SCOPES` only for checking whether the current token can open the chat moderation actions that need mod scopes.

## Why

Twitch OAuth accepts scopes as a space-delimited list on the authorization request. Refreshing an existing token does not grant scopes that were not previously authorized. When StreamFusion adds a new Twitch feature that needs another scope, existing users need one reconnect consent pass. That reconnect should request the full current app set, not only the one scope that triggered the dialog, so the user does not get a chain of reconnect prompts.

Reference: [Twitch OAuth access token docs](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/).

## Connect And Reconnect Flow

1. New Twitch connect calls the normal OAuth flow.
2. Reconnect calls the same OAuth flow without logging Twitch out first, so Twitch can reuse the existing browser session.
3. `oauth-config.ts` builds the authorization URL from `TWITCH_APP_SCOPES`.
4. After reconnect, `ReconnectForModDialog` reads the stored token and verifies it contains every `TWITCH_APP_SCOPES` entry, plus any raw scope Twitch reported for the attempted action.
5. The original action retries only after that full-scope check passes.

## Adding A Twitch Feature Scope

1. Add the scope to `TWITCH_APP_SCOPES`.
2. Add or update a human-readable row in `ReconnectForModDialog` if the scope may appear in a reconnect prompt.
3. Add feature-specific missing-scope handling at the action boundary when Twitch returns a 401 missing-scope response.
4. Update tests that pin the scope contract:
   - `apps/desktop/tests/shared/auth-types.test.ts`
   - `apps/desktop/tests/backend/auth/oauth-config.test.ts`
   - Any feature-specific API or component test for the new action
5. Run focused tests, typecheck, lint, and build.

## Invariant

Do not define a second Twitch app-scope array in backend, renderer, or tests. Scope drift is the bug this policy is meant to prevent.
