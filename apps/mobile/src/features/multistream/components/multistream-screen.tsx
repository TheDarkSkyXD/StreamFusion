import { ScrollView, useWindowDimensions } from "react-native";
import type { ComponentType } from "react";

import type {
  CapabilityProfile,
  RuntimeDegradationStage,
} from "@mobile/features/capability-profile/domain/capability-profile";
import type { PlayerSurfaceProps } from "@mobile/features/watch/components/watch-screen";
import type { MultistreamRepository } from "../capabilities/multistream";
import type { MultistreamPlayback } from "../domain/multistream-playback";
import { MultistreamView } from "./multistream-view";
import { useMultistream } from "./use-multistream";

export function MultistreamScreen({
  onAddFromSearch,
  onCoolDevice,
  playback,
  PlayerSurface,
  profile,
  repository,
  slotCap,
  stage,
}: {
  readonly onAddFromSearch: () => void;
  readonly onCoolDevice: () => void;
  readonly playback: MultistreamPlayback;
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly profile: CapabilityProfile | null;
  readonly repository: MultistreamRepository;
  readonly slotCap?: number;
  readonly stage: RuntimeDegradationStage;
}) {
  const { width } = useWindowDimensions();
  const session = useMultistream({
    playback,
    profile,
    repository,
    ...(slotCap === undefined ? {} : { slotCap }),
    stage,
    windowWidth: width,
  });
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      testID="screen-more-multistream"
    >
      <MultistreamView
        onAdd={onAddFromSearch}
        onAudioOwner={session.setAudioOwner}
        onCancel={session.cancel}
        onClear={session.requestClear}
        onCloseEdit={session.closeEdit}
        onConfirm={() => {
          void session.confirm();
        }}
        onCoolDevice={onCoolDevice}
        onEdit={session.edit}
        onFocus={session.focus}
        onMode={session.toggleMode}
        onPip={session.pip}
        onRemove={session.remove}
        onReorder={session.reorder}
        onRestore={session.restore}
        PlayerSurface={PlayerSurface}
        view={session.view}
        windowWidth={width}
      />
    </ScrollView>
  );
}
