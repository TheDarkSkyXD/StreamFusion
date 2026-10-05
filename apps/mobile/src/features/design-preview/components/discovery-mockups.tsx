import { useState } from "react";
import { Bell, Search, SlidersHorizontal, UserPlus } from "lucide-react-native";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileListRow, MobileSwitchRow } from "@mobile/design/list-row";
import { MobileSelect } from "@mobile/design/select";
import { MobileSnackbar, MobileSkeleton } from "@mobile/design/feedback";
import { MobileUnderlineTabs } from "@mobile/design/underline-tabs";
import {
  mobileColors as colors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

import {
  fixtureStreams,
  PreviewArtwork,
  PreviewAvatar,
  PreviewStreamCard,
} from "./catalog-elements";
import {
  PreviewFrame,
  PreviewSection,
  previewStyles as ui,
} from "./preview-frame";

export type DiscoveryMockupKind =
  | "home"
  | "search"
  | "search-result"
  | "categories"
  | "category"
  | "channel"
  | "following"
  | "following-preview"
  | "manage-follows";

export function DiscoveryMockup({
  kind = "home",
}: {
  readonly kind?: DiscoveryMockupKind;
}) {
  const [screen, setScreen] = useState(kind);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [tab, setTab] = useState(
    kind === "categories"
      ? "popular"
      : kind === "search"
        ? "all"
        : ["channel", "following-preview", "search-result"].includes(kind)
          ? "home"
          : "live",
  );
  const [sheet, setSheet] = useState(false);
  const [alerts, setAlerts] = useState(true);
  const [onlyLive, setOnlyLive] = useState(false);
  const [followed, setFollowed] = useState(true);
  const [notice, setNotice] = useState("");
  const openChannel = () => {
    setTab("home");
    setScreen("channel");
  };
  const channel =
    screen === "channel" ||
    screen === "following-preview" ||
    screen === "search-result";
  const search = screen === "search";
  const categories = screen === "categories";
  const following = screen === "following";
  const manage = screen === "manage-follows";
  const category = screen === "category";
  const home = screen === "home";
  const title = channel
    ? "aurora"
    : search
      ? "Search"
      : categories
        ? "Categories"
        : following
          ? "Following"
          : manage
            ? "Guest Follows"
            : category
              ? "Minecraft"
              : "Live now";
  const destination =
    following || manage || screen === "following-preview"
      ? "following"
      : home
        ? "watch"
        : "search";
  const filteredStreams = fixtureStreams.filter(
    (stream) =>
      (platform === "all" || platform === stream.platform) &&
      (!onlyLive || (tab !== "videos" && tab !== "clips")) &&
      (!query ||
        `${stream.name} ${stream.title} ${stream.category}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <>
      <PreviewFrame
        destination={destination}
        title={title}
        {...(home
          ? { subtitle: "Your next favorite stream is here" }
          : manage
            ? { subtitle: "Saved on this device" }
            : {})}
        {...(screen !== kind ? { onBack: () => setScreen(kind) } : {})}
        headerAction={
          <MobileIconButton
            label={manage ? "Add a Guest Follow" : "Filters"}
            onPress={() => setSheet(true)}
          >
            {manage ? (
              <UserPlus color={colors.textPrimary} size={22} />
            ) : (
              <SlidersHorizontal color={colors.textPrimary} size={22} />
            )}
          </MobileIconButton>
        }
      >
        {search || manage ? (
          <View style={styles.search}>
            <Search color={colors.textSecondary} size={20} />
            <TextInput
              accessibilityLabel={
                manage ? "Channel username" : "Search Twitch and Kick"
              }
              onChangeText={setQuery}
              placeholder={
                manage
                  ? "Add a channel by username"
                  : "Channels, games, videos..."
              }
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              value={query}
            />
          </View>
        ) : null}
        {channel ? (
          <View style={styles.channelHeader}>
            <View style={styles.banner}>
              <PreviewArtwork />
            </View>
            <View style={ui.row}>
              <PreviewAvatar name="aurora" size={64} />
              <View style={ui.grow}>
                <Text style={mobileType.title}>aurora</Text>
                <Text style={mobileType.body}>12.4K watching · Twitch</Text>
              </View>
              <MobileIconButton
                label="Live alerts"
                onPress={() => setAlerts(!alerts)}
                selected={alerts}
              >
                <Bell color={colors.textPrimary} size={22} />
              </MobileIconButton>
            </View>
            <Text style={mobileType.body}>
              Cozy adventures, late nights, and a very questionable sense of
              direction.
            </Text>
            <View style={ui.row}>
              <MobileButton
                accessibilityLabel={
                  followed ? "Unfollow aurora" : "Follow aurora"
                }
                onPress={() => setFollowed(!followed)}
                testID="channel-follow"
                variant={followed ? "secondary" : "primary"}
              >
                {followed ? "Following" : "Follow"}
              </MobileButton>
              <MobileButton
                accessibilityLabel="Watch aurora"
                onPress={() => setNotice("Watch preview opened")}
                testID="channel-watch"
                variant="primary"
              >
                Watch live
              </MobileButton>
            </View>
          </View>
        ) : null}
        {home ? (
          <PreviewSection title="Featured on StreamFusion">
            <PreviewStreamCard onPress={openChannel} />
          </PreviewSection>
        ) : null}
        {!manage ? (
          <MobileUnderlineTabs
            accessibilityLabel="Content type"
            selectedId={tab}
            onSelect={setTab}
            tabs={(channel
              ? ["home", "videos", "clips"]
              : categories
                ? ["popular", "followed"]
                : search
                  ? [
                      "all",
                      "channels",
                      "streams",
                      "videos",
                      "clips",
                      "categories",
                    ]
                  : ["live", "videos", "clips", "categories", "channels"]
            ).map((id) => ({
              id,
              label: id.slice(0, 1).toUpperCase() + id.slice(1),
            }))}
          />
        ) : null}
        {!channel && !manage ? (
          <View style={ui.row}>
            {["all", "twitch", "kick"].map((id) => (
              <MobileFilterChip
                accessibilityLabel={`${id} platform`}
                key={id}
                label={
                  id === "all"
                    ? "All platforms"
                    : id === "twitch"
                      ? "Twitch"
                      : "Kick"
                }
                onPress={() => setPlatform(id)}
                selected={platform === id}
                testID={`platform-${id}`}
              />
            ))}
          </View>
        ) : null}
        {categories || tab === "categories" ? (
          <View style={styles.categoryGrid}>
            {[
              "Minecraft",
              "VALORANT",
              "Just Chatting",
              "Grand Theft Auto V",
              "Fortnite",
              "Music",
            ].map((name, index) => (
              <Pressable
                accessibilityLabel={`Open ${name}`}
                accessibilityRole="button"
                key={name}
                onPress={() => {
                  setTab("live");
                  setScreen("category");
                }}
                style={styles.category}
              >
                <View style={styles.categoryArt}>
                  <PreviewArtwork scene={index % 2 ? "city" : "valley"} />
                </View>
                <Text numberOfLines={2} style={mobileType.title}>
                  {name}
                </Text>
                <Text style={mobileType.label}>
                  {index ? "8.2K" : "24.6K"} viewers
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {manage ? (
          <PreviewSection title="Your channels">
            {fixtureStreams.map((stream) => (
              <MobileListRow
                key={stream.name}
                title={stream.name}
                description={`${stream.platform} · ${stream.category}`}
                leading={<PreviewAvatar name={stream.name} />}
                onPress={() => {
                  openChannel();
                }}
              />
            ))}
            <MobileListRow
              title="Import platform follows"
              description="Account synchronization is not available on mobile yet."
            />
          </PreviewSection>
        ) : !categories && tab !== "categories" ? (
          <PreviewSection
            title={
              category
                ? "Live in Minecraft"
                : channel
                  ? tab === "videos"
                    ? "Recent broadcasts"
                    : tab === "clips"
                      ? "Popular clips"
                      : "On air"
                  : following
                    ? "Your channels are live"
                    : query
                      ? `Results for "${query}"`
                      : "Live channels"
            }
          >
            {filteredStreams.map((stream) =>
              tab === "channels" ? (
                <MobileListRow
                  key={stream.name}
                  title={stream.name}
                  description={stream.category}
                  leading={<PreviewAvatar name={stream.name} />}
                  onPress={openChannel}
                />
              ) : (
                <PreviewStreamCard
                  key={stream.name}
                  onPress={openChannel}
                  media={
                    tab === "videos"
                      ? "video"
                      : tab === "clips"
                        ? "clip"
                        : "live"
                  }
                  stream={stream}
                  compact={
                    following || channel || tab === "videos" || tab === "clips"
                  }
                />
              ),
            )}
            {filteredStreams.length === 0 ? (
              <Text style={mobileType.body}>
                No channels match this search.
              </Text>
            ) : null}
          </PreviewSection>
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
        title={manage ? "Add Guest Follow" : "Browse filters"}
        visible={sheet}
        onDismiss={() => setSheet(false)}
        footer={
          <MobileButton
            accessibilityLabel="Apply filters"
            onPress={() => {
              setSheet(false);
              if (manage) setNotice("Guest Follow saved in preview");
            }}
            testID="apply-filters"
            variant="primary"
          >
            {manage ? "Add follow" : "Apply filters"}
          </MobileButton>
        }
      >
        {manage ? (
          <TextInput
            accessibilityLabel="Username"
            placeholder="Channel username"
            placeholderTextColor={colors.textSecondary}
            style={ui.field}
            value={query}
            onChangeText={setQuery}
          />
        ) : null}
        <MobileSelect
          accessibilityLabel="Platform"
          onChange={setPlatform}
          options={[
            { value: "all", label: "All platforms" },
            { value: "twitch", label: "Twitch" },
            { value: "kick", label: "Kick" },
          ]}
          testID="filter-platform"
          value={platform}
        />
        <MobileSwitchRow
          title={manage ? "Live alerts" : "Only live channels"}
          description={
            manage
              ? "Notify me when this channel goes live"
              : "Hide offline channels"
          }
          value={manage ? alerts : onlyLive}
          onChange={manage ? setAlerts : setOnlyLive}
        />
        <Text style={mobileType.body}>Filters apply to this preview.</Text>
      </MobileBottomSheet>
    </>
  );
}

export function DiscoveryLoadingMockup() {
  return (
    <PreviewFrame title="Following" destination="following">
      <MobileSkeleton kind="card" />
      <MobileSkeleton kind="card" />
      <MobileSkeleton kind="row" />
    </PreviewFrame>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.small,
    backgroundColor: colors.surface,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: mobileSpacing.medium,
  },
  input: { flex: 1, minHeight: 48, fontSize: 16, color: colors.textPrimary },
  channelHeader: { gap: mobileSpacing.medium },
  banner: { height: 112, borderRadius: mobileRadii.large, overflow: "hidden" },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.medium,
  },
  category: {
    width: "46%",
    minWidth: 124,
    flexGrow: 1,
    gap: mobileSpacing.small,
  },
  categoryArt: {
    aspectRatio: 3 / 4,
    borderRadius: mobileRadii.large,
    overflow: "hidden",
  },
});
