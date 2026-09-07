# Shared IPC infrastructure

Feature IPC registrations belong in `backend/features/<feature>/routes/`. Keep this directory for the central registrar, sender-origin enforcement, and compatibility handlers that are genuinely cross-feature.

Every IPC channel is declared in `shared/ipc-channels.ts`. Routes validate sender origin before credentials, persistent writes, provider mutations, or window control; invoke a workflow; and map its result. They must not contain business policy or renderer code.

Use `MainRendererPort` for main-to-renderer notifications. Do not capture a long-lived `BrowserWindow`, use raw channel strings, or import a main adapter in frontend code.
