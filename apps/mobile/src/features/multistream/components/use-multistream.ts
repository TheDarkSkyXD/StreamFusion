import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CapabilityProfile,
  RuntimeDegradationStage,
} from "@mobile/features/capability-profile/domain/capability-profile";
import type {
  AddMultistreamSource,
  MultistreamLayout,
  MultistreamRepository,
} from "../capabilities/multistream";
import { measureActiveVideoLimit } from "../domain/multistream-admission";
import {
  addMultistreamSlot,
  emptyMultistreamLayout,
  removeMultistreamSlot,
  reorderMultistreamSlot,
  setMultistreamAudioOwner,
  setMultistreamFocus,
  setMultistreamMode,
  slotFromAddSource,
} from "../domain/multistream-layout";
import type { MultistreamPlayback } from "../domain/multistream-playback";
import type { WatchChatSession } from "@mobile/features/chat/capabilities/watch-chat";
import { useWatchChat } from "@mobile/features/chat/components/use-watch-chat";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import {
  composeMultistreamView,
  MULTISTREAM_CHAT_DETAIL,
  type MultistreamConfirm,
} from "../domain/multistream-view";

const QUERY_KEY = ["multistream-layout"];

export function useMultistream(input: {
  readonly chat?: WatchChatSession;
  readonly nowEpochMs?: () => number;
  readonly playback: MultistreamPlayback;
  readonly profile: CapabilityProfile | null;
  readonly repository: MultistreamRepository;
  readonly slotCap?: number;
  readonly stage: RuntimeDegradationStage;
  readonly windowWidth: number;
}) {
  const client = useQueryClient();
  const now = input.nowEpochMs ?? Date.now;
  const query = useQuery({
    queryFn: async () =>
      (await input.repository.read()) ?? emptyMultistreamLayout(),
    queryKey: QUERY_KEY,
  });
  const [confirm, setConfirm] = useState<MultistreamConfirm>({ kind: "idle" });
  const [editing, setEditing] = useState(false);
  const layout = query.data ?? emptyMultistreamLayout();
  const admission = useMemo(
    () =>
      input.profile
        ? measureActiveVideoLimit(input.profile.observation)
        : { limit: 1, reason: "Device measurement is still running." },
    [input.profile],
  );
  useEffect(() => {
    void input.playback.sync({
      admission,
      layout,
      stage: input.stage,
    });
  }, [admission, input.playback, input.stage, layout]);
  const snapshot = input.playback.snapshot();
  const focused =
    layout.slots.find((slot) => slot.id === layout.focusedSlotId) ??
    layout.slots[0];
  const chatTarget: WatchTarget = focused
    ? {
        channelId: focused.channelId,
        channelName: focused.channelLogin,
        platform: focused.platform,
      }
    : { channelId: "", channelName: "", platform: "twitch" };
  const chat = useWatchChat(focused ? (input.chat ?? null) : null, chatTarget);
  const view = useMemo(
    () =>
      composeMultistreamView({
        chatDetail: focused ? chat.detail : MULTISTREAM_CHAT_DETAIL,
        confirm,
        editing,
        qualified: snapshot.qualified,
        windowWidth: input.windowWidth,
      }),
    [chat.detail, confirm, editing, focused, input.windowWidth, snapshot.qualified],
  );

  async function persist(next: MultistreamLayout): Promise<void> {
    await input.repository.write(next);
    client.setQueryData(QUERY_KEY, next);
  }

  function focusSlot(slotId: string): void {
    void persist(setMultistreamFocus(layout, slotId, now()));
  }

  return {
    add: async (source: AddMultistreamSource) => {
      const result = addMultistreamSlot(
        layout,
        slotFromAddSource(source),
        now(),
        input.slotCap,
      );
      if (result.kind === "applied") await persist(result.layout);
      return result;
    },
    cancel: () => setConfirm({ kind: "idle" }),
    closeEdit: () => setEditing(false),
    confirm: async () => {
      if (confirm.kind === "remove") {
        await persist(removeMultistreamSlot(layout, confirm.slotId, now()));
      } else if (confirm.kind === "clear") {
        await persist(emptyMultistreamLayout(now()));
      }
      setConfirm({ kind: "idle" });
    },
    edit: () => setEditing(true),
    focus: focusSlot,
    layout,
    pip: () => {
      void input.playback.enterPictureInPicture();
    },
    remove: (slotId: string) => setConfirm({ kind: "remove", slotId }),
    reorder: (slotId: string, direction: "down" | "up") => {
      void persist(reorderMultistreamSlot(layout, slotId, direction, now()));
    },
    requestClear: () => setConfirm({ kind: "clear" }),
    restore: focusSlot,
    setAudioOwner: (slotId: string) => {
      const result = setMultistreamAudioOwner(
        layout,
        slotId,
        new Set(snapshot.qualified.activeSlotIds),
        now(),
      );
      if (result.kind === "applied") void persist(result.layout);
    },
    toggleMode: () => {
      void persist(
        setMultistreamMode(
          layout,
          layout.mode === "grid" ? "focus" : "grid",
          now(),
        ),
      );
    },
    view,
  };
}
