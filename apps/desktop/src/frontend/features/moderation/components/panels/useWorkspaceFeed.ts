import { useEffect, useState } from "react";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import type { ModerationFeedEvent, ModerationFeedEventType } from "@shared/moderation-types";
import { getWorkspacePanelsPort } from "../../composition/workspace-panels";
import {
  acceptsWorkspaceEvent,
  appendWorkspaceEvent,
  workspaceFeedPlan,
  type WorkspaceFeedKind,
} from "../../domain/workspace-feed";
export interface WorkspacePanelProps {
  channelId: string;
  channelName: string;
  refreshCounter?: number;
}
export type FeedState = "connecting" | "connected" | "reconnecting" | "permission" | "error";
export function useWorkspaceFeed(kind: WorkspaceFeedKind, channelId: string, refreshCounter = 0) {
  const actorId = useAuthStore((s) => s.twitchUser?.id);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<{
    state: FeedState;
    events: ModerationFeedEvent[];
    coverage: string | null;
    subscriptions: ModerationFeedEventType[];
    missingScopes: string[];
    error: string | null;
  }>({
    state: "connecting",
    events: [],
    coverage: null,
    subscriptions: [],
    missingScopes: [],
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    const port = getWorkspacePanelsPort();
    const feedId = `workspace:${kind}:${channelId}:${actorId}:${crypto.randomUUID()}`;
    setView({
      state: "connecting",
      events: [],
      coverage: null,
      subscriptions: [],
      missingScopes: [],
      error: null,
    });
    if (!actorId) {
      setView((v) => ({ ...v, state: "permission" }));
      return;
    }
    const unlisten = port.onEvent(({ feedId: received, payload }) => {
      if (
        !cancelled &&
        received === feedId &&
        acceptsWorkspaceEvent(kind, payload, actorId, channelId)
      ) {
        setView((v) => ({
          ...v,
          events: appendWorkspaceEvent(v.events, payload),
          coverage: v.events.length === 0 ? payload.coverageStartedAt : v.coverage,
        }));
      }
    });
    const unstate = port.onState(({ feedId: received, state }) => {
      if (cancelled || received !== feedId) return;
      const next: FeedState =
        state === "connecting" ||
        state === "connected" ||
        state === "reconnecting" ||
        state === "permission"
          ? state
          : "error";
      setView((v) => ({
        ...v,
        state: next,
        coverage: next === "connected" ? (v.coverage ?? new Date().toISOString()) : v.coverage,
      }));
    });
    void (async () => {
      try {
        const token = await port.tokenStatus();
        if (cancelled) return;
        if (!token.valid || token.userId !== actorId) {
          setView((v) => ({ ...v, state: "permission" }));
          return;
        }
        const plan = workspaceFeedPlan(kind, actorId === channelId, token.scopes ?? []);
        setView((v) => ({ ...v, subscriptions: plan.events, missingScopes: plan.missingScopes }));
        if (!plan.events.length) {
          setView((v) => ({ ...v, state: "permission" }));
          return;
        }
        const result = await port.startFeed({
          feedId,
          userId: actorId,
          channelId,
          eventTypes: plan.events,
        });
        if (cancelled) {
          await port.stopFeed(feedId);
          return;
        }
        if (!result.ok)
          setView((v) => ({
            ...v,
            state: result.error.code === "unavailable" ? "error" : "permission",
            error: result.error.message,
          }));
      } catch (error) {
        if (!cancelled)
          setView((v) => ({
            ...v,
            state: "error",
            error: error instanceof Error ? error.message : null,
          }));
      }
    })();
    return () => {
      cancelled = true;
      unlisten();
      unstate();
      void port.stopFeed(feedId).catch(() => undefined);
    };
  }, [kind, channelId, actorId, refreshCounter, revision]);
  return {
    ...view,
    events: view.events.filter(
      (event) => !!actorId && acceptsWorkspaceEvent(kind, event, actorId, channelId)
    ),
    retry: () => setRevision((v) => v + 1),
  };
}
