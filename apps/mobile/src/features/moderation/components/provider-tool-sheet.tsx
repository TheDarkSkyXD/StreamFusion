import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AppState, StyleSheet, Text, View } from "react-native";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileChoiceGroup } from "@mobile/design/choice-group";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileListRow, MobileSwitchRow } from "@mobile/design/list-row";
import { MobileTextField } from "@mobile/design/text-input";
import { mobileColors, mobileSpacing, mobileType } from "@mobile/design/tokens";
import type {
  ModerationChannel,
  ModerationCommand,
} from "../capabilities/moderation";
import {
  automodCategories,
  type AutoModPolicy,
  type CategoryPage,
  type ChannelTool,
  type ChannelToolCommand,
  type FeedKind,
  type FeedState,
  type StreamInfo,
} from "../capabilities/provider-tools";
import type { ModerationController } from "../domain/moderation-controller";
import type {
  ProviderToolsController,
  ProviderToolsSnapshot,
} from "../domain/provider-tools-controller";
import { WorkflowFeedback } from "./workflow-feedback";

export type ProviderWorkspaceTool =
  | "banned"
  | "unban-requests"
  | "moderators"
  | "vips"
  | "settings"
  | "stream"
  | "logs"
  | "retention"
  | "activity"
  | "community"
  | "rewards"
  | "suspicious"
  | "whispers"
  | "provider"
  | "automod";
export const providerToolTitles: Readonly<
  Record<ProviderWorkspaceTool, string>
> = {
  banned: "Banned users",
  "unban-requests": "Pending unban requests",
  moderators: "Moderators",
  vips: "VIPs",
  settings: "Chat settings",
  stream: "Channel tools",
  logs: "Mod Actions",
  retention: "Retention",
  activity: "Activity Feed",
  community: "Community",
  rewards: "Reward Requests",
  suspicious: "Suspicious Activity",
  whispers: "Whispers",
  provider: "More Twitch tools",
  automod: "AutoMod Queue",
};
const providerTitleKeys: Readonly<Record<ProviderWorkspaceTool, string>> = {
  banned: "moderation.bannedUsers",
  "unban-requests": "moderation.pendingUnbanRequests",
  moderators: "moderation.moderators",
  vips: "moderation.vips",
  settings: "moderation.chatMode",
  stream: "moderation.tools.channelTools",
  logs: "moderation.workspace.modActions",
  retention: "moderation.retention",
  activity: "moderation.workspacePanels.activity",
  community: "moderation.workspacePanels.community",
  rewards: "moderation.workspacePanels.rewards",
  suspicious: "moderation.workspacePanels.suspicious",
  whispers: "moderation.workspacePanels.whispers",
  provider: "moderation.tools.native.title",
  automod: "moderation.autoMod.queueTitle",
};
const streamTools: readonly {
  readonly id: ChannelTool;
  readonly title: string;
}[] = [
  { id: "stream-info", title: "Edit Stream Info" },
  { id: "shield", title: "Shield Mode" },
  { id: "automod-policy", title: "AutoMod settings" },
  { id: "blocked-terms", title: "Blocked terms" },
  { id: "raid-targets", title: "Raid" },
];
type Confirmation =
  | { readonly kind: "channel"; readonly command: ChannelToolCommand }
  | { readonly kind: "moderation"; readonly command: ModerationCommand };
export function ProviderToolSheet({
  controller,
  moderation,
  channel,
  tool,
  onDismiss,
  onOpenProvider,
  onRequestScopes,
}: {
  readonly controller: ProviderToolsController;
  readonly moderation: ModerationController;
  readonly channel: ModerationChannel;
  readonly tool: ProviderWorkspaceTool;
  readonly onDismiss: () => void;
  readonly onOpenProvider: () => void;
  readonly onRequestScopes: (scopes: readonly string[]) => void;
}) {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const moderationSnapshot = useSyncExternalStore(
    moderation.subscribe,
    moderation.getSnapshot,
    moderation.getSnapshot,
  );
  const [streamTool, setStreamTool] = useState<ChannelTool>("stream-info");
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [target, setTarget] = useState<{
    readonly id: string;
    readonly name: string;
    readonly messageId: string | null;
  } | null>(null);
  const [userDuration, setUserDuration] = useState("600");
  const [userReason, setUserReason] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [recipient, setRecipient] = useState("");
  const [whisper, setWhisper] = useState("");
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const pending =
    snapshot.activity.kind === "pending" ||
    moderationSnapshot.activity.kind === "pending";
  const selectedRead =
    tool === "stream"
      ? streamTool
      : tool === "community" || tool === "rewards"
        ? tool
        : null;
  const feed: FeedKind | null =
    tool === "logs"
      ? "actions"
      : tool === "activity" ||
          tool === "suspicious" ||
          tool === "whispers" ||
          tool === "rewards" ||
          tool === "automod"
        ? tool
        : null;
  useEffect(() => {
    if (channel.platform !== "twitch") {
      if (tool === "logs" || tool === "retention")
        void controller.readHistory();
      return;
    }
    if (selectedRead) void controller.read(selectedRead);
    if (tool === "logs" || tool === "retention") void controller.readHistory();
    if (
      feed &&
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive"
    )
      void controller.startFeed(feed);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (feed) void controller.startFeed(feed);
      } else {
        controller.stopFeed();
        controller.cancel();
      }
    });
    return () => {
      listener.remove();
      controller.stopFeed();
      controller.cancel();
    };
  }, [controller, channel.platform, tool, selectedRead, feed]);
  const days =
    retentionDraft ??
    String(
      snapshot.history.kind === "ready"
        ? snapshot.history.value.retentionDays
        : 30,
    );
  const validContext =
    snapshot.channel?.id === channel.id &&
    snapshot.channel.platform === channel.platform;
  function review(command: ChannelToolCommand) {
    setConfirm({ kind: "channel", command });
  }
  function reviewModeration(command: ModerationCommand) {
    setConfirm({ kind: "moderation", command });
  }
  function dismiss() {
    setConfirm(null);
    controller.stopFeed();
    controller.cancel();
    onDismiss();
  }
  const data = snapshot.data?.kind === selectedRead ? snapshot.data : null;
  const supported =
    channel.platform === "twitch" ||
    tool === "logs" ||
    tool === "retention" ||
    tool === "provider";
  return (
    <>
      <MobileBottomSheet
        visible
        title={
          channel.platform === "kick" && tool === "provider"
            ? "More Kick tools"
            : t(providerTitleKeys[tool], {
                defaultValue: providerToolTitles[tool],
              })
        }
        size="expanded"
        onDismiss={dismiss}
      >
        <Text style={mobileType.label}>
          {channel.name} · {channel.platform === "twitch" ? "Twitch" : "Kick"}
        </Text>
        {validContext ? (
          <WorkflowFeedback
            activity={snapshot.activity}
            onCancel={controller.cancel}
            onRequestScopes={onRequestScopes}
          />
        ) : (
          <Text style={mobileType.body}>
            Select this channel again to verify the current account.
          </Text>
        )}
        {validContext ? (
          <WorkflowFeedback
            activity={moderationSnapshot.activity}
            onCancel={moderation.cancel}
            onRequestScopes={onRequestScopes}
          />
        ) : null}
        {!supported ? (
          <Text style={mobileType.body}>
            Kick does not publish {providerToolTitles[tool].toLowerCase()}{" "}
            through its official API. Open the Kick channel for provider tools
            available there.
          </Text>
        ) : null}
        {supported && validContext && tool === "stream" ? (
          <>
            <View style={styles.row}>
              {streamTools.map((item) => (
                <MobileFilterChip
                  key={item.id}
                  label={item.title}
                  accessibilityLabel={`Open ${item.title}`}
                  selected={streamTool === item.id}
                  onPress={() => setStreamTool(item.id)}
                  testID={`mod-stream-${item.id}`}
                />
              ))}
            </View>
            <Text style={mobileType.label}>
              Stream information and raids require the broadcaster account.
              Other tools use their own moderator permissions.
            </Text>
            {data?.kind === "stream-info" ? (
              <StreamInfoForm
                key={`${snapshot.revision}:${data.title}`}
                value={data}
                categories={snapshot.categories}
                onSearchCategories={(query, more) =>
                  void controller.searchCategories(query, more)
                }
                pending={pending}
                onSave={(value) => review({ kind: "stream-info", value })}
              />
            ) : null}
            {data?.kind === "shield" ? (
              <>
                <MobileSwitchRow
                  title="Shield Mode"
                  description="Twitch protection settings"
                  value={data.active}
                  disabled={pending}
                  onChange={(active) => review({ kind: "shield", active })}
                />
                <Text style={mobileType.label}>
                  {data.activatedAt
                    ? `Last activated ${data.activatedAt}`
                    : "No activation timestamp returned."}
                </Text>
              </>
            ) : null}
            {data?.kind === "automod-policy" ? (
              <AutoModForm
                value={data}
                pending={pending}
                onSave={(value) => review({ kind: "automod-policy", value })}
              />
            ) : null}
            {data?.kind === "blocked-terms" ? (
              <>
                <MobileTextField
                  label="New blocked term"
                  value={term}
                  onChange={setTerm}
                  disabled={pending}
                  hint="2 to 500 characters"
                />
                <MobileButton
                  accessibilityLabel="Review adding blocked term"
                  variant="primary"
                  disabled={pending || !term.trim()}
                  onPress={() =>
                    review({ kind: "add-term", text: term.trim() })
                  }
                  testID="mod-term-add"
                >
                  Add blocked term
                </MobileButton>
                <MobileTextField
                  label="Search blocked terms"
                  value={search}
                  onChange={setSearch}
                />
                {data.terms.length === 0 ? (
                  <Text style={mobileType.body}>
                    No blocked terms returned by Twitch.
                  </Text>
                ) : null}
                {data.terms
                  .filter((item) =>
                    item.text.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((item) => (
                    <MobileListRow
                      key={item.id}
                      title={item.text}
                      description="Remove blocked term"
                      destructive
                      onPress={() =>
                        review({ kind: "remove-term", id: item.id })
                      }
                    />
                  ))}
                {data.cursor ? (
                  <MoreButton
                    pending={pending}
                    onPress={() => void controller.read("blocked-terms", true)}
                  />
                ) : null}
              </>
            ) : null}
            {streamTool === "raid-targets" ? (
              <>
                {snapshot.raid.kind === "pending" ? (
                  <View style={styles.card}>
                    <Text style={mobileType.title}>Raid pending</Text>
                    <Text style={mobileType.body}>
                      Target {snapshot.raid.targetId}. Scheduled{" "}
                      {snapshot.raid.createdAt}. Twitch runs the raid when you
                      choose Raid Now there or its 90-second countdown expires.
                      Completion has not been observed here.
                    </Text>
                    <MobileButton
                      accessibilityLabel="Review cancelling pending raid"
                      variant="destructive"
                      disabled={pending}
                      onPress={() => review({ kind: "cancel-raid" })}
                      testID="mod-raid-cancel"
                    >
                      Cancel pending raid
                    </MobileButton>
                  </View>
                ) : snapshot.raid.kind === "uncertain" ? (
                  <>
                    <Text style={mobileType.body}>
                      {snapshot.raid.detail} Check the raid in Twitch before
                      starting another.
                    </Text>
                    <MobileButton
                      accessibilityLabel="Review cancelling Twitch raid"
                      variant="outline"
                      disabled={pending}
                      onPress={() => review({ kind: "cancel-raid" })}
                      testID="mod-raid-uncertain-cancel"
                    >
                      Ask Twitch to cancel raid
                    </MobileButton>
                  </>
                ) : null}
                <MobileTextField
                  label="Search loaded live targets"
                  value={search}
                  onChange={setSearch}
                />
                {data?.kind === "raid-targets" ? (
                  <>
                    {data.targets.length === 0 ? (
                      <Text style={mobileType.body}>
                        No live targets returned.
                      </Text>
                    ) : null}
                    {data.targets
                      .filter((item) =>
                        `${item.name} ${item.title}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((item) => (
                        <MobileListRow
                          key={item.id}
                          title={item.name}
                          description={`${item.title} · ${item.viewers.toLocaleString()} viewers`}
                          disabled={pending || snapshot.raid.kind !== "idle"}
                          onPress={() =>
                            review({ kind: "raid", targetId: item.id })
                          }
                        />
                      ))}
                    {data.cursor ? (
                      <MoreButton
                        pending={pending}
                        onPress={() =>
                          void controller.read("raid-targets", true)
                        }
                      />
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            <MobileButton
              accessibilityLabel={`Refresh ${streamTool}`}
              disabled={pending}
              variant="outline"
              onPress={() => void controller.read(streamTool)}
              testID="mod-stream-refresh"
            >
              Refresh tool
            </MobileButton>
          </>
        ) : null}
        {supported && validContext && tool === "community" ? (
          <>
            <Text style={mobileType.body}>
              Twitch chatters are the current connected chat users. This is not
              a viewer list or a presence guarantee for moderators.
            </Text>
            <MobileTextField
              label="Search loaded chatters"
              value={search}
              onChange={setSearch}
            />
            {data?.kind === "community" ? (
              <>
                <Text style={mobileType.label}>
                  {data.total.toLocaleString()} chatters reported by Twitch
                </Text>
                {data.people
                  .filter((person) =>
                    `${person.name} ${person.login}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((person) => (
                    <MobileListRow
                      key={person.id}
                      title={person.name}
                      description={`@${person.login}`}
                      leading={<PersonInitial name={person.name} />}
                      onPress={() => {
                        setTarget({ ...person, messageId: null });
                        void controller.readHistory();
                      }}
                    />
                  ))}
                {data.people.length === 0 ? (
                  <Text style={mobileType.body}>No chatters returned.</Text>
                ) : null}
                {data.cursor ? (
                  <MoreButton
                    pending={pending}
                    onPress={() => void controller.read("community", true)}
                  />
                ) : null}
              </>
            ) : null}
            <MobileButton
              accessibilityLabel="Refresh Twitch chatters"
              disabled={pending}
              variant="outline"
              onPress={() => void controller.read("community")}
              testID="mod-community-refresh"
            >
              Refresh chatters
            </MobileButton>
          </>
        ) : null}
        {supported && validContext && tool === "rewards" ? (
          <>
            <Text style={mobileType.body}>
              Decisions are available only for pending redemptions of rewards
              created by this Twitch application. The live feed may observe
              other rewards without granting permission to decide them.
            </Text>
            {data?.kind === "rewards" ? (
              <>
                {data.rewards.length === 0 ? (
                  <Text style={mobileType.body}>
                    This Twitch application has no manageable rewards on this
                    channel.
                  </Text>
                ) : null}
                {data.rewards.map((reward) => (
                  <MobileListRow
                    key={reward.id}
                    title={reward.title}
                    description={`${reward.cost.toLocaleString()} points · Read pending requests`}
                    onPress={() =>
                      void controller.read("rewards", false, reward.id)
                    }
                  />
                ))}
                {data.rewardId && data.redemptions.length === 0 ? (
                  <Text style={mobileType.body}>
                    No pending requests returned for this reward.
                  </Text>
                ) : null}
                {data.redemptions.map((item) => (
                  <View key={item.id} style={styles.card}>
                    <MobileListRow
                      title={item.name}
                      description={item.title}
                      leading={<PersonInitial name={item.name} />}
                    />
                    <Text style={mobileType.body}>
                      {item.input || "No message included"}
                    </Text>
                    <View style={styles.row}>
                      {(["FULFILLED", "CANCELED"] as const).map((status) => (
                        <MobileButton
                          key={status}
                          accessibilityLabel={`${status === "FULFILLED" ? "Fulfill" : "Refund"} reward for ${item.name}`}
                          variant={
                            status === "FULFILLED" ? "secondary" : "destructive"
                          }
                          disabled={pending || item.status !== "UNFULFILLED"}
                          onPress={() =>
                            review({
                              kind: "reward-decision",
                              rewardId: item.rewardId,
                              redemptionId: item.id,
                              status,
                            })
                          }
                          testID={`mod-reward-${status}-${item.id}`}
                        >
                          {t(
                            `moderation.workspacePanels.${status === "FULFILLED" ? "fulfillReward" : "cancelReward"}`,
                            {
                              defaultValue:
                                status === "FULFILLED"
                                  ? "Fulfill request"
                                  : "Cancel request",
                            },
                          )}
                        </MobileButton>
                      ))}
                    </View>
                  </View>
                ))}
                {data.cursor ? (
                  <MoreButton
                    pending={pending}
                    onPress={() =>
                      void controller.read("rewards", true, data.rewardId)
                    }
                  />
                ) : null}
              </>
            ) : null}
            <MobileButton
              accessibilityLabel="Refresh manageable Twitch rewards"
              disabled={pending}
              variant="outline"
              onPress={() => void controller.read("rewards")}
              testID="mod-rewards-refresh"
            >
              Refresh rewards
            </MobileButton>
          </>
        ) : null}
        {supported && validContext && feed ? (
          <>
            <ObservedFeed
              state={snapshot.feed}
              tool={feed}
              onRequestScopes={onRequestScopes}
              onReconnect={() => void controller.startFeed(feed)}
              onUser={(id, name, messageId) => {
                setTarget({ id, name, messageId });
                void controller.readHistory();
              }}
              onModerate={reviewModeration}
              onCommand={review}
              pending={pending}
            />
            {tool === "activity" ? (
              <Text style={mobileType.label}>
                Follows, raids, and stream state are observed here. Subscription
                and Bits events are included only when the broadcaster granted
                their additional scopes.
              </Text>
            ) : null}
            {tool === "whispers" ? (
              <>
                <Text style={mobileType.body}>
                  Whispers observed for your connected Twitch account since this
                  connection. This is not a historical inbox. Twitch limits
                  whisper sending and may silently drop messages.
                </Text>
                <MobileTextField
                  label="Recipient Twitch user ID"
                  value={recipient}
                  onChange={setRecipient}
                  disabled={pending}
                />
                <MobileTextField
                  label="Whisper message"
                  value={whisper}
                  onChange={setWhisper}
                  disabled={pending}
                />
                <MobileButton
                  accessibilityLabel="Review sending whisper"
                  disabled={pending || !recipient || !whisper.trim()}
                  variant="primary"
                  onPress={() =>
                    review({
                      kind: "whisper",
                      userId: recipient,
                      text: whisper,
                    })
                  }
                  testID="mod-whisper-send"
                >
                  Review whisper
                </MobileButton>
              </>
            ) : null}
          </>
        ) : null}
        {validContext && (tool === "logs" || tool === "retention") ? (
          <>
            <LocalModerationHistory state={snapshot.history} />
            {tool === "retention" ? (
              <>
                <MobileTextField
                  label="Keep local moderation log for days"
                  hint="1 to 365 days. This affects only StreamFusion history on this device."
                  value={days}
                  onChange={setRetentionDraft}
                />
                <MobileButton
                  accessibilityLabel="Save local moderation history retention"
                  variant="primary"
                  onPress={() =>
                    void controller
                      .setRetention(Number(days))
                      .then(() => setRetentionDraft(null))
                  }
                  testID="mod-retention-save"
                >
                  Save local retention
                </MobileButton>
              </>
            ) : null}
            <MobileButton
              accessibilityLabel="Refresh local moderation history"
              variant="outline"
              onPress={() => void controller.readHistory()}
              testID="mod-history-refresh"
            >
              Refresh local history
            </MobileButton>
          </>
        ) : null}
        {tool === "provider" ? (
          <Text style={mobileType.body}>
            {channel.platform === "twitch"
              ? "Open Twitch Mod View for provider-owned controls, go-live notifications, and tools not available through the API."
              : "Open this channel on Kick. Kick does not publish official list, role-management, live-feed, or engagement APIs for these tools. This link opens the channel, rather than a verified tool-specific page."}
          </Text>
        ) : null}
        <MobileButton
          accessibilityLabel={`Open ${channel.platform} provider tools for ${channel.name}`}
          variant="outline"
          onPress={onOpenProvider}
          testID="mod-tool-provider"
        >{`Open ${channel.platform === "twitch" ? "Twitch Mod View" : "Kick channel"}`}</MobileButton>
      </MobileBottomSheet>
      {target ? (
        <MobileBottomSheet
          visible
          title={target.name}
          size="expanded"
          onDismiss={() => setTarget(null)}
        >
          <Text style={mobileType.label}>
            Provider user ID {target.id} · {channel.name}
          </Text>
          <LocalModerationHistory state={snapshot.history} userId={target.id} />
          <TimeoutDurationPicker
            value={userDuration}
            onChange={setUserDuration}
            pending={pending}
          />
          <MobileTextField
            label="Reason"
            value={userReason}
            onChange={setUserReason}
            disabled={pending}
          />
          <View style={styles.row}>
            <MobileButton
              accessibilityLabel={`Review timeout for ${target.name}`}
              disabled={pending}
              variant="secondary"
              onPress={() =>
                reviewModeration({
                  kind: "timeout",
                  userId: target.id,
                  durationSeconds: Number(userDuration),
                  reason: userReason,
                })
              }
              testID="mod-user-timeout"
            >
              Timeout
            </MobileButton>
            <MobileButton
              accessibilityLabel={`Review banning ${target.name}`}
              disabled={pending}
              variant="destructive"
              onPress={() =>
                reviewModeration({
                  kind: "ban",
                  userId: target.id,
                  reason: userReason,
                })
              }
              testID="mod-user-ban"
            >
              Ban
            </MobileButton>
          </View>
          <MobileListRow
            title="Unban user"
            disabled={pending}
            onPress={() =>
              reviewModeration({ kind: "unban", userId: target.id })
            }
          />
          {target.messageId ? (
            <MobileListRow
              title="Delete message"
              destructive
              disabled={pending}
              onPress={() => {
                if (target.messageId)
                  reviewModeration({
                    kind: "delete-message",
                    messageId: target.messageId,
                  });
              }}
            />
          ) : null}
          <MobileListRow
            title="Provider tools"
            description="Open the provider for tools such as message pinning that its API does not expose."
            onPress={onOpenProvider}
          />
        </MobileBottomSheet>
      ) : null}
      <MobileDialog
        visible={confirm !== null && validContext}
        title="Confirm provider action"
        message={confirm ? confirmationText(confirm, channel) : ""}
        confirmLabel="Confirm action"
        destructive={confirm?.command.kind !== "stream-info"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const value = confirm;
          setConfirm(null);
          if (!value || !validContext) return;
          if (value.kind === "moderation")
            void moderation.execute(value.command);
          else
            void controller.execute(value.command).then(() => {
              if (
                selectedRead &&
                controller.getSnapshot().activity.kind === "success"
              )
                void controller.read(selectedRead);
            });
        }}
      />
    </>
  );
}
function confirmationText(value: Confirmation, channel: ModerationChannel) {
  const command = value.command;
  if (command.kind === "raid")
    return `Schedule a pending raid from ${channel.name} to live Twitch channel ${command.targetId}? Twitch runs it after its countdown or Raid Now. You can cancel while it is pending.`;
  if (command.kind === "cancel-raid")
    return `Ask Twitch to cancel the pending raid from ${channel.name}? Twitch can reject this if the raid has already happened.`;
  if (command.kind === "reward-decision")
    return `${command.status === "FULFILLED" ? "Fulfill" : "Cancel and refund points for"} redemption ${command.redemptionId} in ${channel.name}?`;
  if (command.kind === "whisper")
    return `Send this message from your connected Twitch account to user ${command.userId}?`;
  if (command.kind === "automod")
    return `${command.action === "ALLOW" ? "Allow" : "Deny"} held message ${command.messageId} in ${channel.name}?`;
  if (command.kind === "timeout")
    return `Timeout user ${command.userId} in ${channel.name} for ${command.durationSeconds} seconds?`;
  if (command.kind === "suspicious-status")
    return `${command.status === "RESTRICTED" ? "Restrict" : command.status === "ACTIVE_MONITORING" ? "Monitor" : "Clear suspicious treatment for"} user ${command.userId} in ${channel.name}?`;
  if (command.kind === "shield")
    return `${command.active ? "Activate" : "Deactivate"} Twitch Shield Mode in ${channel.name}?`;
  return `Apply ${command.kind.replaceAll("-", " ")} in ${channel.name}${"userId" in command ? ` for user ${command.userId}` : ""}${"messageId" in command ? ` for message ${command.messageId}` : ""}?`;
}
export function PersonInitial({ name }: { readonly name: string }) {
  return (
    <View style={styles.initial}>
      <Text style={mobileType.title}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}
export function TimeoutDurationPicker({
  value,
  onChange,
  pending,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly pending: boolean;
}) {
  const standard = ["60", "600", "3600"].includes(value);
  return (
    <>
      {pending ? (
        <Text style={mobileType.label}>Timeout duration {value} seconds</Text>
      ) : (
        <MobileChoiceGroup
          label="Timeout duration"
          value={standard ? value : "custom"}
          options={[
            { label: "1 minute", value: "60" },
            { label: "10 minutes", value: "600" },
            { label: "1 hour", value: "3600" },
            { label: "Custom duration", value: "custom" },
          ]}
          onChange={(choice) => onChange(choice === "custom" ? "" : choice)}
        />
      )}
      {!standard ? (
        <MobileTextField
          label="Custom timeout duration in seconds"
          value={value}
          onChange={onChange}
          disabled={pending}
          hint="Kick requires whole minutes. Provider limits are checked before submission."
        />
      ) : null}
    </>
  );
}
function MoreButton({
  pending,
  onPress,
}: {
  readonly pending: boolean;
  readonly onPress: () => void;
}) {
  return (
    <MobileButton
      accessibilityLabel="Load more provider records"
      disabled={pending}
      variant="secondary"
      onPress={onPress}
      testID="mod-tool-more"
    >
      Load more
    </MobileButton>
  );
}
export function ObservedFeed({
  state,
  tool,
  onReconnect,
  onRequestScopes,
  onUser,
  onModerate,
  onCommand,
  pending,
}: {
  readonly state: FeedState;
  readonly tool: FeedKind;
  readonly onReconnect: () => void;
  readonly onRequestScopes: (scopes: readonly string[]) => void;
  readonly onUser: (id: string, name: string, messageId: string | null) => void;
  readonly onModerate: (command: ModerationCommand) => void;
  readonly onCommand: (command: ChannelToolCommand) => void;
  readonly pending: boolean;
}) {
  return (
    <>
      <Text style={mobileType.title}>
        {tool === "automod" ? "Held messages" : "Observed live events"}
      </Text>
      {state.kind === "connecting" ? (
        <Text accessibilityLiveRegion="polite" style={mobileType.body}>
          Connecting to Twitch EventSub...
        </Text>
      ) : null}
      {state.kind === "idle" ? (
        <Text style={mobileType.body}>Live feed is stopped.</Text>
      ) : null}
      {state.kind === "permission" ? (
        <>
          <Text style={mobileType.body}>{state.detail}</Text>
          {state.scopes.length ? (
            <MobileButton
              accessibilityLabel="Grant live feed permissions"
              variant="twitch"
              onPress={() => onRequestScopes(state.scopes)}
              testID="mod-feed-scopes"
            >
              Grant feed permissions
            </MobileButton>
          ) : null}
        </>
      ) : null}
      {state.kind === "failure" ? (
        <Text accessibilityLiveRegion="polite" style={mobileType.body}>
          {state.detail}
        </Text>
      ) : null}
      {state.kind === "live" || state.kind === "disconnected" ? (
        <>
          <Text style={mobileType.label}>
            {state.kind === "live" ? "Live" : "Disconnected"} · Observed since{" "}
            {state.since} · Latest 200 events
          </Text>
          {state.kind === "disconnected" ? (
            <Text style={mobileType.body}>
              Events during the disconnected period are unavailable. Reconnect
              starts new coverage.
            </Text>
          ) : null}
          {state.items.length === 0 ? (
            <Text style={mobileType.body}>
              {state.kind === "live"
                ? `No ${tool === "automod" ? "held messages" : "events"} observed since this connection.`
                : "No buffered events. This is not an empty live feed."}
            </Text>
          ) : null}
          {state.items.map((item) => (
            <View key={item.id} style={styles.card}>
              <MobileListRow
                title={item.name}
                description={`${item.action.replaceAll("channel.", "")} · ${item.occurredAt}`}
                leading={<PersonInitial name={item.name} />}
                {...(item.userId
                  ? {
                      onPress: () =>
                        onUser(item.userId ?? "", item.name, item.messageId),
                    }
                  : {})}
              />
              <Text style={mobileType.body}>{item.detail}</Text>
              {item.status ? (
                <Text style={mobileType.label}>{item.status}</Text>
              ) : null}
              {tool === "automod" &&
              item.messageId &&
              item.status === "held" ? (
                <View style={styles.row}>
                  {(["ALLOW", "DENY"] as const).map((action) => (
                    <MobileButton
                      key={action}
                      accessibilityLabel={`${action === "ALLOW" ? "Allow" : "Deny"} held message from ${item.name}`}
                      variant={action === "ALLOW" ? "secondary" : "destructive"}
                      disabled={pending || state.kind !== "live"}
                      onPress={() => {
                        if (item.messageId)
                          onModerate({
                            kind: "automod",
                            messageId: item.messageId,
                            action,
                          });
                      }}
                      testID={`mod-held-${action}-${item.messageId}`}
                    >
                      {action === "ALLOW" ? "Allow" : "Deny"}
                    </MobileButton>
                  ))}
                </View>
              ) : null}
              {tool === "suspicious" && item.userId ? (
                <View style={styles.row}>
                  {(
                    ["ACTIVE_MONITORING", "RESTRICTED", "NO_TREATMENT"] as const
                  ).map((status) => (
                    <MobileButton
                      key={status}
                      accessibilityLabel={`Review ${status.toLowerCase().replaceAll("_", " ")} for ${item.name}`}
                      variant={
                        status === "RESTRICTED" ? "destructive" : "outline"
                      }
                      disabled={pending || state.kind !== "live"}
                      onPress={() => {
                        if (item.userId)
                          onCommand({
                            kind: "suspicious-status",
                            userId: item.userId,
                            status,
                          });
                      }}
                      testID={`mod-suspicious-${status}-${item.userId}`}
                    >
                      {status === "ACTIVE_MONITORING"
                        ? "Monitor"
                        : status === "RESTRICTED"
                          ? "Restrict"
                          : "Clear treatment"}
                    </MobileButton>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
      {state.kind !== "connecting" ? (
        <MobileButton
          accessibilityLabel="Reconnect Twitch live feed"
          variant="outline"
          onPress={onReconnect}
          testID="mod-feed-reconnect"
        >
          {state.kind === "live"
            ? "Restart feed coverage"
            : "Connect live feed"}
        </MobileButton>
      ) : null}
    </>
  );
}
export function LocalModerationHistory({
  state,
  userId,
}: {
  readonly state: ProviderToolsSnapshot["history"];
  readonly userId?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "app-issued" | "app-observed">(
    "all",
  );
  const log = state.kind === "ready" ? state.value : null;
  const entries =
    log?.entries
      .filter(
        (entry) =>
          (!userId || entry.userId === userId) &&
          (filter === "all" || entry.source === filter) &&
          `${entry.action} ${entry.detail} ${entry.userId ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .slice()
      .reverse() ?? [];
  return (
    <>
      <Text style={mobileType.title}>
        {userId ? "Local user moderation history" : "Local moderation history"}
      </Text>
      <Text style={mobileType.body}>
        Only actions issued by this app or observed while its moderation feed
        was connected are stored here. Other actions and disconnected periods
        are missing. This is not complete provider history.
      </Text>
      {state.kind === "loading" ? (
        <Text style={mobileType.body}>Reading local history...</Text>
      ) : state.kind === "failure" ? (
        <Text style={mobileType.body}>{state.detail}</Text>
      ) : null}
      {log ? (
        <>
          <Text style={mobileType.label}>
            Collection started {new Date(log.startedAt).toLocaleString()} ·
            Retention {log.retentionDays} days · Maximum 1,000 records
          </Text>
          <MobileTextField
            label="Search local actions"
            value={query}
            onChange={setQuery}
          />
          <View style={styles.row}>
            {(["all", "app-issued", "app-observed"] as const).map((value) => (
              <MobileFilterChip
                key={value}
                label={
                  value === "all"
                    ? "All"
                    : value === "app-issued"
                      ? "Issued here"
                      : "Observed here"
                }
                selected={filter === value}
                accessibilityLabel={`Filter ${value} moderation actions`}
                onPress={() => setFilter(value)}
                testID={`mod-log-${value}`}
              />
            ))}
          </View>
          {entries.length === 0 ? (
            <Text style={mobileType.body}>
              No matching locally collected actions.
            </Text>
          ) : null}
          {entries.map((entry) => (
            <MobileListRow
              key={entry.id}
              title={entry.action.replaceAll("-", " ")}
              description={`${entry.detail} · ${entry.outcome} · ${new Date(entry.at).toLocaleString()}${entry.userId ? ` · User ${entry.userId}` : ""}`}
            />
          ))}
        </>
      ) : null}
    </>
  );
}
function StreamInfoForm({
  value,
  categories,
  onSearchCategories,
  pending,
  onSave,
}: {
  readonly value: StreamInfo;
  readonly categories: CategoryPage | null;
  readonly onSearchCategories: (query: string, more?: boolean) => void;
  readonly pending: boolean;
  readonly onSave: (value: StreamInfo) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [tags, setTags] = useState(value.tags.join(", "));
  const [categoryQuery, setCategoryQuery] = useState(value.categoryName);
  return (
    <>
      <MobileTextField
        label="Stream title"
        value={draft.title}
        disabled={pending}
        onChange={(title) => setDraft({ ...draft, title })}
      />
      <Text style={mobileType.label}>
        Selected category {draft.categoryName || "none"}
      </Text>
      <MobileTextField
        label="Search Twitch categories"
        value={categoryQuery}
        onChange={setCategoryQuery}
        disabled={pending}
      />
      <MobileButton
        accessibilityLabel="Search Twitch stream categories"
        variant="outline"
        disabled={pending || !categoryQuery.trim()}
        onPress={() => onSearchCategories(categoryQuery)}
        testID="mod-category-search"
      >
        Search categories
      </MobileButton>
      {categories?.query === categoryQuery.trim() ? (
        <>
          {categories.categories.length === 0 ? (
            <Text style={mobileType.body}>No matching Twitch categories.</Text>
          ) : null}
          {categories.categories.map((category) => (
            <MobileListRow
              key={category.id}
              title={category.name}
              description={
                draft.categoryId === category.id
                  ? "Selected category"
                  : "Use this category"
              }
              onPress={() =>
                setDraft({
                  ...draft,
                  categoryId: category.id,
                  categoryName: category.name,
                })
              }
            />
          ))}
          {categories.cursor ? (
            <MoreButton
              pending={pending}
              onPress={() => onSearchCategories(categoryQuery, true)}
            />
          ) : null}
        </>
      ) : null}
      <MobileTextField
        label="Broadcast language"
        hint="Two-letter code, such as en, or other"
        value={draft.language}
        disabled={pending}
        onChange={(language) => setDraft({ ...draft, language })}
      />
      <MobileTextField
        label="Stream tags"
        hint="Comma separated. Up to 10 tags, 25 letters or numbers each."
        value={tags}
        disabled={pending}
        onChange={setTags}
      />
      <Text style={mobileType.title}>Content classification labels</Text>
      {value.availableLabels.map((label) => (
        <MobileSwitchRow
          key={label.id}
          title={label.name}
          value={draft.labels.includes(label.id)}
          disabled={pending}
          onChange={(enabled) =>
            setDraft({
              ...draft,
              labels: enabled
                ? [...draft.labels, label.id]
                : draft.labels.filter((id) => id !== label.id),
            })
          }
        />
      ))}
      <MobileButton
        accessibilityLabel="Review stream information changes"
        variant="primary"
        disabled={pending}
        onPress={() =>
          onSave({
            ...draft,
            tags: tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          })
        }
        testID="mod-stream-info-save"
      >
        Review stream changes
      </MobileButton>
    </>
  );
}
function AutoModForm({
  value,
  pending,
  onSave,
}: {
  readonly value: AutoModPolicy;
  readonly pending: boolean;
  readonly onSave: (value: AutoModPolicy) => void;
}) {
  const [overall, setOverall] = useState(
    value.overall === null ? "" : String(value.overall),
  );
  const [categories, setCategories] = useState(value.categories);
  return (
    <>
      <MobileTextField
        label="Overall AutoMod level"
        hint="0 to 4. Leave blank to use individual levels."
        value={overall}
        onChange={setOverall}
        disabled={pending}
      />
      {automodCategories.map((category) => (
        <MobileTextField
          key={category}
          label={category.replaceAll("_", " ")}
          value={String(categories[category])}
          onChange={(text) =>
            setCategories({ ...categories, [category]: Number(text) })
          }
          disabled={pending || overall !== ""}
        />
      ))}
      <MobileButton
        accessibilityLabel="Review AutoMod policy changes"
        variant="primary"
        disabled={pending}
        onPress={() =>
          onSave({
            kind: "automod-policy",
            overall: overall === "" ? null : Number(overall),
            categories,
          })
        }
        testID="mod-automod-policy-save"
      >
        Review policy changes
      </MobileButton>
    </>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  card: {
    padding: mobileSpacing.small,
    gap: mobileSpacing.small,
    borderRadius: 12,
    backgroundColor: mobileColors.surface,
  },
  initial: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: mobileColors.surfaceRaised,
  },
});
