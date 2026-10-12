# StreamFusion Integration Relay

The Integration Relay is the trusted hosted boundary for operations that an installed Android client cannot safely or reliably perform.

## Responsibilities

- Serve narrow signed-out Platform reads backed by protected app credentials.
- Verify Platform webhooks and manage their subscriptions.
- Fan out foreground Kick chat without storing chat history.
- Project Live Notification registrations, observe followed channels on a one-minute schedule, and retry direct FCM deliveries from D1.
- Serve signed Capability Manifests without holding their signing key.
- Report relay health and compatibility status.

## Boundaries

- Android calls documented signed-in Platform APIs directly with the user's credentials.
- The relay never receives or stores user Platform access or refresh tokens.
- Mobile owns device data. Relay records are minimal projections with explicit reconciliation rules.
- Provider SDKs and Cloudflare bindings stay in relay adapters. Transport code uses public core relay contracts.
- Development and production use different Worker names, configuration markers, resources, secrets, and data.

The scheduled handler uses the existing `INSTALLATION_REGISTRY` D1 binding. The production binding still requires independent provisioning. Registration needs protected `FCM_SERVICE_ACCOUNT_JSON` and the credentials for every followed provider in an enabled projection. Missing configuration returns unavailable. The Worker seeds live observations without alerts, then creates one installation-keyed delivery for each later live session. Pending sends expire after 15 minutes and retry for up to five attempts on later scheduled invocations. FCM acceptance before a D1 acknowledgement can cause a repeat send with the same event ID; Android deduplicates that ID before posting.

The one-minute notification schedule requires Workers Paid. Cloudflare D1 allows 1,000 queries per Paid Worker invocation and 50 on Free ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)). Each scheduled run reserves D1 queries for setup and cleanup, limits polling and claims to a 900-query planning budget, and sends at most 100 direct FCM messages in groups of four. It stops claiming new sends at its 50-second work deadline and finishes or releases work already claimed. The actual count depends on observation writes, retries, and provider latency. Unsent deliveries remain pending for a later run until their 15-minute expiry. The worker logs overdue polls and the age of due, unexpired sends as `live_notification_backlog`. This direct-send implementation has no demonstrated 100,000-recipient delivery capacity.
