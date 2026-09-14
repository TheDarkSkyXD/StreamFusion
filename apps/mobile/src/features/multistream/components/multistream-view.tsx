import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ComponentType } from "react";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { PlayerSurfaceProps } from "@mobile/features/watch/components/watch-screen";
import type { MultistreamSlot } from "../capabilities/multistream";
import {
  tabletMultistreamColumns,
  type MultistreamView as MultistreamViewModel,
} from "../domain/multistream-view";
import { MultistreamSlotCard } from "./multistream-slot";

export function MultistreamView({
  onAdd,
  onAudioOwner,
  onCancel,
  onClear,
  onCloseEdit,
  onConfirm,
  onCoolDevice,
  onEdit,
  onFocus,
  onMode,
  onPip,
  onRemove,
  onReorder,
  onRestore,
  PlayerSurface,
  view,
  windowWidth,
}: {
  readonly onAdd: () => void;
  readonly onAudioOwner: (slotId: string) => void;
  readonly onCancel: () => void;
  readonly onClear: () => void;
  readonly onCloseEdit: () => void;
  readonly onConfirm: () => void;
  readonly onCoolDevice: () => void;
  readonly onEdit: () => void;
  readonly onFocus: (slotId: string) => void;
  readonly onMode: () => void;
  readonly onPip: () => void;
  readonly onRemove: (slotId: string) => void;
  readonly onReorder: (slotId: string, direction: "down" | "up") => void;
  readonly onRestore: (slotId: string) => void;
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly view: MultistreamViewModel;
  readonly windowWidth: number;
}) {
  const columns = tabletMultistreamColumns(windowWidth);
  const configured = view.cells.flatMap((cell) =>
    cell.kind === "configured" ? [cell.slot] : [],
  );
  const restoreId = configured.at(-1)?.id;
  return (
    <View style={styles.screen} testID="screen-multi">
      <Text accessibilityRole="header" selectable style={styles.title}>
        {view.title}
      </Text>
      {view.notice ? (
        <Text selectable style={styles.notice} testID="multistream-notice">
          {view.notice}
        </Text>
      ) : null}
      <View style={styles.toolbar}>
        <Action label="Edit" onPress={onEdit} testID="multistream-edit" />
        <Action label="Add slot" onPress={onAdd} testID="multistream-add" />
        <Action
          label={view.mode === "grid" ? "Focus mode" : "Grid mode"}
          onPress={onMode}
          testID="set-multistream-mode"
        />
        <Action label="PiP" onPress={onPip} testID="multistream-pip" />
      </View>
      <View style={styles.grid}>
        {view.cells.map((cell) => (
          <MultistreamSlotCard
            cell={cell}
            columns={columns}
            key={cell.kind === "empty" ? `empty-${cell.index}` : cell.slot.id}
            onAudioOwner={onAudioOwner}
            onFocus={onFocus}
            onRemove={onRemove}
            PlayerSurface={PlayerSurface}
          />
        ))}
      </View>
      <Text selectable style={styles.body} testID="multistream-chat">
        {view.chatDetail}
      </Text>
      <Text selectable style={styles.body} testID="multistream-captions">
        {view.captionDetail}
      </Text>
      <View style={styles.toolbar}>
        <Action label="Cool device" onPress={onCoolDevice} testID="cool-device" />
        {restoreId ? (
          <Action
            label="Restore slot"
            onPress={() => onRestore(restoreId)}
            testID="restore-slot"
          />
        ) : null}
      </View>
      {view.editing ? (
        <EditSheet
          onAdd={onAdd}
          onClear={onClear}
          onClose={onCloseEdit}
          onReorder={onReorder}
          slots={configured}
        />
      ) : null}
      {view.confirm.kind !== "idle" ? (
        <ConfirmSheet
          onCancel={onCancel}
          onConfirm={onConfirm}
          title={
            view.confirm.kind === "clear"
              ? "Clear this Multistream room?"
              : "Remove this configured slot?"
          }
        />
      ) : null}
    </View>
  );
}

function Action({
  label,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <Text selectable style={styles.actionLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function EditSheet({
  onAdd,
  onClear,
  onClose,
  onReorder,
  slots,
}: {
  readonly onAdd: () => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
  readonly onReorder: (slotId: string, direction: "down" | "up") => void;
  readonly slots: readonly MultistreamSlot[];
}) {
  return (
    <View style={styles.sheet} testID="multistream-edit-sheet">
      <Text selectable style={styles.title}>
        Configured slots
      </Text>
      {slots.map((slot, index) => (
        <View key={slot.id} style={styles.editRow}>
          <Text selectable style={styles.body}>
            {`${index + 1}. ${slot.displayName}`}
          </Text>
          <Action
            label="Up"
            onPress={() => onReorder(slot.id, "up")}
            testID={`reorder-multistream-slot-up-${slot.id}`}
          />
          <Action
            label="Down"
            onPress={() => onReorder(slot.id, "down")}
            testID={`reorder-multistream-slot-down-${slot.id}`}
          />
        </View>
      ))}
      <Action label="Add from Search" onPress={onAdd} testID="add-multistream-slot" />
      <Action label="Clear room" onPress={onClear} testID="clear-multistream" />
      <Action label="Done" onPress={onClose} testID="close-multistream-edit" />
    </View>
  );
}

function ConfirmSheet({
  onCancel,
  onConfirm,
  title,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
}) {
  return (
    <View style={styles.sheet} testID="multistream-confirm">
      <Text selectable style={styles.title}>
        {title}
      </Text>
      <View style={styles.toolbar}>
        <Action label="Cancel" onPress={onCancel} testID="cancel-multistream" />
        <Action label="Confirm" onPress={onConfirm} testID="confirm-multistream" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: 96,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
  },
  notice: {
    color: mobileColors.textCategory,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  body: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  action: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  pressed: { opacity: 0.86 },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  sheet: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  editRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
});
