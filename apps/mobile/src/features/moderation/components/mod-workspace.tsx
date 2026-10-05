import { useEffect, useState, useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileListRow, MobileSwitchRow } from "@mobile/design/list-row";
import { MobileTextField } from "@mobile/design/text-input";
import { mobileColors, mobileSpacing, mobileType } from "@mobile/design/tokens";
import type {
  ChatSettings,
  ModerationChannel,
  ModerationCommand,
} from "../capabilities/moderation";
import type {
  ModerationController,
  ModerationSnapshot,
} from "../domain/moderation-controller";
import { WorkflowFeedback } from "./workflow-feedback";

type Tool =
  | "actions"
  | "settings"
  | "banned"
  | "automod"
  | "unban-requests"
  | "moderators"
  | "vips";
type ModWorkspaceProps = {
  readonly controller: ModerationController;
  readonly onOpenChannel: (channel: ModerationChannel) => void;
  readonly onOpenProvider: (
    channel: ModerationChannel | null,
    platform: Platform,
  ) => void;
  readonly onRequestScopes: (
    platform: Platform,
    scopes: readonly string[],
  ) => void;
  readonly initialPlatform?: Platform;
  readonly initialChannel?: ModerationChannel;
  readonly initialUserId?: string;
  readonly onOpenEngagement?: (channel: ModerationChannel) => void;
};
export function ModWorkspace(props: ModWorkspaceProps) {
  const { controller, initialPlatform = "twitch", initialChannel } = props;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    let mounted = true;
    void controller
      .loadChannels(initialChannel?.platform ?? initialPlatform)
      .then(() => {
        if (!mounted || !initialChannel) return;
        const channel = controller
          .getSnapshot()
          .channels.find(
            (item) =>
              item.platform === initialChannel.platform &&
              item.login.toLowerCase() === initialChannel.login.toLowerCase(),
          );
        return controller.selectChannel(channel ?? initialChannel);
      });
    return () => {
      mounted = false;
      controller.cancel();
    };
  }, [controller, initialPlatform, initialChannel]);
  return (
    <ModWorkspaceBody
      key={`${snapshot.sessionRevision}:${snapshot.selection?.channel.id ?? "none"}`}
      {...props}
      snapshot={snapshot}
    />
  );
}
function ModWorkspaceBody({
  controller,
  onOpenChannel,
  onOpenProvider,
  onRequestScopes,
  snapshot,
  initialChannel,
  initialUserId = "",
  onOpenEngagement,
}: ModWorkspaceProps & { readonly snapshot: ModerationSnapshot }) {
  const initialTarget =
    initialChannel?.login === snapshot.selection?.channel.login &&
    initialChannel?.platform === snapshot.platform
      ? initialUserId
      : "";
  const [tool, setTool] = useState<Tool | null>(
    initialTarget ? "actions" : null,
  );
  const [confirm, setConfirm] = useState<{
    readonly title: string;
    readonly command: ModerationCommand;
  } | null>(null);
  const [userId, setUserId] = useState(initialTarget);
  const [messageId, setMessageId] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("600");
  const selection = snapshot.selection;
  const pending = snapshot.activity.kind === "pending";
  function open(next: Tool) {
    setTool(next);
    if (next === "settings") void controller.readSettings();
    if (next === "banned") void controller.readBanned();
    if (next === "unban-requests" || next === "moderators" || next === "vips")
      void controller.readReview(next);
  }
  function ask(title: string, command: ModerationCommand) {
    setConfirm({ title, command });
  }
  const feedback = (
    <WorkflowFeedback
      activity={snapshot.activity}
      onCancel={controller.cancel}
      onRequestScopes={(scopes) => onRequestScopes(snapshot.platform, scopes)}
    />
  );
  return (
    <>
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={mobileType.display}>
          Moderation
        </Text>
        <Text style={mobileType.body}>
          Choose a channel. Your provider role is checked before each action.
        </Text>
        <View style={styles.row}>
          {(["twitch", "kick"] satisfies readonly Platform[]).map(
            (platform) => (
              <MobileButton
                key={platform}
                accessibilityLabel={`Load ${platform} moderated channels`}
                busy={pending && snapshot.platform === platform}
                onPress={() => void controller.loadChannels(platform)}
                testID={`mod-${platform}`}
                variant={
                  snapshot.platform === platform ? platform : "secondary"
                }
              >
                {platform === "twitch" ? "Twitch" : "Kick"}
              </MobileButton>
            ),
          )}
        </View>
        {feedback}
        {snapshot.channels.length === 0 && !pending ? (
          <Text style={mobileType.body}>
            No channels loaded. Connect an account or grant the requested
            permissions, then refresh.
          </Text>
        ) : null}
        {snapshot.channels.map((channel) => (
          <MobileListRow
            key={`${channel.platform}:${channel.id}`}
            title={channel.name}
            description={
              selection?.channel.id === channel.id
                ? `Verified ${selection.role}`
                : `@${channel.login}`
            }
            onPress={() => void controller.selectChannel(channel)}
          />
        ))}
        <MobileButton
          accessibilityLabel="Refresh moderated channels"
          disabled={pending}
          onPress={() => void controller.loadChannels(snapshot.platform)}
          testID="mod-refresh"
          variant="outline"
        >
          Refresh channels
        </MobileButton>
        {selection ? (
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={mobileType.title}>
              {selection.channel.name}
            </Text>
            <Text style={mobileType.label}>
              {selection.role === "broadcaster"
                ? "Verified broadcaster"
                : "Verified moderator"}
            </Text>
            <MobileButton
              accessibilityLabel={`Watch ${selection.channel.name}`}
              onPress={() => onOpenChannel(selection.channel)}
              testID="mod-watch"
              variant="secondary"
            >
              Watch channel
            </MobileButton>
            <MobileListRow
              title="User and message actions"
              description="Timeout, ban, unban, or delete a message"
              onPress={() => open("actions")}
            />
            {snapshot.platform === "twitch" ? (
              <>
                <MobileListRow
                  title="Chat settings"
                  description="Slow, followers, subscribers, emotes, and unique chat"
                  onPress={() => open("settings")}
                />
                <MobileListRow
                  title="AutoMod review"
                  description="Allow or deny a held message by its provider ID"
                  onPress={() => open("automod")}
                />
                <MobileListRow
                  title="Unban requests"
                  description="Review pending appeals and approve or deny them"
                  onPress={() => open("unban-requests")}
                />
                {selection.role === "broadcaster" ? (
                  <MobileListRow
                    title="Banned users"
                    description="Read the provider list and remove bans"
                    onPress={() => open("banned")}
                  />
                ) : null}
                {selection.role === "broadcaster" ? (
                  <>
                    <MobileListRow
                      title="Moderators"
                      description="Review, add, and remove channel moderators"
                      onPress={() => open("moderators")}
                    />
                    <MobileListRow
                      title="VIPs"
                      description="Review, add, and remove VIP status"
                      onPress={() => open("vips")}
                    />
                    {onOpenEngagement ? (
                      <MobileListRow
                        title="Polls and predictions"
                        description="Create and manage broadcaster engagement"
                        onPress={() => onOpenEngagement(selection.channel)}
                      />
                    ) : null}
                  </>
                ) : null}
              </>
            ) : (
              <Text style={mobileType.body}>
                Kick&apos;s official API supports bans and message deletion for
                your broadcaster channel. Open Kick for role management, chat
                settings, retention, and banned-user lists.
              </Text>
            )}
          </View>
        ) : null}
        {snapshot.platform === "kick" ? (
          <Text style={mobileType.body}>
            Kick does not expose a moderated-channel or moderator-role lookup.
            Only your verified broadcaster channel appears here.
          </Text>
        ) : null}
        <Text style={mobileType.body}>
          Open provider tools for moderation logs, active moderators, channel
          activity, and retention history. These records are not exposed by the
          official APIs.
        </Text>
        <MobileButton
          accessibilityLabel={`Open ${snapshot.platform} moderation tools`}
          onPress={() =>
            onOpenProvider(selection?.channel ?? null, snapshot.platform)
          }
          testID="mod-provider"
          variant="outline"
        >
          Open provider tools
        </MobileButton>
      </ScrollView>
      <MobileBottomSheet
        visible={tool !== null && selection !== null}
        title={
          tool === "settings"
            ? "Chat settings"
            : tool === "banned"
              ? "Banned users"
              : tool === "automod"
                ? "AutoMod review"
                : tool === "unban-requests"
                  ? "Unban requests"
                  : tool === "moderators"
                    ? "Moderators"
                    : tool === "vips"
                      ? "VIPs"
                      : "User and message actions"
        }
        size="expanded"
        onDismiss={() => {
          setTool(null);
          setConfirm(null);
          controller.cancel();
        }}
      >
        {selection ? (
          <Text style={mobileType.label}>
            {selection.channel.name} · Verified {selection.role}
          </Text>
        ) : null}
        {feedback}
        {tool === "actions" ? (
          <>
            <MobileTextField
              label="Provider user ID"
              hint="Use the numeric Twitch or Kick user ID from chat."
              value={userId}
              onChange={setUserId}
              disabled={pending}
            />
            <MobileTextField
              label="Reason"
              value={reason}
              onChange={setReason}
              disabled={pending}
            />
            <MobileTextField
              label="Timeout duration in seconds"
              hint={
                snapshot.platform === "kick"
                  ? "Whole minutes only. 600 seconds is 10 minutes."
                  : "From 1 second to 14 days."
              }
              value={duration}
              onChange={setDuration}
              disabled={pending}
            />
            <View style={styles.row}>
              <MobileButton
                accessibilityLabel="Review timeout"
                disabled={pending || !userId}
                onPress={() =>
                  ask("Timeout user", {
                    kind: "timeout",
                    userId,
                    reason,
                    durationSeconds: Number(duration),
                  })
                }
                testID="mod-timeout"
                variant="secondary"
              >
                Timeout
              </MobileButton>
              <MobileButton
                accessibilityLabel="Review ban"
                disabled={pending || !userId}
                onPress={() => ask("Ban user", { kind: "ban", userId, reason })}
                testID="mod-ban"
                variant="destructive"
              >
                Ban
              </MobileButton>
              <MobileButton
                accessibilityLabel="Review unban"
                disabled={pending || !userId}
                onPress={() =>
                  ask("Remove ban or timeout", { kind: "unban", userId })
                }
                testID="mod-unban"
                variant="outline"
              >
                Unban
              </MobileButton>
            </View>
            <MobileTextField
              label="Chat message ID"
              value={messageId}
              onChange={setMessageId}
              disabled={pending}
            />
            <MobileButton
              accessibilityLabel="Review message deletion"
              disabled={pending || !messageId}
              onPress={() =>
                ask("Delete chat message", {
                  kind: "delete-message",
                  messageId,
                })
              }
              testID="mod-delete"
              variant="destructive"
            >
              Delete message
            </MobileButton>
          </>
        ) : null}
        {tool === "automod" ? (
          <>
            <Text style={mobileType.body}>
              Twitch does not provide a REST queue of held messages. Open Twitch
              to view the live AutoMod queue. You can act here on a known
              held-message ID.
            </Text>
            <MobileTextField
              label="Held AutoMod message ID"
              value={messageId}
              onChange={setMessageId}
              disabled={pending}
            />
            <View style={styles.row}>
              {(["ALLOW", "DENY"] satisfies readonly ("ALLOW" | "DENY")[]).map(
                (action) => (
                  <MobileButton
                    key={action}
                    accessibilityLabel={`${action === "ALLOW" ? "Allow" : "Deny"} held message`}
                    disabled={pending || !messageId}
                    onPress={() =>
                      ask(
                        action === "ALLOW"
                          ? "Allow held message"
                          : "Deny held message",
                        { kind: "automod", messageId, action },
                      )
                    }
                    testID={`automod-${action.toLowerCase()}`}
                    variant={action === "ALLOW" ? "secondary" : "destructive"}
                  >
                    {action === "ALLOW" ? "Allow" : "Deny"}
                  </MobileButton>
                ),
              )}
            </View>
            <MobileButton
              accessibilityLabel="Open Twitch AutoMod queue"
              onPress={() =>
                onOpenProvider(selection?.channel ?? null, snapshot.platform)
              }
              testID="automod-provider"
              variant="outline"
            >
              Open Twitch queue
            </MobileButton>
          </>
        ) : null}
        {tool === "settings" && snapshot.settings ? (
          <ChatSettingsForm
            key={snapshot.sessionRevision}
            value={snapshot.settings}
            pending={pending}
            onSave={(settings) =>
              ask("Update chat settings", { kind: "chat-settings", settings })
            }
          />
        ) : null}
        {tool === "banned" && snapshot.banned ? (
          <>
            {snapshot.banned.users.length === 0 ? (
              <Text style={mobileType.body}>No banned or timed-out users.</Text>
            ) : null}
            {snapshot.banned.users.map((user) => (
              <View key={user.id} style={styles.panel}>
                <Text style={mobileType.title}>{user.name}</Text>
                <Text style={mobileType.body}>
                  {user.reason || "No reason provided"}
                </Text>
                <Text style={mobileType.label}>
                  {user.expiresAt
                    ? `Timeout ends ${user.expiresAt}`
                    : "Permanent ban"}
                </Text>
                <MobileButton
                  accessibilityLabel={`Review unban for ${user.name}`}
                  disabled={pending}
                  onPress={() =>
                    ask(`Unban ${user.name}`, {
                      kind: "unban",
                      userId: user.id,
                    })
                  }
                  testID={`unban-${user.id}`}
                  variant="outline"
                >
                  Unban
                </MobileButton>
              </View>
            ))}
            {snapshot.banned.cursor ? (
              <MobileButton
                accessibilityLabel="Load more banned users"
                disabled={pending}
                onPress={() => void controller.readBanned(true)}
                testID="banned-more"
                variant="secondary"
              >
                Load more
              </MobileButton>
            ) : null}
          </>
        ) : null}
        {tool === "unban-requests" ||
        tool === "moderators" ||
        tool === "vips" ? (
          <>
            {tool !== "unban-requests" ? (
              <>
                <MobileTextField
                  label="Provider user ID to add"
                  value={userId}
                  onChange={setUserId}
                  disabled={pending}
                />
                <MobileButton
                  accessibilityLabel={`Review adding ${tool === "moderators" ? "moderator" : "VIP"}`}
                  disabled={pending || !userId}
                  onPress={() =>
                    ask(tool === "moderators" ? "Add moderator" : "Add VIP", {
                      kind: "membership",
                      group: tool,
                      operation: "add",
                      userId,
                    })
                  }
                  testID={`member-add-${tool}`}
                  variant="primary"
                >
                  Add user
                </MobileButton>
              </>
            ) : (
              <MobileTextField
                label="Appeal response"
                hint="Optional. Up to 500 characters."
                value={reason}
                onChange={setReason}
                disabled={pending}
              />
            )}
            <MobileButton
              accessibilityLabel={`Refresh ${tool}`}
              disabled={pending}
              onPress={() => void controller.readReview(tool)}
              testID="review-refresh"
              variant="outline"
            >
              Refresh list
            </MobileButton>
            {snapshot.review?.tool === tool ? (
              <>
                {snapshot.review.items.length === 0 ? (
                  <Text style={mobileType.body}>
                    No {tool === "unban-requests" ? "pending requests" : tool}.
                  </Text>
                ) : null}
                {snapshot.review.items.map((item) => (
                  <View
                    key={item.kind === "unban" ? item.id : item.userId}
                    style={styles.panel}
                  >
                    <Text style={mobileType.title}>{item.name}</Text>
                    {item.kind === "unban" ? (
                      <>
                        <Text style={mobileType.body}>{item.text}</Text>
                        <View style={styles.row}>
                          {(
                            ["approved", "denied"] satisfies readonly (
                              "approved" | "denied"
                            )[]
                          ).map((status) => (
                            <MobileButton
                              key={status}
                              accessibilityLabel={`${status === "approved" ? "Approve" : "Deny"} appeal from ${item.name}`}
                              disabled={pending}
                              onPress={() =>
                                ask(
                                  `${status === "approved" ? "Approve" : "Deny"} appeal from ${item.name}`,
                                  {
                                    kind: "resolve-unban",
                                    requestId: item.id,
                                    status,
                                    resolutionText: reason,
                                  },
                                )
                              }
                              testID={`appeal-${status}-${item.id}`}
                              variant={
                                status === "approved"
                                  ? "secondary"
                                  : "destructive"
                              }
                            >
                              {status === "approved" ? "Approve" : "Deny"}
                            </MobileButton>
                          ))}
                        </View>
                      </>
                    ) : tool === "moderators" || tool === "vips" ? (
                      <MobileButton
                        accessibilityLabel={`Review removing ${item.name} from ${tool}`}
                        disabled={pending}
                        onPress={() =>
                          ask(`Remove ${item.name}`, {
                            kind: "membership",
                            group: tool,
                            operation: "remove",
                            userId: item.userId,
                          })
                        }
                        testID={`member-remove-${item.userId}`}
                        variant="destructive"
                      >
                        Remove
                      </MobileButton>
                    ) : null}
                  </View>
                ))}
                {snapshot.review.cursor ? (
                  <MobileButton
                    accessibilityLabel="Load more records"
                    disabled={pending}
                    onPress={() => void controller.readReview(tool, true)}
                    testID="review-more"
                    variant="secondary"
                  >
                    Load more
                  </MobileButton>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </MobileBottomSheet>
      <MobileDialog
        visible={confirm !== null && selection !== null}
        title={confirm?.title ?? "Confirm action"}
        message={
          confirm && selection
            ? confirmationDetail(confirm.command, selection.channel)
            : ""
        }
        confirmLabel="Confirm action"
        destructive={confirm?.command.kind !== "chat-settings"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const command = confirm?.command;
          setConfirm(null);
          if (command) void controller.execute(command);
        }}
      />
    </>
  );
}
function confirmationDetail(
  command: ModerationCommand,
  channel: ModerationChannel,
): string {
  if (command.kind === "resolve-unban")
    return `${command.status === "approved" ? "Approve" : "Deny"} appeal ${command.requestId} in ${channel.name}?${command.status === "approved" ? " Approving removes the ban." : " The ban remains in place."}`;
  if (command.kind === "membership")
    return `${command.operation === "add" ? "Add" : "Remove"} user ${command.userId} ${command.operation === "add" ? "to" : "from"} ${channel.name}'s ${command.group}?${command.group === "moderators" && command.operation === "add" ? " This grants moderation authority." : ""}`;
  const target =
    command.kind === "chat-settings"
      ? "the channel's chat modes"
      : command.kind === "automod" || command.kind === "delete-message"
        ? `message ${command.messageId}`
        : `user ${command.userId}`;
  return `Apply ${command.kind.replaceAll("-", " ")} to ${target} in ${channel.name}?${command.kind === "timeout" ? ` Duration: ${command.durationSeconds} seconds.` : ""}${command.kind === "ban" ? " This is a permanent ban." : ""}`;
}
function ChatSettingsForm({
  value,
  pending,
  onSave,
}: {
  readonly value: ChatSettings;
  readonly pending: boolean;
  readonly onSave: (settings: ChatSettings) => void;
}) {
  const [settings, setSettings] = useState(value);
  const [seconds, setSeconds] = useState(String(value.slowSeconds));
  const [minutes, setMinutes] = useState(String(value.followerMinutes));
  return (
    <>
      <MobileSwitchRow
        title="Slow mode"
        value={settings.slowMode}
        disabled={pending}
        onChange={(slowMode) => setSettings({ ...settings, slowMode })}
      />
      <MobileTextField
        label="Slow-mode wait in seconds"
        value={seconds}
        onChange={setSeconds}
        disabled={pending}
      />
      <MobileSwitchRow
        title="Followers only"
        value={settings.followersOnly}
        disabled={pending}
        onChange={(followersOnly) =>
          setSettings({ ...settings, followersOnly })
        }
      />
      <MobileTextField
        label="Required follow duration in minutes"
        value={minutes}
        onChange={setMinutes}
        disabled={pending}
      />
      <MobileSwitchRow
        title="Subscribers only"
        value={settings.subscribersOnly}
        disabled={pending}
        onChange={(subscribersOnly) =>
          setSettings({ ...settings, subscribersOnly })
        }
      />
      <MobileSwitchRow
        title="Emotes only"
        value={settings.emoteOnly}
        disabled={pending}
        onChange={(emoteOnly) => setSettings({ ...settings, emoteOnly })}
      />
      <MobileSwitchRow
        title="Unique chat"
        value={settings.uniqueChat}
        disabled={pending}
        onChange={(uniqueChat) => setSettings({ ...settings, uniqueChat })}
      />
      <MobileButton
        accessibilityLabel="Review chat settings update"
        disabled={pending}
        onPress={() =>
          onSave({
            ...settings,
            slowSeconds: Number(seconds),
            followerMinutes: Number(minutes),
          })
        }
        testID="settings-save"
        variant="primary"
      >
        Review changes
      </MobileButton>
    </>
  );
}
const styles = StyleSheet.create({
  page: {
    backgroundColor: mobileColors.background,
    padding: mobileSpacing.medium,
    gap: mobileSpacing.medium,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  panel: {
    backgroundColor: mobileColors.surface,
    padding: mobileSpacing.medium,
    borderRadius: 12,
    gap: mobileSpacing.small,
  },
});
