# Twitch shared transport

Use the shared Twitch request transport for Helix and keep web GraphQL fallbacks explicit. Feature behavior belongs under its feature adapter. Browser-safe IRC, Hermes, parsing, and their lifecycle belong to `frontend/features/chat`; privileged moderation, authenticated Helix work, and EventSub stay in main-process feature adapters.

Do not mint or expose client secrets locally. Do not treat a nearby scope as authority for a new Helix endpoint; verify its exact requirements.
