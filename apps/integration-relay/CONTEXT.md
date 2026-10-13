# StreamFusion Integration Relay

The Integration Relay is the trusted hosted boundary for operations that an installed Android client cannot safely or reliably perform.

## Responsibilities

- Serve narrow signed-out Platform reads backed by protected app credentials.
- Verify Platform webhooks and manage their subscriptions.
- Fan out foreground Kick chat without storing chat history.
- Serve signed Capability Manifests without holding their signing key.
- Report relay health and compatibility status.

## Boundaries

- Android calls documented signed-in Platform APIs directly with the user's credentials.
- The relay never receives or stores user Platform access or refresh tokens.
- Mobile owns device data. Relay records are minimal projections with explicit reconciliation rules.
- Provider SDKs and Cloudflare bindings stay in relay adapters. Transport code uses public core relay contracts.
- Development and production use different Worker names, configuration markers, resources, secrets, and data.

Live notification checks run on each Android device from public Twitch and Kick reads. The relay does not register push tokens, poll follows, or send FCM notifications. The existing `INSTALLATION_REGISTRY` D1 binding remains for installation credentials and relay rate limits. Production still requires its own provisioned registry.
