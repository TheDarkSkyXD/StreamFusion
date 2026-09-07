# Chat feature (main process)

Main-process chat owns only privileged routes and adapters: Kick send-window lifecycle, authenticated provider mutations, and main-owned moderation operations. Every IPC mutation validates sender origin and uses `IPC_CHANNELS` constants.

Browser-safe sockets, parsers, emote providers, cache lifecycles, and their composition belong in `frontend/features/chat`. Do not import them into this tree. The renderer reaches privileged behavior only through the preload bridge.

Keep the Kick send window private to main. It owns session bearer capture and must remain separate from renderer chat connections. Do not expose raw provider credentials in IPC responses.
