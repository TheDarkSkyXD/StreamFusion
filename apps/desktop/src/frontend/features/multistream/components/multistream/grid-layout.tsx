import { getSlotController } from "@/features/multistream/composition/slot-controller";
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

import { useMultiStreamStore } from "@/features/multistream/components/state/multistream-store";

import { AspectAwareStreamGrid, type StreamGridPresentation } from "./adaptive-stream-grid";
import { SortableStreamSlot } from "./sortable-stream-slot";

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
  const renderedStreams = streams.toSorted((left, right) => left.id.localeCompare(right.id));

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const focusSlot = useCallback(
    (slotId: string) => {
      setFocusedStream(slotId);
      getSlotController()?.requestFocus(slotId).catch(() => {});
    },
    [setFocusedStream]
  );

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

  useEffect(() => {
    getSlotController()?.rebindExistingSlots?.().catch(() => {
      /* main may not have any slots yet; safe to ignore */
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const slot = getSlotController();
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
    if (layout === "focus") return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = streams.findIndex((stream) => stream.id === active.id);
    const newIndex = streams.findIndex((stream) => stream.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) reorderStreams(oldIndex, newIndex);
  }

  if (streams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-foreground-muted)]">
        <p className="text-xl mb-4">{t("multistream.noActiveStreams")}</p>
        <p className="text-sm">{t("multistream.addStreamGetStarted")}</p>
      </div>
    );
  }

  const focusedStreamIndex = streams.findIndex((stream) => stream.id === focusedStreamId);
  const isFocusLayout = layout === "focus" && focusedStreamIndex >= 0;
  const visualOrder = renderedStreams.map((stream) =>
    streams.findIndex((candidate) => candidate.id === stream.id)
  );
  const presentation: StreamGridPresentation = isFocusLayout
    ? { kind: "focus", focusedIndex: focusedStreamIndex, visualOrder }
    : { kind: "grid", visualOrder };
  const sortableSlots = renderedStreams.map((stream, renderIndex) => {
    const visualIndex = visualOrder[renderIndex];
    const isFocused = isFocusLayout && visualIndex === focusedStreamIndex;
    const sideRailIndex = visualIndex < focusedStreamIndex ? visualIndex : visualIndex - 1;
    const playbackActive = isFocusLayout
      ? isFocused || sideRailIndex < Math.max(0, playbackBudget - 1)
      : visualIndex < playbackBudget;

    return (
      <SortableStreamSlot
        key={stream.id}
        id={stream.id}
        platform={stream.platform}
        channelName={stream.channelName}
        isMuted={stream.isMuted}
        onRemove={() => removeStream(stream.id)}
        onFocus={() => {
          if (isFocusLayout) {
            if (!isFocused) focusSlot(stream.id);
            return;
          }
          if (stream.isMuted) {
            toggleMute(stream.id);
            streams.forEach((candidate) => {
              if (candidate.id !== stream.id && !candidate.isMuted) toggleMute(candidate.id);
            });
          }
        }}
        isFocused={isFocused}
        playbackActive={playbackActive}
        onActivate={() => {
          if (isFocusLayout) focusSlot(stream.id);
          else reorderStreams(visualIndex, 0);
        }}
        wcvEnabled={wcvEnabled}
        lazyMount={isFocusLayout && !isFocused}
        sortableDisabled={isFocusLayout}
        placementKey={
          isFocusLayout ? (isFocused ? "focused" : `rail:${sideRailIndex}`) : `grid:${visualIndex}`
        }
      />
    );
  });

  return (
    <div className="h-full w-full">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={streams.map((stream) => stream.id)} strategy={rectSortingStrategy}>
          <AspectAwareStreamGrid presentation={presentation}>{sortableSlots}</AspectAwareStreamGrid>
        </SortableContext>
      </DndContext>
    </div>
  );
}
