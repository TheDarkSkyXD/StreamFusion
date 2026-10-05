import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useState } from "react";
import { Bell, Heart } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

import { MobileButton } from "./button";
import { MobileFilterChip } from "./chip";
import { MobileChoiceGroup } from "./choice-group";
import { MobileConnectivityBanner } from "./connectivity-banner";
import { MobileIconButton } from "./icon-button";
import { MobileListRow, MobileSwitchRow } from "./list-row";
import { MobileListState } from "./list-state";
import { MobilePlatformBadge } from "./platform-badge";
import {
  MobileProgress,
  MobileSkeleton,
  MobileSnackbar,
  MobileLoadingSpinner,
} from "./feedback";
import {
  MobileRefreshableScroll,
  MobileRefreshableFlatList,
} from "./refreshable";
import { MobileScreenHeader } from "./screen-header";
import { MobileSelect } from "./select";
import { MobileStatusPanel } from "./status-panel";
import { MobileCatalogTags } from "./tag";
import { MobileTextField } from "./text-input";
import { MobileUnderlineTabs } from "./underline-tabs";
import { MobileVerifiedBadge } from "./verified-badge";
import { mobileColors, mobileSpacing, mobileType } from "./tokens";

type SampleKind =
  | "filter"
  | "tags"
  | "choice"
  | "select"
  | "select-long"
  | "switch"
  | "row"
  | "icon"
  | "field"
  | "field-error"
  | "field-disabled"
  | "field-secure"
  | "field-multiline"
  | "tabs"
  | "badges"
  | "verified"
  | "header"
  | "status"
  | "empty"
  | "error"
  | "loading"
  | "offline"
  | "checking"
  | "skeleton"
  | "progress"
  | "snackbar"
  | "scroll"
  | "refresh"
  | "refresh-list";

function PrimitiveSample({ kind }: { readonly kind: SampleKind }) {
  const [value, setValue] = useState("auto");
  const [text, setText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [tab, setTab] = useState("live");
  const [notice, setNotice] = useState("Guest Follow removed");
  const [refreshCount, setRefreshCount] = useState(0);
  let content;
  switch (kind) {
    case "filter":
      content = (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {["All platforms", "Twitch", "Kick"].map((label) => (
            <MobileFilterChip
              accessibilityLabel={label}
              label={label}
              selected={value === label}
              onPress={() => setValue(label)}
              key={label}
              testID={label}
            />
          ))}
        </View>
      );
      break;
    case "tags":
      content = <MobileCatalogTags tags={["English", "Cozy", "Adventure"]} />;
      break;
    case "choice":
      content = (
        <MobileChoiceGroup
          label="Audio source"
          options={[
            { value: "auto", label: "aurora" },
            { value: "atlas", label: "atlas" },
            { value: "mute", label: "Mute all" },
          ]}
          value={value}
          onChange={setValue}
        />
      );
      break;
    case "select":
    case "select-long":
      content = (
        <MobileSelect
          accessibilityLabel={
            kind === "select" ? "Quality" : "Display language"
          }
          options={
            kind === "select"
              ? [
                  { value: "auto", label: "Auto" },
                  { value: "1080", label: "1080p60" },
                  { value: "720", label: "720p60" },
                ]
              : [
                  "English",
                  "Español",
                  "Deutsch",
                  "Français",
                  "Italiano",
                  "日本語",
                  "한국어",
                  "Português",
                  "Polski",
                  "Русский",
                  "Türkçe",
                  "简体中文",
                ].map((label) => ({ label, value: label }))
          }
          value={value}
          onChange={setValue}
          testID="select"
        />
      );
      break;
    case "switch":
      content = (
        <>
          <MobileSwitchRow
            title="Live alerts"
            description="Notify when followed channels go live"
            onChange={setEnabled}
            value={enabled}
          />
          <MobileSwitchRow
            title="Unavailable preference"
            description="Requires a native development client"
            onChange={setEnabled}
            value={false}
            disabled
          />
        </>
      );
      break;
    case "row":
      content = (
        <>
          <MobileListRow
            title="Notifications"
            description="Alerts on this device"
            leading={<Bell color={mobileColors.textSecondary} size={24} />}
            onPress={() => setNotice("Notifications opened")}
          />
          <MobileListRow title="Current version" description="0.1.3-alpha.1" />
          <MobileListRow
            title="Clear history"
            destructive
            onPress={() => setNotice("Confirmation requested")}
          />
        </>
      );
      break;
    case "icon":
      content = (
        <View style={{ flexDirection: "row", gap: 16 }}>
          <MobileIconButton
            label="Follow"
            onPress={() => setEnabled(!enabled)}
            selected={enabled}
          >
            <Heart color={mobileColors.textPrimary} size={24} />
          </MobileIconButton>
          <MobileIconButton label="Disabled alert" onPress={() => {}} disabled>
            <Bell color={mobileColors.textSecondary} size={24} />
          </MobileIconButton>
        </View>
      );
      break;
    case "field":
    case "field-error":
    case "field-disabled":
    case "field-secure":
    case "field-multiline":
      content = (
        <MobileTextField
          label={
            kind === "field-secure"
              ? "Proxy password"
              : kind === "field-multiline"
                ? "What happened?"
                : "Channel username"
          }
          value={text}
          onChange={setText}
          placeholder="Enter a value"
          disabled={kind === "field-disabled"}
          secure={kind === "field-secure"}
          multiline={kind === "field-multiline"}
          {...(kind === "field-error"
            ? { error: "Enter a channel username without spaces." }
            : { hint: "Saved only in this preview" })}
        />
      );
      break;
    case "tabs":
      content = (
        <MobileUnderlineTabs
          accessibilityLabel="Channel content"
          selectedId={tab}
          onSelect={setTab}
          tabs={[
            { id: "live", label: "Live" },
            { id: "videos", label: "Videos" },
            { id: "clips", label: "Clips" },
            { id: "categories", label: "Categories" },
            { id: "channels", label: "Channels" },
          ]}
        />
      );
      break;
    case "badges":
      content = (
        <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
          <MobilePlatformBadge platform="twitch" />
          <MobilePlatformBadge platform="kick" />
          <MobilePlatformBadge platform="twitch" variant="icon" />
          <MobilePlatformBadge platform="kick" variant="icon" />
        </View>
      );
      break;
    case "verified":
      content = (
        <View style={{ flexDirection: "row", gap: 16 }}>
          <MobileVerifiedBadge platform="twitch" />
          <MobileVerifiedBadge platform="kick" />
        </View>
      );
      break;
    case "header":
      content = (
        <MobileScreenHeader
          title="Following"
          summary="Your channels in one place"
          action={
            <MobileButton
              accessibilityLabel="Manage follows"
              onPress={() => setNotice("Manage follows opened")}
              testID="header-action"
              variant="secondary"
            >
              Manage
            </MobileButton>
          }
        />
      );
      break;
    case "status":
      content = (
        <MobileStatusPanel tone="info">
          <Text style={mobileType.title}>Native client required</Text>
          <Text style={mobileType.body}>
            This capability is not available in Expo Go.
          </Text>
        </MobileStatusPanel>
      );
      break;
    case "empty":
      content = (
        <MobileListState
          phase="empty"
          title="No saved videos"
          message="Download a video to watch it offline."
        />
      );
      break;
    case "error":
      content = (
        <MobileListState
          phase="error"
          title="Could not load channels"
          message="Your Guest Follows are still saved."
          onRetry={() => setNotice("Retry requested")}
        />
      );
      break;
    case "loading":
      content = (
        <>
          <MobileListState phase="loading" message="Loading channels..." />
          <MobileLoadingSpinner label="Checking connection" />
        </>
      );
      break;
    case "offline":
      content = <MobileConnectivityBanner status="offline" />;
      break;
    case "checking":
      content = <MobileConnectivityBanner status="checking" />;
      break;
    case "skeleton":
      content = (
        <>
          <MobileSkeleton kind="card" />
          <MobileSkeleton />
          <MobileSkeleton />
        </>
      );
      break;
    case "progress":
      content = (
        <>
          <MobileProgress label="Download" value={0.41} />
          <MobileProgress label="Model installed" value={1} />
          <MobileProgress label="Queued" value={0} />
        </>
      );
      break;
    case "snackbar":
      content = (
        <>
          {notice ? (
            <MobileSnackbar
              message={notice}
              actionLabel="Undo"
              onAction={() => setNotice("Guest Follow restored")}
            />
          ) : null}
        </>
      );
      break;
    case "scroll":
      content = (
        <ScrollView
          style={{ maxHeight: 360 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {Array.from({ length: 30 }, (_, index) => (
            <MobileListRow
              title={`Channel ${index + 1}`}
              description="Live on Twitch"
              key={index}
              onPress={() => setNotice(`Channel ${index + 1} selected`)}
            />
          ))}
        </ScrollView>
      );
      break;
    case "refresh-list":
      content = (
        <MobileRefreshableFlatList
          style={{ maxHeight: 360 }}
          data={["aurora", "atlas", "moss"]}
          keyExtractor={(name) => name}
          refreshing={false}
          onRefresh={() => setRefreshCount(refreshCount + 1)}
          ListHeaderComponent={
            <Text style={mobileType.body}>
              Pull to refresh on Android. Refreshed {refreshCount} times.
            </Text>
          }
          renderItem={({ item }) => (
            <MobileListRow
              title={item}
              onPress={() => setNotice(`${item} selected`)}
            />
          )}
        />
      );
      break;
    case "refresh":
      content = (
        <MobileRefreshableScroll
          onRefresh={() => setRefreshCount(refreshCount + 1)}
          style={{ maxHeight: 360 }}
        >
          <Text style={mobileType.body}>
            Pull to refresh on Android. Refreshed {refreshCount} times.
          </Text>
          {Array.from({ length: 10 }, (_, index) => (
            <MobileListRow
              key={index}
              title={`Channel ${index + 1}`}
              onPress={() => setNotice(`Channel ${index + 1} selected`)}
            />
          ))}
        </MobileRefreshableScroll>
      );
      break;
  }
  return (
    <View
      style={{
        padding: mobileSpacing.large,
        gap: mobileSpacing.medium,
        width: "100%",
        maxWidth: 760,
        alignSelf: "center",
      }}
    >
      {content}
      {notice !== "Guest Follow removed" && kind !== "snackbar" ? (
        <Text accessibilityLiveRegion="polite" style={mobileType.body}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const meta = {
  title: "Android/Components/Primitives",
  component: PrimitiveSample,
} satisfies Meta<typeof PrimitiveSample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FilterChips: Story = { args: { kind: "filter" } };
export const Tags: Story = { args: { kind: "tags" } };
export const RadioChoices: Story = { args: { kind: "choice" } };
export const SelectSheet: Story = { args: { kind: "select" } };
export const LongSelectSheet: Story = { args: { kind: "select-long" } };
export const SwitchRows: Story = { args: { kind: "switch" } };
export const ListRows: Story = { args: { kind: "row" } };
export const IconButtons: Story = { args: { kind: "icon" } };
export const TextField: Story = { args: { kind: "field" } };
export const InvalidTextField: Story = { args: { kind: "field-error" } };
export const DisabledTextField: Story = { args: { kind: "field-disabled" } };
export const SecureTextField: Story = { args: { kind: "field-secure" } };
export const MultilineTextField: Story = { args: { kind: "field-multiline" } };
export const ScrollableTabs: Story = { args: { kind: "tabs" } };
export const PlatformBadges: Story = { args: { kind: "badges" } };
export const VerifiedBadges: Story = { args: { kind: "verified" } };
export const ScreenHeader: Story = { args: { kind: "header" } };
export const StatusPanel: Story = { args: { kind: "status" } };
export const EmptyState: Story = { args: { kind: "empty" } };
export const ErrorWithRetry: Story = { args: { kind: "error" } };
export const LoadingState: Story = { args: { kind: "loading" } };
export const OfflineBanner: Story = { args: { kind: "offline" } };
export const CheckingConnectivity: Story = { args: { kind: "checking" } };
export const Skeletons: Story = { args: { kind: "skeleton" } };
export const Progress: Story = { args: { kind: "progress" } };
export const SnackbarWithUndo: Story = { args: { kind: "snackbar" } };
export const NativeScrollArea: Story = { args: { kind: "scroll" } };
export const PullToRefresh: Story = { args: { kind: "refresh" } };
export const RefreshableFlatList: Story = { args: { kind: "refresh-list" } };
