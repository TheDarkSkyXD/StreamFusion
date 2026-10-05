import { useState } from "react";
import { Check, Ellipsis, Shield, X } from "lucide-react-native";
import { Text, View } from "react-native";

import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileChoiceGroup } from "@mobile/design/choice-group";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileListRow } from "@mobile/design/list-row";
import { MobileSelect } from "@mobile/design/select";
import { MobileSnackbar } from "@mobile/design/feedback";
import { MobileTextField } from "@mobile/design/text-input";
import { mobileColors as colors, mobileType } from "@mobile/design/tokens";

import { PreviewAvatar } from "./catalog-elements";
import {
  PreviewFrame,
  PreviewSection,
  previewStyles as ui,
} from "./preview-frame";

export const moderationTools = [
  {
    id: "chat",
    title: "Live chat",
    description: "Message actions and user history",
  },
  {
    id: "automod",
    title: "AutoMod queue",
    description: "Review held Twitch messages",
  },
  {
    id: "retention",
    title: "Retention",
    description: "Kick retention controls",
  },
  {
    id: "logs",
    title: "Mod actions",
    description: "Search recent moderator activity",
  },
  { id: "banned", title: "Banned users", description: "Review channel bans" },
  {
    id: "unban",
    title: "Unban requests",
    description: "Review pending appeals",
  },
  {
    id: "moderators",
    title: "Moderators",
    description: "Channel moderation roles",
  },
  { id: "vips", title: "VIPs", description: "Community roles" },
  {
    id: "stream",
    title: "Stream tools",
    description: "Title, category, and chat modes",
  },
  {
    id: "activity",
    title: "Channel activity",
    description: "Follows and subscriptions",
  },
  {
    id: "community",
    title: "Community",
    description: "Active chatters and moderators",
  },
  { id: "rewards", title: "Rewards", description: "Review reward redemptions" },
  {
    id: "suspicious",
    title: "Suspicious activity",
    description: "Review flagged chatters",
  },
  {
    id: "whispers",
    title: "Whispers",
    description: "Private moderator conversations",
  },
  {
    id: "provider",
    title: "Platform tools",
    description: "Open provider-owned controls",
  },
] as const;
export type ModerationTool = (typeof moderationTools)[number]["id"];
export type ModerationMockupKind =
  "home" | "workspace" | "user-history" | "timeout" | "raid" | ModerationTool;

export function ModerationMockup({
  kind = "home",
  platform = "twitch",
}: {
  readonly kind?: ModerationMockupKind;
  readonly platform?: "twitch" | "kick";
}) {
  const [tool, setTool] = useState(kind);
  const [channel, setChannel] = useState(platform);
  const [notice, setNotice] = useState("");
  const [sheet, setSheet] = useState(
    kind === "timeout" || kind === "user-history",
  );
  const [timeout, setTimeout] = useState("600");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("One more adventure before sunrise");
  const [reviewed, setReviewed] = useState<string[]>([]);
  const visibleTools = moderationTools.filter((item) =>
    channel === "twitch"
      ? item.id !== "retention"
      : !["automod", "rewards", "vips", "whispers"].includes(item.id),
  );
  const toolTitle =
    moderationTools.find((item) => item.id === tool)?.title ??
    (tool === "home"
      ? "Moderation"
      : tool === "raid"
        ? "Choose a raid target"
        : "aurora workspace");
  const review =
    tool === "automod" ||
    tool === "unban" ||
    tool === "suspicious" ||
    tool === "rewards";
  const people = ["banned", "moderators", "vips", "community"].includes(tool);
  return (
    <>
      <PreviewFrame
        title={toolTitle}
        subtitle="Android design proposal"
        {...(tool !== "home" ? { onBack: () => setTool("home") } : {})}
        headerAction={
          <MobileIconButton
            label="Channel tools"
            onPress={() => setSheet(true)}
          >
            <Shield color={colors.textPrimary} size={22} />
          </MobileIconButton>
        }
      >
        <MobileSelect
          accessibilityLabel="Channel workspace"
          testID="mod-channel"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "twitch", label: "aurora · Twitch" },
            { value: "kick", label: "atlas · Kick" },
          ]}
        />
        {tool === "home" || tool === "workspace" ? (
          <>
            <View style={[ui.card, ui.padded]}>
              <View style={ui.row}>
                <PreviewAvatar
                  name={channel === "twitch" ? "aurora" : "atlas"}
                />
                <View>
                  <Text style={mobileType.title}>
                    {channel === "twitch" ? "aurora" : "atlas"}
                  </Text>
                  <Text style={mobileType.label}>
                    Verified moderator role · proposal fixture
                  </Text>
                </View>
              </View>
              <Text style={mobileType.body}>
                Focus on one task at a time. Keep the channel context when
                moving between tools.
              </Text>
            </View>
            <PreviewSection title="Channel tools">
              <View style={ui.card}>
                {visibleTools.map((item) => (
                  <MobileListRow
                    key={item.id}
                    title={item.title}
                    description={item.description}
                    onPress={() => setTool(item.id)}
                  />
                ))}
              </View>
            </PreviewSection>
          </>
        ) : null}
        {tool === "chat" ? (
          <>
            <Text style={mobileType.label}>
              Tap a message to view user history and moderation actions.
            </Text>
            {["juniper", "river", "kai", "moss"].map((name) => (
              <MobileListRow
                key={name}
                title={name}
                description={
                  name === "river"
                    ? "This message needs a closer look."
                    : "The new build looks good!"
                }
                leading={<PreviewAvatar name={name} />}
                onPress={() => setSheet(true)}
                trailing={<Ellipsis color={colors.textPrimary} size={20} />}
              />
            ))}
          </>
        ) : null}
        {review ? (
          <PreviewSection
            title={tool === "unban" ? "Pending appeals" : "Needs review"}
          >
            {["river", "kai", "moss"]
              .filter((name) => !reviewed.includes(name))
              .map((name) => (
                <View key={name} style={[ui.card, ui.padded]}>
                  <View style={ui.row}>
                    <PreviewAvatar name={name} />
                    <Text style={mobileType.title}>{name}</Text>
                  </View>
                  <Text style={mobileType.body}>
                    {tool === "unban"
                      ? "I understand the channel rules. Can I have another chance?"
                      : tool === "rewards"
                        ? "Redeemed: choose the next build · 1,000 points"
                        : "Message held for review · Possible harassment"}
                  </Text>
                  <View style={ui.row}>
                    <MobileButton
                      accessibilityLabel={`Approve ${name}`}
                      onPress={() => {
                        setReviewed([...reviewed, name]);
                        setNotice(`${name} approved in preview`);
                      }}
                      testID={`approve-${name}`}
                      variant="primary"
                    >
                      Approve
                    </MobileButton>
                    <MobileButton
                      accessibilityLabel={`Reject ${name}`}
                      onPress={() => setConfirm(`Reject ${name}?`)}
                      testID={`reject-${name}`}
                      variant="secondary"
                    >
                      Reject
                    </MobileButton>
                    <MobileIconButton
                      label={`View ${name} history`}
                      onPress={() => setSheet(true)}
                    >
                      <Ellipsis color={colors.textPrimary} size={22} />
                    </MobileIconButton>
                  </View>
                </View>
              ))}
          </PreviewSection>
        ) : null}
        {people ? (
          <>
            <MobileTextField
              label="Search users"
              value={query}
              onChange={setQuery}
            />
            {["juniper", "river", "kai", "moss"]
              .filter((name) => name.includes(query.toLowerCase()))
              .map((name) => (
                <MobileListRow
                  key={name}
                  title={name}
                  description={
                    tool === "banned"
                      ? "Banned · 2 days ago · Channel rule violation"
                      : tool === "moderators"
                        ? "Moderator · Active today"
                        : tool === "vips"
                          ? "VIP · Community member"
                          : "Active in chat"
                  }
                  leading={<PreviewAvatar name={name} />}
                  onPress={() => setSheet(true)}
                />
              ))}
          </>
        ) : null}
        {tool === "stream" ? (
          <>
            <MobileTextField
              label="Stream title"
              value={title}
              onChange={setTitle}
            />
            <MobileSelect
              accessibilityLabel="Category"
              testID="mod-category"
              value="minecraft"
              onChange={() => setNotice("Category changed in preview")}
              options={[
                { value: "minecraft", label: "Minecraft" },
                { value: "chat", label: "Just Chatting" },
              ]}
            />
            <View style={ui.row}>
              {["Slow mode", "Followers only", "Subscribers only"].map(
                (label) => (
                  <MobileFilterChip
                    key={label}
                    accessibilityLabel={label}
                    label={label}
                    selected={notice === label}
                    onPress={() => setNotice(label)}
                    testID={label}
                  />
                ),
              )}
            </View>
            <MobileButton
              accessibilityLabel="Save stream details"
              onPress={() => setNotice("Stream details saved in preview")}
              testID="save-stream"
              variant="primary"
            >
              Save details
            </MobileButton>
            <MobileListRow title="Start raid" onPress={() => setTool("raid")} />
          </>
        ) : null}
        {tool === "raid" ? (
          <>
            <MobileTextField
              label="Find a live channel"
              value={query}
              onChange={setQuery}
            />
            {["moss", "atlas", "juniper"].map((name) => (
              <MobileListRow
                key={name}
                title={name}
                description="Live · Just Chatting"
                leading={<PreviewAvatar name={name} />}
                onPress={() => setConfirm(`Raid ${name}?`)}
              />
            ))}
          </>
        ) : null}
        {tool === "logs" || tool === "activity" ? (
          <>
            <MobileTextField
              label="Filter activity"
              value={query}
              onChange={setQuery}
            />
            <View style={ui.row}>
              {["All", "Bans", "Timeouts", "Messages"].map((label) => (
                <MobileFilterChip
                  key={label}
                  accessibilityLabel={label}
                  label={label}
                  selected={query === label}
                  onPress={() => setQuery(label)}
                  testID={label}
                />
              ))}
            </View>
            {[
              "juniper timed out river · 10 minutes",
              "aurora updated the stream title",
              "kai followed the channel",
            ].map((entry) => (
              <MobileListRow
                title={entry}
                description="Today · 09:41"
                key={entry}
              />
            ))}
          </>
        ) : null}
        {tool === "retention" ? (
          <View style={[ui.card, ui.padded]}>
            <Text style={mobileType.title}>Kick retention</Text>
            <Text style={mobileType.body}>
              Provider-supported retention settings remain specific to this
              channel.
            </Text>
            <MobileSelect
              accessibilityLabel="Retention window"
              value={timeout}
              onChange={setTimeout}
              testID="retention"
              options={[
                { value: "600", label: "10 minutes" },
                { value: "3600", label: "1 hour" },
              ]}
            />
            <MobileButton
              accessibilityLabel="Apply retention"
              onPress={() => setNotice("Retention saved in preview")}
              testID="save-retention"
              variant="primary"
            >
              Apply
            </MobileButton>
          </View>
        ) : null}
        {tool === "whispers" ? (
          <PreviewSection title="Moderator conversations">
            <MobileListRow
              title="juniper"
              description="Can you review the held messages?"
              leading={<PreviewAvatar name="juniper" />}
              onPress={() => setNotice("Whisper thread preview opened")}
            />
          </PreviewSection>
        ) : null}
        {tool === "provider" ? (
          <View style={[ui.card, ui.padded]}>
            <Text style={mobileType.title}>Open platform controls</Text>
            <Text style={mobileType.body}>
              Some tools belong to the provider. Return to this workspace after
              using them.
            </Text>
            <MobileButton
              accessibilityLabel="Open provider dashboard"
              onPress={() => setNotice("External dashboard preview")}
              testID="provider-dashboard"
              variant={channel}
            >
              Open dashboard
            </MobileButton>
          </View>
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
        title="river · User actions"
        visible={sheet}
        onDismiss={() => setSheet(false)}
        size="expanded"
      >
        <View style={ui.row}>
          <PreviewAvatar name="river" />
          <View>
            <Text style={mobileType.title}>river</Text>
            <Text style={mobileType.label}>
              Following since 2024 · 3 previous actions
            </Text>
          </View>
        </View>
        <Text style={mobileType.body}>
          09:40 · This message needs a closer look.
        </Text>
        <Text style={mobileType.body}>
          09:38 · Joining the adventure tonight.
        </Text>
        <MobileChoiceGroup
          label="Timeout duration"
          value={timeout}
          onChange={setTimeout}
          options={[
            { value: "60", label: "1 minute" },
            { value: "600", label: "10 minutes" },
            { value: "3600", label: "1 hour" },
          ]}
        />
        <View style={ui.row}>
          <MobileButton
            accessibilityLabel="Timeout river"
            onPress={() => {
              setSheet(false);
              setNotice(`Timeout for ${timeout} seconds saved in preview`);
            }}
            testID="timeout"
            variant="secondary"
          >
            Timeout
          </MobileButton>
          <MobileButton
            accessibilityLabel="Ban river"
            onPress={() => {
              setSheet(false);
              setConfirm("Ban river?");
            }}
            testID="ban"
            variant="destructive"
          >
            Ban user
          </MobileButton>
        </View>
        <MobileListRow
          title="Unban user"
          leading={<Check color={colors.textPrimary} size={20} />}
          onPress={() => {
            setSheet(false);
            setConfirm("Unban river?");
          }}
        />
        <MobileListRow
          title="Delete message"
          leading={<X color={colors.textPrimary} size={20} />}
          onPress={() => {
            setSheet(false);
            setConfirm("Delete message?");
          }}
        />
        <MobileListRow
          title="Pin message"
          onPress={() => {
            setSheet(false);
            setNotice("Message pinned in preview");
          }}
        />
      </MobileBottomSheet>
      <MobileDialog
        title={confirm ?? "Confirm action"}
        message="Review the channel and user before continuing. This proposal does not call the platform API."
        confirmLabel="Confirm"
        destructive
        visible={confirm !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setNotice(`${confirm ?? "Action"} completed in preview`);
          setConfirm(null);
        }}
      />
    </>
  );
}
