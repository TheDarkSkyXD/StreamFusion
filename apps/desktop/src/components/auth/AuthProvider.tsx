import React from "react";

import { ReconnectForModDialog } from "@/components/auth/ReconnectForModDialog";
import { useAuthInitialize } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * AuthProvider
 *
 * Initializes the authentication state when the application starts.
 * Hydrates local follows immediately so the sidebar can paint from SQLite
 * while auth/token refresh continues in the background.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const initialized = useAuthInitialize();
  const hydrateFollows = useFollowStore((state) => state.hydrate);
  const twitchUser = useAuthStore((state) => state.twitchUser);
  const hydrateModeratedChannels = useModeratedChannelsStore((state) => state.hydrate);
  const clearTwitchModeratedChannels = useModeratedChannelsStore((state) => state.clearTwitch);
  const hydratedFollowsRef = React.useRef(false);

  React.useEffect(() => {
    if (!hydratedFollowsRef.current && hydrateFollows) {
      hydratedFollowsRef.current = true;
      hydrateFollows();
    }
  }, [hydrateFollows]);

  // Hydrate the mod-channels cache when a Twitch user is signed in; clear it
  // on logout. The Helix call fails gracefully (empty array) when the token
  // lacks `user:read:moderated_channels`, so this is safe to fire before U7's
  // scope addition lands.
  React.useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    (async () => {
      if (!twitchUser) {
        clearTwitchModeratedChannels();
        return;
      }
      try {
        const token = await window.electronAPI.auth.getToken("twitch");
        const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
        if (cancelled || !token?.accessToken || !clientId) return;
        await hydrateModeratedChannels(twitchUser.id, token.accessToken, clientId);
      } catch {
        // Token-read errors are tolerated; the Helix wrapper silences 401s.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialized, twitchUser, hydrateModeratedChannels, clearTwitchModeratedChannels]);

  return (
    <>
      {children}
      {initialized && <ReconnectForModDialog />}
    </>
  );
}
