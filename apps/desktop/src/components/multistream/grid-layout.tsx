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

import { useMultiStreamStore } from "@/store/multistream-store";

import { SortableStreamSlot } from "./sortable-stream-slot";
import { StreamSlot } from "./stream-slot";

export function MultiStreamGrid() {
  const {
    streams,
    removeStream,
    layout,
    focusedStreamId,
    setFocusedStream,
    toggleMute,
    reorderStreams,
  } = useMultiStreamStore();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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
        <p className="text-xl mb-4">No active streams</p>
        <p className="text-sm">Add a stream to get started</p>
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
    else gridClass += " grid-cols-3 grid-rows-2";
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
                  slotIndex={0}
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
                    onFocus={() => setFocusedStream(stream.id)}
                    isFocused={false}
                    // +1 so the side-rail slots stagger after the focused slot
                    slotIndex={sideRailIndex + 1}
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
                slotIndex={index}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
