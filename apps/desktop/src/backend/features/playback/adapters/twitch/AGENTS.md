# Twitch playback adapter

Keep Helix and web GraphQL responsibilities explicit. Playback token and HLS resolver behavior is a feature adapter; it may use the shared Twitch transport but must not pull renderer chat sockets or UI state into main.
