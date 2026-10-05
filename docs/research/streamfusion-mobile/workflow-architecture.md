# Mobile workflow architecture

The production app constructs feature controllers in `mobile-runtime.tsx`. Screens receive controllers and capability ports. Provider adapters obtain production credentials through `AuthenticatedPlatformAccess`. Development account fixtures cannot authorize network actions.

Two independent designs compared feature-specific capability ports with one provider operations facade. The chosen design keeps chat, moderation, engagement, and multistream contracts separate. The shared access adapter checks identity, token freshness, and operation-specific scopes. This avoids migrating existing discovery readers into a broad command API.

Model the Domain shaped the explicit pending, failed, unsupported, and completed states. Separate Before Serializing Shared State shaped isolated implementation worktrees. Prove It Works requires production component interaction and outgoing request assertions. Caption verification must run the recognizer with spoken audio.

Multistream reuses existing HLS resolution, compatibility policy, and player adapters. Each player starts muted. An audio switch mutes every player before unmuting the selected player. A failed mute stops that player. Closing the workspace aborts source resolution and ends its players. Android low-memory and severe thermal observations reject new admissions. The limit is at most four streams and is a local safeguard, not qualified device capacity.

Twitch chat sends through [Send Chat Message](https://dev.twitch.tv/docs/api/reference/#send-chat-message). Broadcaster polls and predictions use the documented [Twitch API](https://dev.twitch.tv/docs/api/reference/). Viewer votes and prediction wagers open the channel on the provider because those actions have no supported REST endpoint. Kick moderation uses the [Kick public API](https://docs.kick.com/). Unsupported provider tools disclose the limitation.

Recorded Twitch chat uses the existing compatibility approach and can fail independently of video. It does not substitute recent live messages. Offline captions use the [Vosk Android SDK](https://alphacephei.com/vosk/android) and a verified downloaded [English model](https://alphacephei.com/vosk/models). Caption input is decoded playback PCM. It does not request microphone capture.

The independent design sketches remain local at `E:/Codex/worktrees/workflows-design-a.md` and `E:/Codex/worktrees/workflows-design-b.md`. They are exploration records. This document describes the chosen implementation.
