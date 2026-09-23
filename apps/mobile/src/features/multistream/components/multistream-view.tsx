import { StyleSheet, Text, View } from "react-native";
import type { ComponentType } from "react";

import { MobileButton } from "@mobile/design/button";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobileRadii,
  mobileShadows,
  mobileSpacing,
  mobileType,
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
      <Text selectable style={mobileType.label} testID="multistream-room-meta">
        {view.title}
      </Text>
      {view.notice ? (
        <MobileStatusPanel testID="multistream-notice" tone="info">
          <Text selectable style={mobileType.body}>
            {view.notice}
          </Text>
        </MobileStatusPanel>
      ) : null}
      <View style={styles.toolbar}>
        <MobileButton
          accessibilityLabel="Edit"
          onPress={onEdit}
          testID="multistream-edit"
          variant="secondary"
        >
          Edit
        </MobileButton>
        <MobileButton
          accessibilityLabel="Add slot"
          onPress={onAdd}
          testID="multistream-add"
          variant="secondary"
        >
          Add slot
        </MobileButton>
        <MobileButton
          accessibilityLabel={view.mode === "grid" ? "Focus mode" : "Grid mode"}
          onPress={onMode}
          testID="set-multistream-mode"
          variant="secondary"
        >
          {view.mode === "grid" ? "Focus mode" : "Grid mode"}
        </MobileButton>
        <MobileButton
          accessibilityLabel="PiP"
          onPress={onPip}
          testID="multistream-pip"
          variant="secondary"
        >
          PiP
        </MobileButton>
      </View>
      <View style={styles.grid}>
        {view.cells.map((cell) => (
          <MultistreamSlotCard
            cell={cell}
            columns={columns}
            key={cell.kind === "empty" ? `empty-${cell.index}` : cell.slot.id}
            onAdd={onAdd}
            onAudioOwner={onAudioOwner}
            onFocus={onFocus}
            onRemove={onRemove}
            PlayerSurface={PlayerSurface}
          />
        ))}
      </View>
      <View style={styles.chatPane} testID="multistream-chat">
        <Text selectable style={mobileType.title}>
          MultiChat
        </Text>
        {view.chatMessages.length > 0 ? (
          <View style={styles.chatMessages}>
            {view.chatMessages.slice(-12).map((message) => (
              <Text
                key={message.id}
                selectable
                style={mobileType.body}
                testID={`multistream-chat-line-${message.id}`}
              >
                {`${message.displayName}: ${message.text}`}
              </Text>
            ))}
          </View>
        ) : (
          <Text selectable style={mobileType.body}>
            {view.chatDetail}
          </Text>
        )}
      </View>
      <MobileStatusPanel testID="multistream-captions" tone="info">
        <Text selectable style={mobileType.body}>
          {view.captionDetail}
        </Text>
      </MobileStatusPanel>
      <View style={styles.toolbar}>
        <MobileButton
          accessibilityLabel="Cool device"
          onPress={onCoolDevice}
          testID="cool-device"
          variant="secondary"
        >
          Cool device
        </MobileButton>
        {restoreId ? (
          <MobileButton
            accessibilityLabel="Restore slot"
            onPress={() => onRestore(restoreId)}
            testID="restore-slot"
            variant="secondary"
          >
            Restore slot
          </MobileButton>
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
      <Text selectable style={mobileType.title}>
        Configured slots
      </Text>
      {slots.map((slot, index) => (
        <View key={slot.id} style={styles.editRow}>
          <Text selectable style={mobileType.body}>
            {`${index + 1}. ${slot.displayName}`}
          </Text>
          <MobileButton
            accessibilityLabel="Up"
            onPress={() => onReorder(slot.id, "up")}
            testID={`reorder-multistream-slot-up-${slot.id}`}
            variant="ghost"
          >
            Up
          </MobileButton>
          <MobileButton
            accessibilityLabel="Down"
            onPress={() => onReorder(slot.id, "down")}
            testID={`reorder-multistream-slot-down-${slot.id}`}
            variant="ghost"
          >
            Down
          </MobileButton>
        </View>
      ))}
      <MobileButton
        accessibilityLabel="Add from Search"
        onPress={onAdd}
        testID="add-multistream-slot"
        variant="secondary"
      >
        Add from Search
      </MobileButton>
      <MobileButton
        accessibilityLabel="Clear room"
        onPress={onClear}
        testID="clear-multistream"
        variant="destructive"
      >
        Clear room
      </MobileButton>
      <MobileButton
        accessibilityLabel="Done"
        onPress={onClose}
        testID="close-multistream-edit"
        variant="primary"
      >
        Done
      </MobileButton>
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
      <Text selectable style={mobileType.title}>
        {title}
      </Text>
      <View style={styles.toolbar}>
        <MobileButton
          accessibilityLabel="Cancel"
          onPress={onCancel}
          testID="cancel-multistream"
          variant="secondary"
        >
          Cancel
        </MobileButton>
        <MobileButton
          accessibilityLabel="Confirm"
          onPress={onConfirm}
          testID="confirm-multistream"
          variant="destructive"
        >
          Confirm
        </MobileButton>
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
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  chatPane: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  chatMessages: {
    gap: mobileSpacing.xSmall,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  sheet: {
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    boxShadow: mobileShadows.dialog,
    gap: mobileSpacing.small,
    padding: mobileSpacing.large,
  },
  editRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
});
