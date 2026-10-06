import { useState } from "react";
import { Text, View } from "react-native";

import { SettingsTileRoute } from "@mobile/features/settings/components/settings-workspace";
import { MobileButton } from "@mobile/design/button";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileProgress, MobileSnackbar } from "@mobile/design/feedback";
import { MobileListRow, MobileSwitchRow } from "@mobile/design/list-row";
import { MobileSelect } from "@mobile/design/select";
import { MobileTextField } from "@mobile/design/text-input";
import { mobileType } from "@mobile/design/tokens";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_SECTIONS,
} from "@mobile/features/settings/domain/settings-categories";

import {
  PreviewFrame,
  PreviewSection,
  previewStyles as ui,
} from "./preview-frame";

type SettingRow =
  | {
      readonly kind: "toggle";
      readonly title: string;
      readonly description: string;
      readonly initial: boolean;
    }
  | {
      readonly kind: "select";
      readonly title: string;
      readonly options: readonly string[];
    }
  | {
      readonly kind: "field";
      readonly title: string;
      readonly initial: string;
      readonly secure?: boolean;
    }
  | {
      readonly kind: "info";
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "action";
      readonly title: string;
      readonly description: string;
      readonly destructive?: boolean;
    };

const panels = {
  appearance: {
    summary: "Make StreamFusion feel like home",
    rows: [
      {
        kind: "info",
        title: "Theme",
        description: "Dark · StreamFusion's theater palette",
      },
      {
        kind: "select",
        title: "Display language",
        options: ["English", "Español", "Deutsch", "Français", "日本語"],
      },
      { kind: "select", title: "Density", options: ["Comfortable", "Compact"] },
      {
        kind: "toggle",
        title: "Restore last session",
        description: "Return to your last destination on launch",
        initial: true,
      },
    ],
  },
  playback: {
    summary: "Quality and playback preferences",
    rows: [
      {
        kind: "select",
        title: "Default quality",
        options: ["Auto", "1080p60", "720p60", "480p", "Audio only"],
      },
      {
        kind: "toggle",
        title: "Low latency",
        description: "Stay closer to live when supported",
        initial: true,
      },
      {
        kind: "toggle",
        title: "Prefer HEVC",
        description: "Use only when the device supports it",
        initial: false,
      },
      {
        kind: "info",
        title: "Captions",
        description:
          "Preference is saved. User-facing caption controls remain proposed.",
      },
    ],
  },
  "player-controls": {
    summary: "Choose what appears around the stream",
    rows: [
      {
        kind: "toggle",
        title: "Show viewer count",
        description: "Display live audience size",
        initial: true,
      },
      {
        kind: "toggle",
        title: "Show quality",
        description: "Display the selected rendition",
        initial: true,
      },
      {
        kind: "toggle",
        title: "Show volume control",
        description: "Keep mute within reach",
        initial: true,
      },
      {
        kind: "select",
        title: "Seek interval",
        options: ["10 seconds", "5 seconds", "15 seconds", "30 seconds"],
      },
    ],
  },
  buffer: {
    summary: "Balance resilience and live delay",
    rows: [
      { kind: "field", title: "Forward buffer, seconds", initial: "15" },
      { kind: "field", title: "Maximum buffer, seconds", initial: "30" },
      { kind: "field", title: "Live sync, seconds", initial: "3" },
      {
        kind: "action",
        title: "Restore defaults",
        description: "Use recommended playback values",
      },
    ],
  },
  chat: {
    summary: "Read chat comfortably",
    rows: [
      {
        kind: "select",
        title: "Text size",
        options: ["Default", "Small", "Large", "Extra large"],
      },
      {
        kind: "toggle",
        title: "Show timestamps",
        description: "Add time beside each message",
        initial: false,
      },
      {
        kind: "toggle",
        title: "Show badges",
        description: "Display channel roles and subscriptions",
        initial: true,
      },
      {
        kind: "toggle",
        title: "Third-party emotes",
        description: "Preference saved for the proposed emote renderer",
        initial: true,
      },
      {
        kind: "toggle",
        title: "Animate emotes",
        description: "Preference saved for supported artwork",
        initial: false,
      },
    ],
  },
  predictions: {
    summary: "Preferences for the proposed prediction widget",
    rows: [
      {
        kind: "select",
        title: "Presentation",
        options: ["Compact", "Expanded", "Hidden"],
      },
      {
        kind: "toggle",
        title: "Show prediction overlay",
        description: "Apply when prediction participation is available",
        initial: true,
      },
      {
        kind: "info",
        title: "Participation",
        description: "Mobile prediction participation is not implemented yet.",
      },
    ],
  },
  notifications: {
    summary: "Stay in touch with your channels",
    rows: [
      {
        kind: "toggle",
        title: "Live alerts",
        description: "Notify when Guest Follows go live",
        initial: true,
      },
      {
        kind: "toggle",
        title: "In-app banners",
        description: "Show alerts while StreamFusion is open",
        initial: true,
      },
      {
        kind: "toggle",
        title: "Play notification sound",
        description: "Respect the device notification settings",
        initial: false,
      },
      {
        kind: "action",
        title: "Android notification settings",
        description: "Review notification permission",
      },
    ],
  },
  adblock: {
    summary: "Twitch playback protection",
    rows: [
      {
        kind: "toggle",
        title: "Custom ad blocking",
        description: "Requires the native Android player",
        initial: false,
      },
      {
        kind: "toggle",
        title: "Playlist proxy",
        description: "Route Twitch playlists through a selected proxy",
        initial: true,
      },
      {
        kind: "select",
        title: "Proxy endpoint",
        options: ["Default endpoint", "Custom endpoint"],
      },
      {
        kind: "action",
        title: "Check endpoint",
        description: "Test availability without starting a stream",
      },
      {
        kind: "info",
        title: "Expo Go",
        description:
          "Native playlist interception is unavailable in this host.",
      },
    ],
  },
  proxy: {
    summary: "Outbound connectivity",
    rows: [
      {
        kind: "toggle",
        title: "Use proxy",
        description: "Route supported requests through your proxy",
        initial: false,
      },
      {
        kind: "field",
        title: "Proxy URL",
        initial: "https://proxy.example.com",
      },
      { kind: "field", title: "Username", initial: "" },
      { kind: "field", title: "Password", initial: "", secure: true },
      {
        kind: "action",
        title: "Test connection",
        description: "Check the configured endpoint",
      },
    ],
  },
  integrations: {
    summary: "Platform connections",
    rows: [
      {
        kind: "info",
        title: "Twitch",
        description: "aurora_viewer · Connected",
      },
      {
        kind: "action",
        title: "Manage Twitch account",
        description: "Review account connection",
      },
      {
        kind: "action",
        title: "Connect Kick",
        description: "Continue in the platform browser",
      },
      {
        kind: "info",
        title: "Platform follows",
        description: "Account-follow synchronization is not available yet.",
      },
    ],
  },
  "api-tokens": {
    summary: "Review token status without exposing secrets",
    rows: [
      {
        kind: "info",
        title: "Twitch session",
        description: "Active · expires in 3 hours",
      },
      { kind: "info", title: "Kick session", description: "Not connected" },
      {
        kind: "action",
        title: "Refresh session",
        description: "Request a new access token",
      },
      {
        kind: "info",
        title: "Token values",
        description: "Secrets never appear in this view.",
      },
    ],
  },
  updates: {
    summary: "Keep StreamFusion up to date",
    rows: [
      {
        kind: "info",
        title: "Installed version",
        description: "0.1.3-alpha.1 · Android",
      },
      {
        kind: "action",
        title: "Check for updates",
        description: "Check the GitHub release channel",
      },
      {
        kind: "action",
        title: "Open release page",
        description: "Review release notes and APK downloads",
      },
      {
        kind: "toggle",
        title: "Check on launch",
        description: "Check when the app starts",
        initial: true,
      },
    ],
  },
  diagnostics: {
    summary: "Device support and recovery",
    rows: [
      {
        kind: "info",
        title: "Runtime",
        description: "Native Android · foreground",
      },
      {
        kind: "info",
        title: "Playback support",
        description: "Decoder observations do not qualify concurrent playback.",
      },
      {
        kind: "info",
        title: "Storage",
        description: "Product and cache stores are separate",
      },
      {
        kind: "action",
        title: "Open diagnostics workspace",
        description: "View capabilities and recovery",
      },
      {
        kind: "action",
        title: "Clear disposable cache",
        description: "Keep accounts, settings, and history",
        destructive: true,
      },
    ],
  },
  logs: {
    summary: "Local support information",
    rows: [
      {
        kind: "info",
        title: "09:41 · Playback",
        description: "Selected quality changed to Auto",
      },
      {
        kind: "info",
        title: "09:40 · Connectivity",
        description: "Network connected",
      },
      {
        kind: "action",
        title: "Share redacted logs",
        description: "Preview before sharing",
      },
      {
        kind: "action",
        title: "Clear local logs",
        description: "Remove logs on this device",
        destructive: true,
      },
    ],
  },
  "report-bug": {
    summary: "Help us understand what happened",
    rows: [
      {
        kind: "field",
        title: "What happened?",
        initial: "Playback paused when I returned from fullscreen.",
      },
      {
        kind: "field",
        title: "Steps to reproduce",
        initial: "Open a stream, enter fullscreen, then return.",
      },
      {
        kind: "toggle",
        title: "Include redacted diagnostics",
        description: "Review the report before sharing",
        initial: true,
      },
      {
        kind: "action",
        title: "Preview report",
        description: "No account secrets or message contents",
      },
    ],
  },
  about: {
    summary: "One home for Twitch and Kick",
    rows: [
      {
        kind: "info",
        title: "StreamFusion",
        description: "0.1.3-alpha.1 · Open source Android viewer",
      },
      {
        kind: "action",
        title: "Open source licenses",
        description: "Libraries used by StreamFusion",
      },
      {
        kind: "action",
        title: "Privacy",
        description: "How local and platform data are handled",
      },
      {
        kind: "action",
        title: "Reset local preferences",
        description: "Restore settings on this device",
        destructive: true,
      },
    ],
  },
} satisfies Record<
  string,
  { readonly summary: string; readonly rows: readonly SettingRow[] }
>;

export type PreviewSettingsPanel = keyof typeof panels;

function SettingControl({
  onAction,
  row,
}: {
  readonly onAction: (row: Extract<SettingRow, { kind: "action" }>) => void;
  readonly row: SettingRow;
}) {
  const [toggle, setToggle] = useState(
    row.kind === "toggle" ? row.initial : false,
  );
  const [value, setValue] = useState(
    row.kind === "field"
      ? row.initial
      : row.kind === "select"
        ? (row.options[0] ?? "")
        : "",
  );
  switch (row.kind) {
    case "toggle":
      return (
        <MobileSwitchRow
          title={row.title}
          description={row.description}
          value={toggle}
          onChange={setToggle}
        />
      );
    case "select":
      return (
        <View style={ui.column}>
          <Text style={mobileType.label}>{row.title}</Text>
          <MobileSelect
            accessibilityLabel={row.title}
            testID={row.title}
            value={value}
            onChange={setValue}
            options={row.options.map((label) => ({ label, value: label }))}
          />
        </View>
      );
    case "field":
      return (
        <MobileTextField
          label={row.title}
          value={value}
          onChange={setValue}
          {...(row.secure === undefined ? {} : { secure: row.secure })}
        />
      );
    case "info":
      return <MobileListRow title={row.title} description={row.description} />;
    case "action":
      return (
        <MobileListRow
          title={row.title}
          description={row.description}
          {...(row.destructive === undefined
            ? {}
            : { destructive: row.destructive })}
          onPress={() => onAction(row)}
        />
      );
  }
}

export function SettingsMockup({
  panel = "hub",
}: {
  readonly panel?: PreviewSettingsPanel | "hub";
}) {
  const [selected, setSelected] = useState(panel);
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<Extract<
    SettingRow,
    { kind: "action" }
  > | null>(null);
  const category = SETTINGS_CATEGORIES.find((item) => item.id === selected);
  const layout = selected === "hub" ? null : panels[selected];
  return (
    <>
      <PreviewFrame
        title={category?.title ?? "Settings"}
        {...(layout
          ? { subtitle: layout.summary, onBack: () => setSelected("hub") }
          : {})}
      >
        {selected === "hub" ? (
          SETTINGS_CATEGORY_SECTIONS.map((section) => (
            <PreviewSection key={section.id} title={section.title}>
              <View style={ui.card}>
                {SETTINGS_CATEGORIES.filter(
                  (item) => item.section === section.id,
                ).map((item) => (
                  <SettingsTileRoute
                    key={item.id}
                    category={item}
                    onPress={() => {
                      if (item.id in panels) {
                        const match = Object.keys(panels).find(
                          (key): key is PreviewSettingsPanel => key === item.id,
                        );
                        if (match) setSelected(match);
                      }
                    }}
                  />
                ))}
              </View>
            </PreviewSection>
          ))
        ) : layout ? (
          <View style={[ui.card, ui.padded]}>
            {layout.rows.map((row) => (
              <SettingControl
                key={`${selected}-${row.title}`}
                row={row}
                onAction={(action) => {
                  if (action.destructive) setConfirmation(action);
                  else setNotice(`${action.title} preview ready`);
                }}
              />
            ))}
          </View>
        ) : null}
        {selected === "diagnostics" ? (
          <MobileProgress
            label="Disposable cache · 64 MiB of 256 MiB"
            value={0.25}
          />
        ) : null}
        {layout ? (
          <MobileButton
            accessibilityLabel="Save preferences"
            onPress={() => setNotice("Preferences saved in preview")}
            testID="save-settings"
            variant="primary"
          >
            Save preferences
          </MobileButton>
        ) : null}
        {notice ? (
          <MobileSnackbar
            message={notice}
            actionLabel="Dismiss"
            onAction={() => setNotice("")}
          />
        ) : null}
      </PreviewFrame>
      <MobileDialog
        title={confirmation?.title ?? "Confirm action"}
        message={confirmation?.description ?? ""}
        confirmLabel="Confirm"
        destructive
        visible={confirmation !== null}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          setNotice(`${confirmation?.title ?? "Action"} completed in preview`);
          setConfirmation(null);
        }}
      />
    </>
  );
}
