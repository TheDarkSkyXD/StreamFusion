import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ComponentType } from "react";

import { MobileButton } from "@mobile/design/button";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { PlayerSurfaceProps } from "@mobile/features/watch/components/watch-screen";
import type { MultistreamSlotPhase } from "../capabilities/multistream";
import type { MultistreamCell } from "../domain/multistream-view";

export function MultistreamSlotCard({
  cell,
  columns,
  onAdd,
  onAudioOwner,
  onFocus,
  onRemove,
  PlayerSurface,
}: {
  readonly cell: MultistreamCell;
  readonly columns: 1 | 2 | 3;
  readonly onAdd?: () => void;
  readonly onAudioOwner: (slotId: string) => void;
  readonly onFocus: (slotId: string) => void;
  readonly onRemove: (slotId: string) => void;
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
}) {
  const widthPercent = cellWidth(columns);
  if (cell.kind === "empty") {
    if (onAdd) {
      return (
        <Pressable
          accessibilityHint="Opens Search to add a Multistream slot"
          accessibilityLabel="Add slot"
          accessibilityRole="button"
          onPress={onAdd}
          style={[styles.cell, styles.empty, { width: widthPercent }]}
          testID={`multistream-slot-empty-${cell.index}`}
        >
          <Text selectable style={mobileType.label}>
            Add slot
          </Text>
        </Pressable>
      );
    }
    return (
      <View
        style={[styles.cell, styles.empty, { width: widthPercent }]}
        testID={`multistream-slot-empty-${cell.index}`}
      >
        <Text selectable style={mobileType.label}>
          Empty slot
        </Text>
      </View>
    );
  }
  const label = phaseLabel(cell.phase);
  return (
    <View
      style={[
        styles.cell,
        cell.focused ? styles.focused : null,
        { width: widthPercent },
      ]}
      testID={`multistream-slot-${cell.slot.id}`}
    >
      <Pressable
        accessibilityHint="Makes this slot the focused Multistream stream"
        accessibilityLabel={`${cell.slot.displayName} ${label}`}
        accessibilityRole="button"
        onPress={() => onFocus(cell.slot.id)}
        style={styles.surface}
      >
        {cell.sessionId ? (
          <PlayerSurface
            sessionId={cell.sessionId}
            testID={`multistream-player-${cell.slot.id}`}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text selectable style={mobileType.label}>
              {label}
            </Text>
          </View>
        )}
      </Pressable>
      <View style={styles.heading}>
        <Text selectable style={mobileType.title}>
          {cell.slot.displayName}
        </Text>
        <MobilePlatformBadge platform={cell.slot.platform} />
      </View>
      <Text selectable style={mobileType.label}>
        {label}
      </Text>
      <View style={styles.actions}>
        <MobileButton
          accessibilityHint="Makes this eligible active slot the one audio owner"
          accessibilityLabel="Audio owner"
          disabled={cell.phase !== "active"}
          onPress={() => onAudioOwner(cell.slot.id)}
          testID={`audio-owner-${cell.slot.id}`}
          variant={cell.audioOwner ? "primary" : "secondary"}
        >
          {cell.audioOwner ? "Audio" : "Set audio"}
        </MobileButton>
        <MobileButton
          accessibilityHint="Asks before removing this configured slot"
          accessibilityLabel="Remove slot"
          onPress={() => onRemove(cell.slot.id)}
          testID={`remove-multistream-slot-${cell.slot.id}`}
          variant="secondary"
        >
          Remove
        </MobileButton>
      </View>
    </View>
  );
}

function cellWidth(columns: 1 | 2 | 3): "100%" | "50%" | "33.33%" {
  if (columns === 1) return "100%";
  if (columns === 2) return "50%";
  return "33.33%";
}

function phaseLabel(phase: MultistreamSlotPhase): string {
  switch (phase) {
    case "active":
      return "Live";
    case "thumbnail":
      return "Offline preview";
    case "paused":
      return "Paused";
    default:
      return "Offline";
  }
}

const styles = StyleSheet.create({
  cell: {
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    gap: mobileSpacing.xSmall,
    padding: mobileSpacing.small,
  },
  empty: {
    backgroundColor: mobileColors.background,
    justifyContent: "center",
    minHeight: 96,
  },
  focused: {
    backgroundColor: mobileColors.surfaceMuted,
  },
  surface: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.background,
    borderRadius: mobileRadii.medium,
    overflow: "hidden",
  },
  placeholder: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    justifyContent: "space-between",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
});
