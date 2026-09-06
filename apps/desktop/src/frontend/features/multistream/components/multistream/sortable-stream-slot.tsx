import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Platform } from "@streamfusion/core/platform";

import { StreamSlot, type StreamSlotPlacementKey } from "./stream-slot";

interface SortableStreamSlotProps {
  id: string; // The stream ID which will be the drag ID
  platform: Platform;
  channelName: string;
  isMuted: boolean;
  onRemove: () => void;
  onFocus: () => void;
  isFocused: boolean;
  playbackActive?: boolean;
  onActivate?: () => void;
  wcvEnabled?: boolean | null;
  lazyMount?: boolean;
  sortableDisabled?: boolean;
  placementKey?: StreamSlotPlacementKey;
}

export function SortableStreamSlot({
  id,
  platform,
  channelName,
  isMuted,
  onRemove,
  onFocus,
  isFocused,
  playbackActive,
  onActivate,
  wcvEnabled,
  lazyMount,
  sortableDisabled = false,
  placementKey,
}: SortableStreamSlotProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: sortableDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="h-full w-full">
      <StreamSlot
        streamId={id}
        platform={platform}
        channelName={channelName}
        isMuted={isMuted}
        onRemove={onRemove}
        onFocus={onFocus}
        isFocused={isFocused}
        playbackActive={playbackActive}
        onActivate={onActivate}
        wcvEnabled={wcvEnabled}
        lazyMount={lazyMount}
        placementKey={placementKey}
        dragHandleProps={sortableDisabled ? undefined : { ...attributes, ...listeners }}
      />
    </div>
  );
}
