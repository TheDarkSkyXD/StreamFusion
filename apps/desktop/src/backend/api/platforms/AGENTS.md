# Shared provider transport

This directory owns Kick and Twitch request transport, raw provider contracts, and cross-feature request policy. Put feature endpoint behavior, response mapping, and provider integrations in `backend/features/<feature>/adapters/{kick,twitch}`.

Use official provider APIs where they cover the behavior; isolate and label web or legacy fallback routes. Keep provider credentials in main. Browser chat sockets belong to `frontend/features/chat`; Electron-only or authenticated provider mutations remain behind main IPC.
