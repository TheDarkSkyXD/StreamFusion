import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ComponentType } from "react";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { PlayerSurfaceProps } from "@mobile/features/watch/components/watch-screen";
import type { MultistreamSlotPhase } from "../capabilities/multistream";
import type { MultistreamCell } from "../domain/multistream-view";

export function MultistreamSlotCard({
  cell,
  columns,
  onAudioOwner,
  onFocus,
  onRemove,
  PlayerSurface,
}: {
  readonly cell: MultistreamCell;
  readonly columns: 1 | 2 | 3;
  readonly onAudioOwner: (slotId: string) => void;
  readonly onFocus: (slotId: string) => void;
  readonly onRemove: (slotId: string) => void;
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
}) {
  const widthPercent = cellWidth(columns);
  if (cell.kind === "empty") {
    return (
      <View
        style={[styles.cell, { width: widthPercent }]}
        testID={`multistream-slot-empty-${cell.index}`}
      >
        <Text selectable style={styles.meta}>
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
            <Text selectable style={styles.meta}>
              {label}
            </Text>
          </View>
        )}
      </Pressable>
      <Text selectable style={styles.name}>
        {cell.slot.displayName}
      </Text>
      <Text selectable style={styles.meta}>
        {`${cell.slot.platform === "twitch" ? "TWITCH" : "KICK"} · ${label}`}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityHint="Makes this eligible active slot the one audio owner"
          accessibilityLabel="Audio owner"
          accessibilityRole="button"
          accessibilityState={{ disabled: cell.phase !== "active" }}
          disabled={cell.phase !== "active"}
          onPress={() => onAudioOwner(cell.slot.id)}
          style={[styles.action, cell.audioOwner ? styles.actionOn : null]}
          testID={`audio-owner-${cell.slot.id}`}
        >
          <Text
            selectable
            style={[
              styles.actionLabel,
              cell.audioOwner ? styles.actionLabelOn : null,
            ]}
          >
            {cell.audioOwner ? "Audio" : "Set audio"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityHint="Asks before removing this configured slot"
          accessibilityLabel="Remove slot"
          accessibilityRole="button"
          onPress={() => onRemove(cell.slot.id)}
          style={styles.action}
          testID={`remove-multistream-slot-${cell.slot.id}`}
        >
          <Text selectable style={styles.actionLabel}>
            Remove
          </Text>
        </Pressable>
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
      return "Active";
    case "thumbnail":
      return "Thumbnail";
    case "paused":
      return "Paused";
    default:
      return "Retained";
  }
}

const styles = StyleSheet.create({
  cell: {
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    gap: mobileSpacing.xSmall,
    padding: mobileSpacing.small,
  },
  focused: {
    borderColor: mobileColors.textPrimary,
  },
  surface: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.small,
    overflow: "hidden",
  },
  placeholder: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  name: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  action: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  actionOn: {
    backgroundColor: mobileColors.textPrimary,
  },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  actionLabelOn: {
    color: mobileColors.background,
  },
});
