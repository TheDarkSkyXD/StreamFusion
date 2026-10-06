import { useState } from "react";
import { Download, Ellipsis } from "lucide-react-native";
import { Text, View } from "react-native";

import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileListRow } from "@mobile/design/list-row";
import { MobileListState } from "@mobile/design/list-state";
import { MobileProgress, MobileSnackbar } from "@mobile/design/feedback";
import { MobileTextField } from "@mobile/design/text-input";
import {
  mobileColors as colors,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

import {
  fixtureStreams,
  PreviewAvatar,
  PreviewStreamCard,
} from "./catalog-elements";
import {
  PreviewFrame,
  PreviewSection,
  previewStyles as ui,
} from "./preview-frame";
import {
  MoreRouteIcon,
  type MoreHubRouteId,
} from "@mobile/features/shell/components/destination-icon";
import { DiscoveryMockup } from "./discovery-mockups";
import { MultistreamMockup } from "./multistream-mockups";
import { SettingsMockup } from "./settings-mockups";

export type LibraryMockupKind =
  | "more"
  | "history"
  | "downloads"
  | "job"
  | "activity"
  | "activity-detail"
  | "diagnostics"
  | "accounts"
  | "authorization"
  | "expired"
  | "moderation-placeholder"
  | "recording-recovery"
  | "download-duplicate"
  | "caption-model";

export function LibraryMockup({
  kind = "more",
  phase = "ready",
}: {
  readonly kind?: LibraryMockupKind;
  readonly phase?: "ready" | "empty" | "error" | "offline";
}) {
  const [screen, setScreen] = useState<
    LibraryMockupKind | "settings" | "categories" | "multistream"
  >(kind);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<string | null>(
    kind === "download-duplicate" ? "Download again?" : null,
  );
  const [sheet, setSheet] = useState(false);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(
    kind !== "authorization" && kind !== "expired",
  );
  const [items, setItems] = useState([...fixtureStreams]);
  if (screen === "settings") return <SettingsMockup />;
  if (screen === "categories") return <DiscoveryMockup kind="categories" />;
  if (screen === "multistream") return <MultistreamMockup />;
  const titles: Record<LibraryMockupKind, string> = {
    more: "More",
    history: "History",
    downloads: "Downloads",
    job: "Download details",
    activity: "Activity",
    "activity-detail": "Live alert",
    diagnostics: "Diagnostics",
    accounts: "Connected Accounts",
    authorization: "Connect Twitch",
    expired: "Connected Accounts",
    "moderation-placeholder": "Moderation",
    "recording-recovery": "Recover recording",
    "download-duplicate": "Downloads",
    "caption-model": "Caption models",
  };
  const media =
    screen === "history" ||
    screen === "downloads" ||
    screen === "download-duplicate";
  const account =
    screen === "accounts" || screen === "authorization" || screen === "expired";
  const routes: readonly {
    readonly label: string;
    readonly description: string;
    readonly kind:
      LibraryMockupKind | "settings" | "categories" | "multistream";
    readonly routeId: MoreHubRouteId;
  }[] = [
    {
      label: "Categories",
      description: "Browse live streams by category.",
      kind: "categories",
      routeId: "more/categories",
    },
    {
      label: "MultiView",
      description: "Watch several live streams together.",
      kind: "multistream",
      routeId: "more/multistream",
    },
    {
      label: "Connected Accounts",
      description: "Twitch and Kick connections",
      kind: "accounts",
      routeId: "more/accounts",
    },
    {
      label: "History",
      description: "Pick up where you left off",
      kind: "history",
      routeId: "more/history",
    },
    {
      label: "Downloads",
      description: "Videos and recordings on this device",
      kind: "downloads",
      routeId: "more/downloads",
    },
    {
      label: "Moderation",
      description: "Channel moderation availability",
      kind: "moderation-placeholder",
      routeId: "more/moderation",
    },
    {
      label: "Settings",
      description: "Appearance, playback, and support",
      kind: "settings",
      routeId: "more/settings",
    },
    {
      label: "Diagnostics",
      description: "Device capabilities and recovery",
      kind: "diagnostics",
      routeId: "more/diagnostics",
    },
  ];
  const ready = phase === "ready";
  const mediaKind = {
    aurora: "video",
    atlas: "clip",
    moss: "recording",
  } as const;
  return (
    <>
      <PreviewFrame
        title={titles[screen]}
        destination={
          screen === "activity" ||
          screen === "activity-detail" ||
          screen === "job"
            ? "activity"
            : "more"
        }
        {...(screen !== kind ? { onBack: () => setScreen(kind) } : {})}
        headerAction={
          media || screen === "activity" ? (
            <MobileIconButton
              label="List actions"
              onPress={() => setSheet(true)}
            >
              <Ellipsis color={colors.textPrimary} size={22} />
            </MobileIconButton>
          ) : null
        }
      >
        {screen === "more" ? (
          <>
            <View style={ui.row}>
              <PreviewAvatar name="you" size={56} />
              <View>
                <Text style={mobileType.title}>Make yourself at home</Text>
                <Text style={mobileType.body}>One place for every channel</Text>
              </View>
            </View>
            <View style={ui.card}>
              {routes.map(({ routeId, kind: target, label, description }) => (
                <MobileListRow
                  key={label}
                  title={label}
                  description={description}
                  leading={
                    <MoreRouteIcon
                      routeId={routeId}
                      color={colors.textSecondary}
                      size={22}
                    />
                  }
                  onPress={() => setScreen(target)}
                />
              ))}
            </View>
          </>
        ) : null}
        {media ? (
          <>
            <MobileTextField
              label={
                screen === "history" ? "Search history" : "Search downloads"
              }
              placeholder="Channel or title"
              value={query}
              onChange={setQuery}
            />
            <View style={ui.row}>
              {["all", "videos", "clips", "recordings"].map((id) => (
                <MobileFilterChip
                  accessibilityLabel={id}
                  key={id}
                  label={id.slice(0, 1).toUpperCase() + id.slice(1)}
                  onPress={() => setFilter(id)}
                  selected={filter === id}
                  testID={id}
                />
              ))}
            </View>
            {ready ? (
              <PreviewSection
                title={screen === "history" ? "Today" : "On this device"}
              >
                {items
                  .filter(
                    (item) =>
                      (filter === "all" ||
                        `${mediaKind[item.name]}s` === filter) &&
                      `${item.name} ${item.title}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .map((stream, index) => (
                    <View key={stream.name} style={ui.column}>
                      <PreviewStreamCard
                        stream={stream}
                        media={
                          mediaKind[stream.name] === "clip" ? "clip" : "video"
                        }
                        compact
                        onPress={() =>
                          screen === "history"
                            ? setNotice(`Resume ${stream.name}`)
                            : setScreen("job")
                        }
                      />
                      {screen !== "history" && index === 0 ? (
                        <MobileProgress
                          label={
                            paused
                              ? "Paused · 168 MiB of 410 MiB"
                              : "Downloading · 4.2 MiB/s"
                          }
                          value={0.41}
                        />
                      ) : (
                        <Text style={mobileType.label}>
                          {screen === "history"
                            ? "Watched 14 min ago · Resume at 14:32"
                            : "Saved · 410 MiB · Available offline"}
                        </Text>
                      )}
                    </View>
                  ))}
              </PreviewSection>
            ) : (
              <MobileListState
                phase={phase === "error" ? "error" : "empty"}
                title={
                  phase === "error"
                    ? "Could not load saved media"
                    : "Nothing saved yet"
                }
                message={
                  phase === "offline"
                    ? "Saved files remain available. New downloads need a connection."
                    : screen === "history"
                      ? "Streams and videos you watch appear here."
                      : "Download a video or record a stream to watch it later."
                }
                onRetry={() => setNotice("Retry requested")}
              />
            )}
          </>
        ) : null}
        {screen === "job" ? (
          <>
            <View style={[ui.card, ui.padded]}>
              <Text style={mobileType.title}>
                One more adventure before sunrise
              </Text>
              <Text style={mobileType.body}>aurora · Twitch video</Text>
              <MobileProgress
                label={paused ? "Paused" : "Downloading"}
                value={0.41}
              />
              <MobileListRow title="Size" description="168 MiB of 410 MiB" />
              <MobileListRow
                title="Speed"
                description={
                  paused ? "Paused" : "4.2 MiB/s · about 58 seconds remaining"
                }
              />
              <View style={ui.row}>
                <MobileButton
                  accessibilityLabel={
                    paused ? "Resume download" : "Pause download"
                  }
                  onPress={() => setPaused(!paused)}
                  testID="pause-job"
                  variant="primary"
                >
                  {paused ? "Resume" : "Pause"}
                </MobileButton>
                <MobileButton
                  accessibilityLabel="Cancel download"
                  onPress={() => setConfirm("Cancel download?")}
                  testID="cancel-job"
                  variant="ghost"
                >
                  Cancel
                </MobileButton>
              </View>
            </View>
            <Text style={mobileType.body}>
              This job stays in Activity. Android owns background media work.
            </Text>
          </>
        ) : null}
        {screen === "activity" ? (
          <>
            <View style={ui.row}>
              {["all", "live", "downloads"].map((id) => (
                <MobileFilterChip
                  accessibilityLabel={id}
                  key={id}
                  label={id.slice(0, 1).toUpperCase() + id.slice(1)}
                  onPress={() => setFilter(id)}
                  selected={filter === id}
                  testID={id}
                />
              ))}
            </View>
            {ready ? (
              <PreviewSection title="Today">
                {filter !== "downloads" ? (
                  <MobileListRow
                    title="aurora is live"
                    description="Minecraft · 4 minutes ago"
                    leading={<PreviewAvatar name="aurora" />}
                    onPress={() => setScreen("activity-detail")}
                  />
                ) : null}
                {filter !== "live" ? (
                  <MobileListRow
                    title="Download in progress"
                    description="One more adventure · 41%"
                    leading={<Download color={colors.textPrimary} size={22} />}
                    onPress={() => setScreen("job")}
                  />
                ) : null}
                <MobileListRow
                  title="atlas is live"
                  description="VALORANT · 28 minutes ago"
                  leading={<PreviewAvatar name="atlas" />}
                  onPress={() => setScreen("activity-detail")}
                />
              </PreviewSection>
            ) : (
              <MobileListState
                phase={phase === "error" ? "error" : "empty"}
                title="All caught up"
                message="Live alerts and media jobs appear here."
                onRetry={() => setNotice("Retry requested")}
              />
            )}
          </>
        ) : null}
        {screen === "activity-detail" ? (
          <>
            <View style={[ui.card, ui.padded]}>
              <View style={ui.row}>
                <PreviewAvatar name="aurora" />
                <Text style={mobileType.title}>aurora is live</Text>
              </View>
              <Text style={mobileType.body}>
                One more adventure before sunrise
              </Text>
              <Text style={mobileType.label}>
                Minecraft · Twitch · 4 minutes ago
              </Text>
              <MobileButton
                accessibilityLabel="Watch now"
                onPress={() => setNotice("Watch preview opened")}
                testID="watch-alert"
                variant="primary"
              >
                Watch now
              </MobileButton>
              <MobileButton
                accessibilityLabel="Dismiss alert"
                onPress={() => setConfirm("Dismiss alert?")}
                testID="dismiss-alert"
                variant="ghost"
              >
                Dismiss alert
              </MobileButton>
            </View>
          </>
        ) : null}
        {account ? (
          <>
            <Text style={mobileType.body}>
              Connect your platform accounts. Guest Follows stay available
              without signing in.
            </Text>
            <View style={[ui.card, ui.padded]}>
              <Text style={mobileType.title}>Twitch</Text>
              {screen === "authorization" ? (
                <>
                  <Text style={mobileType.body}>
                    Enter this code on Twitch to finish connecting.
                  </Text>
                  <Text
                    selectable
                    style={{
                      ...mobileType.display,
                      letterSpacing: 4,
                      paddingVertical: mobileSpacing.medium,
                    }}
                  >
                    ABCD-EFGH
                  </Text>
                  <Text style={mobileType.label}>Expires in 08:42</Text>
                  <MobileButton
                    accessibilityLabel="Open Twitch authorization"
                    onPress={() => {
                      setScreen("accounts");
                      setConnected(true);
                      setNotice("Account connected in preview");
                    }}
                    testID="authorize"
                    variant="twitch"
                  >
                    Continue on Twitch
                  </MobileButton>
                </>
              ) : (
                <>
                  <MobileListRow
                    title={
                      connected
                        ? "aurora_viewer"
                        : screen === "expired"
                          ? "Session expired"
                          : "Not connected"
                    }
                    description={
                      connected
                        ? "Connected · Session active"
                        : "Reconnect to restore your account session"
                    }
                    leading={<PreviewAvatar name="aurora_viewer" />}
                  />
                  <MobileButton
                    accessibilityLabel={
                      connected ? "Disconnect Twitch" : "Connect Twitch"
                    }
                    onPress={() =>
                      connected
                        ? setConfirm("Disconnect Twitch?")
                        : setScreen("authorization")
                    }
                    testID="twitch-connect"
                    variant={connected ? "secondary" : "twitch"}
                  >
                    {connected ? "Disconnect" : "Connect Twitch"}
                  </MobileButton>
                </>
              )}
            </View>
            <View style={[ui.card, ui.padded]}>
              <Text style={mobileType.title}>Kick</Text>
              <Text style={mobileType.body}>Not connected</Text>
              <MobileButton
                accessibilityLabel="Connect Kick"
                onPress={() => setNotice("Kick browser authorization preview")}
                testID="kick-connect"
                variant="kick"
              >
                Connect Kick
              </MobileButton>
            </View>
            <Text style={mobileType.label}>
              Authenticated chat and moderation are separate proposed workflows.
            </Text>
          </>
        ) : null}
        {screen === "moderation-placeholder" ? (
          <MobileListState
            phase="empty"
            title="Moderation is coming to Android"
            message="The current mobile destination is a placeholder. Use desktop for moderation. Proposed Android screens are in the Storybook moderation group."
          />
        ) : null}
        {screen === "diagnostics" ? (
          <>
            <View style={ui.card}>
              {[
                "Runtime · Native Android",
                "Storage · Encrypted product store",
                "Playback · One focused session",
                "Connectivity · Online",
                "Notifications · Permission granted",
              ].map((title) => (
                <MobileListRow
                  key={title}
                  title={title}
                  onPress={() => setNotice(`${title} details`)}
                />
              ))}
            </View>
            <PreviewSection title="Recovery">
              <MobileListRow
                title="Media jobs"
                description="One active download"
                onPress={() => setScreen("job")}
              />
              <MobileListRow
                title="Caption models"
                description="Proposed model management"
                onPress={() => setScreen("caption-model")}
              />
              <MobileButton
                accessibilityLabel="Share diagnostics"
                onPress={() => setNotice("Redacted report preview ready")}
                testID="share-diagnostics"
                variant="secondary"
              >
                Preview support report
              </MobileButton>
            </PreviewSection>
          </>
        ) : null}
        {screen === "recording-recovery" ? (
          <View style={[ui.card, ui.padded]}>
            <Text style={mobileType.title}>Recording interrupted</Text>
            <Text style={mobileType.body}>
              aurora · 12 minutes captured · 180 MiB
            </Text>
            <Text style={mobileType.body}>
              Keep the playable segment or remove this recording from the
              device.
            </Text>
            <View style={ui.row}>
              <MobileButton
                accessibilityLabel="Keep recording"
                onPress={() => setNotice("Recording kept in Downloads")}
                testID="keep-recording"
                variant="primary"
              >
                Keep recording
              </MobileButton>
              <MobileButton
                accessibilityLabel="Delete recording"
                onPress={() => setConfirm("Delete recording?")}
                testID="delete-recording"
                variant="destructive"
              >
                Delete
              </MobileButton>
            </View>
          </View>
        ) : null}
        {screen === "caption-model" ? (
          <>
            <Text style={mobileType.body}>
              Choose an on-device model. This proposed workflow does not install
              or run models.
            </Text>
            <View style={[ui.card, ui.padded]}>
              <Text style={mobileType.title}>English · Compact model</Text>
              <Text style={mobileType.body}>75 MiB · Wi-Fi recommended</Text>
              <MobileProgress label="Model download" value={0.62} />
              <MobileListRow
                title="Verification"
                description="Integrity check runs before activation"
              />
              <MobileButton
                accessibilityLabel="Cancel model download"
                onPress={() => setConfirm("Cancel model download?")}
                testID="cancel-model"
                variant="ghost"
              >
                Cancel download
              </MobileButton>
            </View>
          </>
        ) : null}
        {notice ? (
          <MobileSnackbar
            message={notice}
            actionLabel="Dismiss"
            onAction={() => setNotice("")}
          />
        ) : null}
      </PreviewFrame>
      <MobileBottomSheet
        title="List actions"
        visible={sheet}
        onDismiss={() => setSheet(false)}
      >
        <MobileListRow
          title={
            screen === "history"
              ? "Clear History"
              : screen === "activity"
                ? "Clear completed activity"
                : "Clear completed downloads"
          }
          destructive
          onPress={() => {
            setSheet(false);
            setConfirm("Clear saved items?");
          }}
        />
        <MobileListRow
          title="Storage details"
          description="Files saved on this device"
          onPress={() => {
            setSheet(false);
            setNotice("Local files · 820 MiB");
          }}
        />
      </MobileBottomSheet>
      <MobileDialog
        title={confirm ?? "Confirm"}
        message={
          confirm?.startsWith("Disconnect")
            ? "Remove this platform session from the device? Guest Follows remain saved."
            : confirm === "Download again?"
              ? "This video is already saved on this device. Keep the existing copy or download another copy."
              : "This action affects only the saved item on this device."
        }
        confirmLabel={
          confirm === "Download again?" ? "Download again" : "Confirm"
        }
        destructive={confirm !== "Download again?"}
        visible={confirm !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.startsWith("Disconnect")) setConnected(false);
          if (confirm === "Clear saved items?") setItems([]);
          setNotice("Action completed in preview");
          setConfirm(null);
        }}
      />
    </>
  );
}
