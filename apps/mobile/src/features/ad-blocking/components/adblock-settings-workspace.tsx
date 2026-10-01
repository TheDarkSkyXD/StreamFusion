import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { mobileSpacing } from "@mobile/design/tokens";

import type { AdBlockSession } from "../capabilities/ad-blocking";
import type { PlaylistProxyHealth } from "../capabilities/playlist-proxy-health";
import type { TwitchPlaylistProxySession } from "../capabilities/twitch-playlist-proxy";
import { AdBlockSettingsPanel } from "./adblock-settings-panel";
import { TwitchPlaylistProxySettingsPanel } from "./twitch-playlist-proxy-settings-panel";

export function AdBlockSettingsWorkspace({
  adblock,
  health,
  playlistProxy,
}: {
  readonly adblock: AdBlockSession;
  readonly health: PlaylistProxyHealth;
  readonly playlistProxy: TwitchPlaylistProxySession;
}) {
  const [revision, setRevision] = useState(0);
  return (
    <View style={styles.workspace}>
      <AdBlockSettingsPanel
        session={adblock}
        onSaved={() => setRevision((current) => current + 1)}
      />
      <TwitchPlaylistProxySettingsPanel
        key={revision}
        customFiltering={adblock}
        health={health}
        session={playlistProxy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: { gap: mobileSpacing.medium },
});
