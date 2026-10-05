import { useState } from "react";
import { Plus, Volume2, VolumeX } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileChoiceGroup } from "@mobile/design/choice-group";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileListRow } from "@mobile/design/list-row";
import { MobileSnackbar } from "@mobile/design/feedback";
import { MobileTextField } from "@mobile/design/text-input";
import {
  mobileColors as colors,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

import { PreviewArtwork } from "./catalog-elements";
import { PreviewFrame, previewStyles as ui } from "./preview-frame";

export function MultistreamMockup({
  kind = "grid",
}: {
  readonly kind?: "grid" | "add" | "audio" | "constrained" | "chat";
}) {
  const [streams, setStreams] = useState(["aurora", "atlas"]);
  const [audio, setAudio] = useState("aurora");
  const [sheet, setSheet] = useState<"closed" | "add" | "audio">(
    kind === "add" ? "add" : kind === "audio" ? "audio" : "closed",
  );
  const [username, setUsername] = useState("");
  const [platform, setPlatform] = useState("twitch");
  const [notice, setNotice] = useState("");
  return (
    <>
      <PreviewFrame
        title="Multistream"
        subtitle="Android design proposal"
        destination="watch"
        headerAction={
          <MobileIconButton label="Add stream" onPress={() => setSheet("add")}>
            <Plus color={colors.textPrimary} size={24} />
          </MobileIconButton>
        }
      >
        {kind === "constrained" ? (
          <View style={[ui.card, ui.padded]}>
            <Text style={mobileType.title}>Keep one stream active</Text>
            <Text style={mobileType.body}>
              This fixture represents a constrained device. Pause another stream
              before adding a new one.
            </Text>
            <MobileButton
              accessibilityLabel="Review active streams"
              onPress={() => setSheet("audio")}
              testID="review-streams"
              variant="secondary"
            >
              Review streams
            </MobileButton>
          </View>
        ) : null}
        <View style={styles.grid}>
          {streams.map((name, index) => (
            <View key={name} style={[ui.card, styles.slot]}>
              <View style={styles.video}>
                <PreviewArtwork scene={index % 2 ? "city" : "valley"} />
              </View>
              <View style={styles.slotBar}>
                <Text style={[mobileType.title, ui.grow]}>{name}</Text>
                <MobileIconButton
                  label={`Listen to ${name}`}
                  onPress={() => setAudio(name)}
                  selected={audio === name}
                >
                  {audio === name ? (
                    <Volume2 color={colors.textPrimary} size={20} />
                  ) : (
                    <VolumeX color={colors.textSecondary} size={20} />
                  )}
                </MobileIconButton>
              </View>
            </View>
          ))}
          <Pressable
            accessibilityLabel="Add another stream"
            accessibilityRole="button"
            onPress={() => setSheet("add")}
            style={styles.emptySlot}
          >
            <Plus color={colors.textSecondary} size={26} />
            <Text style={mobileType.body}>Add a stream</Text>
          </Pressable>
        </View>
        <MobileListRow
          title="Audio source"
          description={`${audio} · one audio source at a time`}
          onPress={() => setSheet("audio")}
        />
        {kind === "chat" ? (
          <View style={[ui.card, ui.padded]}>
            <Text style={mobileType.title}>Merged chat</Text>
            <Text style={mobileType.body}>
              aurora · juniper: That view is amazing.
            </Text>
            <Text style={mobileType.body}>atlas · kai: One more round?</Text>
            <Text style={mobileType.label}>
              Each message keeps its channel context.
            </Text>
          </View>
        ) : (
          <Text style={mobileType.body}>
            Switch between stream chat panes. Extra streams require native
            capability and workload qualification.
          </Text>
        )}
        {notice ? (
          <MobileSnackbar
            message={notice}
            actionLabel="Dismiss"
            onAction={() => setNotice("")}
          />
        ) : null}
      </PreviewFrame>
      <MobileBottomSheet
        title={sheet === "audio" ? "Audio source" : "Add stream"}
        visible={sheet !== "closed"}
        onDismiss={() => setSheet("closed")}
      >
        {sheet === "audio" ? (
          <>
            <MobileChoiceGroup
              label="Listen to one channel"
              value={audio}
              onChange={setAudio}
              options={[
                ...streams.map((name) => ({ label: name, value: name })),
                { label: "Mute all", value: "Muted" },
              ]}
            />
            {streams.map((name) => (
              <MobileListRow
                title={`Remove ${name}`}
                key={name}
                destructive
                onPress={() => {
                  setStreams(streams.filter((item) => item !== name));
                  if (audio === name) setAudio("Muted");
                  setSheet("closed");
                }}
              />
            ))}
          </>
        ) : (
          <>
            <MobileTextField
              label="Channel username"
              value={username}
              onChange={setUsername}
              placeholder="e.g. moss"
            />
            <MobileChoiceGroup
              label="Platform"
              value={platform}
              onChange={setPlatform}
              options={[
                { label: "Twitch", value: "twitch" },
                { label: "Kick", value: "kick" },
              ]}
            />
            <MobileButton
              accessibilityLabel="Add channel"
              disabled={
                !username.trim() ||
                kind === "constrained" ||
                streams.includes(username.trim())
              }
              onPress={() => {
                setStreams([...streams, username.trim()]);
                setSheet("closed");
                setUsername("");
                setNotice("Stream added in preview");
              }}
              testID="add-channel"
              variant="primary"
            >
              Add channel
            </MobileButton>
          </>
        )}
      </MobileBottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.medium },
  slot: { flexGrow: 1, flexBasis: 280 },
  video: { aspectRatio: 16 / 9 },
  slotBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: mobileSpacing.medium,
  },
  emptySlot: {
    flexGrow: 1,
    flexBasis: 280,
    minHeight: 150,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    gap: mobileSpacing.small,
  },
});
