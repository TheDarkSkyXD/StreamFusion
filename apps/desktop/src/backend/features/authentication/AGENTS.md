# Authentication feature (main process)

This feature owns OAuth, account identity, token policy, and account-follow synchronization. Routes are thin IPC entry points; provider and Electron work belongs in `adapters/`; token and follow policy belongs in `domain/`; `composition/` only wires collaborators.

Keep the Kick OAuth and website-chat credential families separate. A refresh failure may clear OAuth state but must not clear Kick website cookies or the chat bearer. Only explicit logout clears both. The Kick Worker owns its client secret; never expose it to Electron or the renderer. Twitch raw tokens remain in main except the narrowly allowlisted renderer IRC/Hermes bridge.

Kick uses PKCE and validates callback state. Use the existing single-flight refresh/session services; do not cache access-token strings outside persistent credential storage.
