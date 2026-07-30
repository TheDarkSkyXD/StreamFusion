import { useCallback, useEffect, useMemo, useState } from "react";

import { selectedModerationDevelopmentFixture } from "@/dev-relay/moderation-browser-fixtures";
import { KICK_APP_SCOPES, type Platform, TWITCH_APP_SCOPES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";
import {
  type KickAuthoritySnapshot,
  useModeratedChannelsStore,
} from "@/store/moderated-channels-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

export const MODERATION_AUTHORITY_FRESH_MS = 5 * 60_000;

type ConfirmedRole = "broadcaster" | "moderator";
type AuthoritySource =
  | "twitch-authenticated-broadcaster"
  | "twitch-moderated-channels"
  | "kick-authenticated-broadcaster"
  | "kick-channel-me"
  | "development-fixture";

export type AuthorityCheck =
  | { state: "guest" }
  | { state: "checking" }
  | {
      state: "confirmed-viewer";
      verifiedAt: number;
      expiresAt: number;
      source: AuthoritySource;
    }
  | {
      state: "confirmed";
      role: ConfirmedRole;
      verifiedAt: number;
      expiresAt: number;
      source: AuthoritySource;
    }
  | {
      state: "unverifiable";
      reason: "stale" | "authorization" | "network" | "invalid-response" | "partial";
    };

export type ModerationAuthorityState =
  | { state: "hidden" }
  | { state: "checking" }
  | { state: "unverifiable"; retry: () => void }
  | {
      state: "reconnect-required";
      role: ConfirmedRole;
      missingScopes: string[];
      reconnect: () => void;
    }
  | { state: "authorized"; role: ConfirmedRole; refresh: () => void };

interface ScopeCheck {
  key: string;
  state: "checking" | "confirmed" | "unverifiable";
  missingScopes: string[];
}

function canonicalScopes(platform: Platform): readonly string[] {
  return platform === "twitch" ? TWITCH_APP_SCOPES : KICK_APP_SCOPES;
}

function mapTwitchFailureReason(
  reason: "authorization" | "network" | "invalid-response" | "page-cap"
): Extract<AuthorityCheck, { state: "unverifiable" }>["reason"] {
  return reason === "page-cap" ? "partial" : reason;
}

function resolveAuthorityCheck(input: {
  platform: Platform;
  channelId: string;
  channelSlug: string;
  now: number;
  forceModRole: boolean;
  twitchUser: ReturnType<typeof useAuthStore.getState>["twitchUser"];
  kickUser: ReturnType<typeof useAuthStore.getState>["kickUser"];
  twitchAuthority: ReturnType<typeof useModeratedChannelsStore.getState>["twitchAuthority"];
  twitchModeratedChannelIds: Set<string>;
  kickAuthority?: KickAuthoritySnapshot;
}): AuthorityCheck {
  if (input.forceModRole) {
    return {
      state: "confirmed",
      role: "moderator",
      verifiedAt: input.now,
      expiresAt: input.now + MODERATION_AUTHORITY_FRESH_MS,
      source: "development-fixture",
    };
  }

  if (input.platform === "twitch") {
    if (!input.twitchUser) return { state: "guest" };
    if (input.twitchUser.id === input.channelId) {
      return {
        state: "confirmed",
        role: "broadcaster",
        verifiedAt: input.now,
        expiresAt: input.now + MODERATION_AUTHORITY_FRESH_MS,
        source: "twitch-authenticated-broadcaster",
      };
    }

    const snapshot = input.twitchAuthority;
    if (snapshot.state === "idle" || snapshot.state === "loading") return { state: "checking" };
    if (snapshot.state === "failed" || snapshot.state === "partial") {
      return {
        state: "unverifiable",
        reason: snapshot.state === "partial" ? "partial" : mapTwitchFailureReason(snapshot.reason),
      };
    }
    if (input.now - snapshot.checkedAt >= MODERATION_AUTHORITY_FRESH_MS) {
      return { state: "unverifiable", reason: "stale" };
    }
    const common = {
      verifiedAt: snapshot.checkedAt,
      expiresAt: snapshot.checkedAt + MODERATION_AUTHORITY_FRESH_MS,
      source: "twitch-moderated-channels" as const,
    };
    return input.twitchModeratedChannelIds.has(input.channelId)
      ? { state: "confirmed", role: "moderator", ...common }
      : { state: "confirmed-viewer", ...common };
  }

  if (!input.kickUser) return { state: "guest" };
  const normalizedSlug = input.channelSlug.trim().toLowerCase();
  if (
    String(input.kickUser.id) === input.channelId ||
    input.kickUser.slug.toLowerCase() === normalizedSlug ||
    input.kickUser.username.toLowerCase() === normalizedSlug
  ) {
    return {
      state: "confirmed",
      role: "broadcaster",
      verifiedAt: input.now,
      expiresAt: input.now + MODERATION_AUTHORITY_FRESH_MS,
      source: "kick-authenticated-broadcaster",
    };
  }

  const snapshot = input.kickAuthority;
  if (!snapshot) return { state: "checking" };
  if (snapshot.state === "failed") {
    return { state: "unverifiable", reason: snapshot.reason };
  }
  if (input.now - snapshot.checkedAt >= MODERATION_AUTHORITY_FRESH_MS) {
    return { state: "unverifiable", reason: "stale" };
  }
  const common = {
    verifiedAt: snapshot.checkedAt,
    expiresAt: snapshot.checkedAt + MODERATION_AUTHORITY_FRESH_MS,
    source: snapshot.source,
  };
  return snapshot.isModerator
    ? { state: "confirmed", role: "moderator", ...common }
    : { state: "confirmed-viewer", ...common };
}

export function useModerationAuthority(
  platform: Platform,
  channelId: string,
  channelSlug: string
): ModerationAuthorityState {
  const twitchUser = useAuthStore((state) => state.twitchUser);
  const kickUser = useAuthStore((state) => state.kickUser);
  const twitchAuthority = useModeratedChannelsStore((state) => state.twitchAuthority);
  const twitchModeratedChannelIds = useModeratedChannelsStore(
    (state) => state.twitchModeratedChannelIds
  );
  const kickAuthority = useModeratedChannelsStore((state) =>
    state.kickAuthorityBySlug.get(channelSlug.trim().toLowerCase())
  );
  const hydrateTwitch = useModeratedChannelsStore((state) => state.hydrate);
  const setKickAuthorityResult = useModeratedChannelsStore((state) => state.setKickAuthorityResult);
  const forceModRole = useDevModOverrideStore((state) => state.forceModRole);
  const forceModScopes = useDevModOverrideStore((state) => state.forceModScopes);
  const developmentFixture = selectedModerationDevelopmentFixture(window.location.search);
  const [scopeRevision, setScopeRevision] = useState(0);
  const [authorityClock, setAuthorityClock] = useState(() => Date.now());
  const [expiredAuthorityProof, setExpiredAuthorityProof] = useState("");

  const authority = useMemo(() => {
    return resolveAuthorityCheck({
      platform,
      channelId,
      channelSlug,
      now: Math.max(Date.now(), authorityClock),
      forceModRole,
      twitchUser,
      kickUser,
      twitchAuthority,
      twitchModeratedChannelIds,
      kickAuthority,
    });
  }, [
    authorityClock,
    channelId,
    channelSlug,
    forceModRole,
    kickAuthority,
    kickUser,
    platform,
    twitchAuthority,
    twitchModeratedChannelIds,
    twitchUser,
  ]);

  const fixtureUserId =
    developmentFixture && developmentFixture !== "hidden" ? "fixture-moderator" : undefined;
  const signedInUserId =
    platform === "twitch"
      ? (twitchUser?.id ?? fixtureUserId)
      : kickUser
        ? String(kickUser.id)
        : fixtureUserId;
  const authorityProof =
    authority.state === "confirmed" || authority.state === "confirmed-viewer"
      ? authority.source === "twitch-authenticated-broadcaster" ||
        authority.source === "kick-authenticated-broadcaster"
        ? `${platform}:${channelId}:${authority.source}:${signedInUserId}:${scopeRevision}`
        : `${platform}:${channelId}:${authority.source}:${authority.verifiedAt}`
      : "";
  const scopeKey =
    authority.state === "confirmed"
      ? `${platform}:${signedInUserId}:${authority.role}:${scopeRevision}`
      : "";
  const [scopeCheck, setScopeCheck] = useState<ScopeCheck>({
    key: "",
    state: "checking",
    missingScopes: [],
  });

  useEffect(() => {
    if (
      (authority.state !== "confirmed" && authority.state !== "confirmed-viewer") ||
      !authorityProof
    ) {
      return;
    }
    const delay = Math.max(0, authority.expiresAt - Date.now());
    const timeout = setTimeout(() => {
      setExpiredAuthorityProof(authorityProof);
      setAuthorityClock(Date.now());
    }, delay);
    return () => clearTimeout(timeout);
  }, [authority, authorityProof]);

  useEffect(() => {
    if (authority.state !== "confirmed" || !signedInUserId) return;
    if (developmentFixture === "reconnect") {
      setScopeCheck({
        key: scopeKey,
        state: "confirmed",
        missingScopes: ["moderator:manage:chat_messages"],
      });
      return;
    }
    if (forceModScopes) {
      setScopeCheck({ key: scopeKey, state: "confirmed", missingScopes: [] });
      return;
    }

    let cancelled = false;
    setScopeCheck({ key: scopeKey, state: "checking", missingScopes: [] });
    void window.electronAPI.auth
      .tokenStatus(platform)
      .then((status) => {
        if (cancelled) return;
        if (
          !status.connected ||
          !status.valid ||
          (status.userId !== undefined && status.userId !== signedInUserId)
        ) {
          setScopeCheck({ key: scopeKey, state: "unverifiable", missingScopes: [] });
          return;
        }
        const granted = new Set(status.scopes ?? []);
        setScopeCheck({
          key: scopeKey,
          state: "confirmed",
          missingScopes: canonicalScopes(platform).filter((scope) => !granted.has(scope)),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setScopeCheck({ key: scopeKey, state: "unverifiable", missingScopes: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authority, developmentFixture, forceModScopes, platform, scopeKey, signedInUserId]);

  const retryAuthority = useCallback(async () => {
    if (platform === "twitch") {
      if (!twitchUser) return;
      const [token, clientId] = await Promise.all([
        window.electronAPI.auth.getToken("twitch"),
        Promise.resolve(import.meta.env.VITE_TWITCH_CLIENT_ID),
      ]);
      if (!token?.accessToken || !clientId) {
        setScopeRevision((revision) => revision + 1);
        return;
      }
      await hydrateTwitch(twitchUser.id, token.accessToken, clientId);
    } else if (kickUser) {
      const result = await window.electronAPI.kickChat.getViewerRole(channelSlug);
      const checkedAt = Date.now();
      setKickAuthorityResult(
        channelSlug,
        result.ok && result.isModerator !== null
          ? {
              state: "complete",
              isModerator: result.isModerator,
              checkedAt,
              source: "kick-channel-me",
            }
          : {
              state: "failed",
              reason:
                !result.ok && result.kind === "auth-expired"
                  ? "authorization"
                  : !result.ok && result.kind === "network"
                    ? "network"
                    : "invalid-response",
              checkedAt,
              source: "kick-channel-me",
            }
      );
    }
    setScopeRevision((revision) => revision + 1);
  }, [channelSlug, hydrateTwitch, kickUser, platform, setKickAuthorityResult, twitchUser]);

  const retry = useCallback(() => {
    void retryAuthority();
  }, [retryAuthority]);
  const reconnect = useCallback(() => {
    if (authority.state !== "confirmed" || scopeCheck.state !== "confirmed") return;
    useReconnectDialogStore.getState().open({
      platform,
      missingScopes: scopeCheck.missingScopes,
      onReconnected: retry,
    });
  }, [authority.state, platform, retry, scopeCheck]);

  if (authority.state === "guest" || authority.state === "confirmed-viewer") {
    return { state: "hidden" };
  }
  if (authority.state === "checking") return { state: "checking" };
  if (authority.state === "unverifiable") return { state: "unverifiable", retry };
  if (expiredAuthorityProof === authorityProof) {
    return { state: "unverifiable", retry };
  }
  if (scopeCheck.key !== scopeKey || scopeCheck.state === "checking") {
    return { state: "checking" };
  }
  if (scopeCheck.state === "unverifiable") {
    return { state: "unverifiable", retry };
  }
  if (scopeCheck.missingScopes.length > 0) {
    return {
      state: "reconnect-required",
      role: authority.role,
      missingScopes: scopeCheck.missingScopes,
      reconnect,
    };
  }
  return { state: "authorized", role: authority.role, refresh: retry };
}
