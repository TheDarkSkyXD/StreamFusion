import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useMultiStreamStore } from "@/features/multistream/data/multistream-store";

import { SortableStreamSlot } from "./sortable-stream-slot";
import { StreamSlot } from "./stream-slot";

export function MultiStreamGrid() {
  const { t } = useTranslation();
  const streams = useMultiStreamStore((state) => state.streams);
  const removeStream = useMultiStreamStore((state) => state.removeStream);
  const layout = useMultiStreamStore((state) => state.layout);
  const focusedStreamId = useMultiStreamStore((state) => state.focusedStreamId);
  const setFocusedStream = useMultiStreamStore((state) => state.setFocusedStream);
  const toggleMute = useMultiStreamStore((state) => state.toggleMute);
  const reorderStreams = useMultiStreamStore((state) => state.reorderStreams);
  const playbackBudget = useMultiStreamStore((state) => state.playbackBudget);
  const [wcvEnabled, setWcvEnabled] = useState<boolean | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Wrap setFocusedStream so every focus change also tells main to promote
  // the slot. The slot-controller enforces the focus-singleton invariant
  // (slice 07 audio routing — only the focused slot is unmuted).
  const focusSlot = useCallback(
    (slotId: string) => {
      setFocusedStream(slotId);
      window.electronAPI?.slot?.requestFocus(slotId).catch(() => {});
    },
    [setFocusedStream]
  );

  // Slice 06 / slice 07: Ctrl+1..6 focuses the slot at the given grid index.
  // No-op when the grid is empty or the index doesn't map to a slot. Stops
  // before reaching modifier-using shortcuts the user already trains on
  // (Ctrl+W close, Ctrl+R reload, etc. — those use webContents hot-keys).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
      const digit = Number.parseInt(event.key, 10);
      if (!Number.isInteger(digit) || digit < 1 || digit > 6) return;
      const target = streams[digit - 1];
      if (!target) return;
      event.preventDefault();
      focusSlot(target.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [streams, focusSlot]);

  // Slice 06: after a host-renderer crash + reload, the host calls main to
  // re-emit presence snapshots so slot chrome rebuilds. Idempotent — main
  // just re-fires presence-changed for every live slot.
  useEffect(() => {
    window.electronAPI?.slot?.rebindExistingSlots?.().catch(() => {
      /* main may not have any slots yet; safe to ignore */
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const slot = window.electronAPI?.slot;
    if (!slot?.isWcvEnabled) {
      setWcvEnabled(false);
      return;
    }
    slot
      .isWcvEnabled()
      .then((enabled) => {
        if (!cancelled) setWcvEnabled(enabled);
      })
      .catch(() => {
        if (!cancelled) setWcvEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = streams.findIndex((s) => s.id === active.id);
      const newIndex = streams.findIndex((s) => s.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        reorderStreams(oldIndex, newIndex);
      }
    }
  }

  if (streams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-foreground-muted)]">
        <p className="text-xl mb-4">{t("multistream.noActiveStreams")}</p>
        <p className="text-sm">{t("multistream.addStreamGetStarted")}</p>
      </div>
    );
  }

  // Layout Logic
  let gridClass = "grid gap-1 h-full w-full";

  if (layout === "focus" && focusedStreamId) {
    // Focus layout handled mainly via logic below
    gridClass = "flex flex-col h-full w-full";
  } else {
    // Grid Setup
    const count = streams.length;
    if (count === 1) gridClass += " grid-cols-1 grid-rows-1";
    else if (count === 2) gridClass += " grid-cols-2 grid-rows-1";
    else if (count <= 4) gridClass += " grid-cols-2 grid-rows-2";
    else if (count <= 6) gridClass += " grid-cols-3 grid-rows-2";
    else gridClass += " grid-cols-3 auto-rows-[minmax(180px,1fr)] overflow-y-auto";
  }

  return (
    <div className={gridClass}>
      {layout === "focus" && focusedStreamId ? (
        // Focus Mode implementation
        <>
          {/* Main Focus Stream */}
          <div className="flex-[3] min-h-0 bg-black">
            {streams
              .filter((s) => s.id === focusedStreamId)
              .map((stream) => (
                <StreamSlot
                  key={stream.id}
                  streamId={stream.id}
                  platform={stream.platform}
                  channelName={stream.channelName}
                  isMuted={stream.isMuted}
                  onRemove={() => removeStream(stream.id)}
                  onFocus={() => {}}
                  isFocused={true}
                  playbackActive
                  wcvEnabled={wcvEnabled}
                />
              ))}
          </div>
          {/* Side Bar for others */}
          <div className="flex-1 min-h-[150px] flex overflow-x-auto overflow-y-hidden border-t border-[var(--color-border)] bg-[var(--color-background-secondary)] p-1 gap-1">
            {streams
              .filter((s) => s.id !== focusedStreamId)
              .map((stream, sideRailIndex) => (
                <div key={stream.id} className="aspect-video h-full shrink-0">
                  <StreamSlot
                    streamId={stream.id}
                    platform={stream.platform}
                    channelName={stream.channelName}
                    isMuted={stream.isMuted}
                    onRemove={() => removeStream(stream.id)}
                    onFocus={() => focusSlot(stream.id)}
                    isFocused={false}
                    playbackActive={sideRailIndex < Math.max(0, playbackBudget - 1)}
                    onActivate={() => focusSlot(stream.id)}
                    wcvEnabled={wcvEnabled}
                    // Side rail scrolls horizontally — defer mount of off-screen
                    // slots until they scroll into view.
                    lazyMount
                  />
                </div>
              ))}
          </div>
        </>
      ) : (
        // Grid Mode with wrapped DndContext
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={streams.map((s) => s.id)} strategy={rectSortingStrategy}>
            {streams.map((stream, index) => (
              <SortableStreamSlot
                key={stream.id}
                id={stream.id}
                platform={stream.platform}
                channelName={stream.channelName}
                isMuted={stream.isMuted}
                onRemove={() => removeStream(stream.id)}
                onFocus={() => {
                  if (stream.isMuted) {
                    toggleMute(stream.id);
                    streams.forEach((s) => {
                      if (s.id !== stream.id && !s.isMuted) toggleMute(s.id);
                    });
                  }
                }}
                isFocused={focusedStreamId === stream.id && false}
                playbackActive={index < playbackBudget}
                onActivate={() => reorderStreams(index, 0)}
                wcvEnabled={wcvEnabled}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
