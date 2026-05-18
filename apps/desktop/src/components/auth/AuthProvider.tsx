import React from "react";

import { ReconnectForModDialog } from "@/components/auth/ReconnectForModDialog";
import { useAuthInitialize } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

interface AuthProviderProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * AuthProvider
 *
 * Initializes the authentication state when the application starts.
 * Shows a fallback (loading state) until initialization is complete.
 */
export function AuthProvider({ children, fallback }: AuthProviderProps) {
  const initialized = useAuthInitialize();
  const hydrateFollows = useFollowStore((state) => state.hydrate);
  const twitchUser = useAuthStore((state) => state.twitchUser);
  const hydrateModeratedChannels = useModeratedChannelsStore((state) => state.hydrate);
  const clearModeratedChannels = useModeratedChannelsStore((state) => state.clear);

  React.useEffect(() => {
    if (initialized && hydrateFollows) {
      hydrateFollows();
    }
  }, [initialized, hydrateFollows]);

  // Hydrate the mod-channels cache when a Twitch user is signed in; clear it
  // on logout. The Helix call fails gracefully (empty array) when the token
  // lacks `user:read:moderated_channels`, so this is safe to fire before U7's
  // scope addition lands.
  React.useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    (async () => {
      if (!twitchUser) {
        clearModeratedChannels();
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
  }, [initialized, twitchUser, hydrateModeratedChannels, clearModeratedChannels]);

  if (!initialized) {
    if (fallback) {
      return <>{fallback}</>;
    }
    // Default fallback: empty or simple spinner could go here
    // For now, we'll return null to prevent flickering uninitialized state
    return null;
  }

  return (
    <>
      {children}
      <ReconnectForModDialog />
    </>
  );
}
