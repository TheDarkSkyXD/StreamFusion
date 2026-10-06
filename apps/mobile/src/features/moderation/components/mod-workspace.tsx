import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileSwitchRow } from "@mobile/design/list-row";
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
import { ModWorkspaceHome, type WorkspaceTool } from "./mod-workspace-home";
import {
  ProviderToolSheet,
  LocalModerationHistory,
  TimeoutDurationPicker,
  type ProviderWorkspaceTool,
} from "./provider-tool-sheet";

type Tool =
  | "actions"
  | "settings"
  | "banned"
  | "automod"
  | "unban-requests"
  | "moderators"
  | "vips";
export type ModerationScopeReturn = {
  readonly channel: ModerationChannel | null;
  readonly tool: WorkspaceTool | null;
  readonly userId?: string;
  readonly messageId?: string;
};
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
    returnTo?: ModerationScopeReturn,
  ) => void;
  readonly initialPlatform?: Platform;
  readonly initialChannel?: ModerationChannel;
  readonly initialUserId?: string;
  readonly initialMessageId?: string;
  readonly initialTool?: WorkspaceTool;
  readonly renderChat?: (channel: ModerationChannel) => ReactNode;
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
      controller.providerTools?.cancel();
      controller.providerTools?.stopFeed();
    };
  }, [controller, initialPlatform, initialChannel]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        controller.cancel();
        controller.providerTools?.cancel();
        controller.providerTools?.stopFeed();
      }
    });
    return () => listener.remove();
  }, [controller]);
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
  initialMessageId = "",
  initialTool,
  onOpenEngagement,
  renderChat,
}: ModWorkspaceProps & { readonly snapshot: ModerationSnapshot }) {
  const initialTarget =
    initialChannel?.login === snapshot.selection?.channel.login &&
    initialChannel?.platform === snapshot.platform
      ? initialUserId
      : "";
  const [tool, setTool] = useState<Tool | null>(
    initialTarget
      ? "actions"
      : initialTool === "actions" ||
          initialTool === "settings" ||
          initialTool === "banned" ||
          initialTool === "unban-requests" ||
          initialTool === "moderators" ||
          initialTool === "vips"
        ? initialTool
        : null,
  );
  const [confirm, setConfirm] = useState<{
    readonly title: string;
    readonly command: ModerationCommand;
  } | null>(null);
  const [userId, setUserId] = useState(initialTarget);
  const [messageId, setMessageId] = useState(
    initialTarget ? initialMessageId : "",
  );
  const [providerTool, setProviderTool] =
    useState<ProviderWorkspaceTool | null>(
      initialTool === "stream" ||
        initialTool === "logs" ||
        initialTool === "retention" ||
        initialTool === "activity" ||
        initialTool === "community" ||
        initialTool === "rewards" ||
        initialTool === "suspicious" ||
        initialTool === "whispers" ||
        initialTool === "provider" ||
        initialTool === "automod"
        ? initialTool
        : null,
    );
  const [chatOpen, setChatOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("600");
  const selection = snapshot.selection;
  const pending = snapshot.activity.kind === "pending";
  useEffect(() => {
    if (tool === "settings") void controller.readSettings();
    if (tool === "banned") void controller.readBanned();
    if (tool === "unban-requests" || tool === "moderators" || tool === "vips")
      void controller.readReview(tool);
    if (tool === "actions") void controller.providerTools?.readHistory();
  }, [controller, tool]);
  function open(next: Tool) {
    setTool(next);
  }
  function ask(title: string, command: ModerationCommand) {
    setConfirm({ title, command });
  }
  const feedback = (
    <WorkflowFeedback
      activity={snapshot.activity}
      onCancel={controller.cancel}
      onRequestScopes={(scopes) =>
        onRequestScopes(snapshot.platform, scopes, {
          channel: selection?.channel ?? null,
          tool: providerTool ?? tool,
          userId,
          messageId,
        })
      }
    />
  );
  return (
    <>
      <ModWorkspaceHome
        snapshot={snapshot}
        feedback={feedback}
        onLoadPlatform={(platform) => void controller.loadChannels(platform)}
        onSelectChannel={(channel) => void controller.selectChannel(channel)}
        onOpenTool={(next: WorkspaceTool) => {
          if (!selection) return;
          if (next === "chat") {
            if (renderChat) setChatOpen(true);
            else onOpenChannel(selection.channel);
            return;
          }
          if (next === "engagement") {
            if (onOpenEngagement) onOpenEngagement(selection.channel);
            else onOpenProvider(selection.channel, snapshot.platform);
            return;
          }
          if (
            next === "automod" &&
            controller.providerTools &&
            snapshot.platform === "twitch"
          ) {
            setProviderTool("automod");
            return;
          }
          if (
            next === "actions" ||
            next === "settings" ||
            next === "banned" ||
            next === "automod" ||
            next === "unban-requests" ||
            next === "moderators" ||
            next === "vips"
          ) {
            if (snapshot.platform === "kick" && next !== "actions") {
              setProviderTool(next);
              return;
            }
            open(next);
            return;
          }
          setProviderTool(next);
        }}
      />
      {chatOpen && selection && renderChat ? (
        <MobileBottomSheet
          visible
          title="Live chat"
          size="expanded"
          onDismiss={() => setChatOpen(false)}
        >
          <Text style={mobileType.label}>
            {selection.channel.name}, select a message to open its moderation
            actions.
          </Text>
          {renderChat(selection.channel)}
        </MobileBottomSheet>
      ) : null}
      {providerTool && selection && controller.providerTools ? (
        <ProviderToolSheet
          key={providerTool}
          controller={controller.providerTools}
          moderation={controller}
          channel={selection.channel}
          tool={providerTool}
          onDismiss={() => setProviderTool(null)}
          onOpenProvider={() =>
            onOpenProvider(selection.channel, snapshot.platform)
          }
          onRequestScopes={(scopes) =>
            onRequestScopes(snapshot.platform, scopes, {
              channel: selection.channel,
              tool: providerTool,
            })
          }
        />
      ) : null}
      {providerTool && selection && !controller.providerTools ? (
        <MobileBottomSheet
          visible
          title="Provider tools"
          size="expanded"
          onDismiss={() => setProviderTool(null)}
        >
          <Text style={mobileType.body}>
            This host does not provide the selected tool. Open the provider to
            use its available controls.
          </Text>
          <MobileButton
            accessibilityLabel="Open selected provider tools"
            variant="outline"
            onPress={() => onOpenProvider(selection.channel, snapshot.platform)}
            testID="mod-unavailable-provider"
          >
            Open provider tools
          </MobileButton>
        </MobileBottomSheet>
      ) : null}
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
            {controller.providerTools ? (
              <ActionHistory
                controller={controller.providerTools}
                userId={userId}
              />
            ) : null}
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
            <TimeoutDurationPicker
              value={duration}
              onChange={setDuration}
              pending={pending}
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
            <MobileTextField
              label="Search loaded banned users"
              value={search}
              onChange={setSearch}
            />
            {snapshot.banned.users.length === 0 ? (
              <Text style={mobileType.body}>No banned or timed-out users.</Text>
            ) : null}
            {snapshot.banned.users
              .filter((user) =>
                `${user.name} ${user.reason} ${user.id}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((user) => (
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
                <MobileTextField
                  label="Search loaded records"
                  value={search}
                  onChange={setSearch}
                />
                {snapshot.review.items
                  .filter((item) =>
                    `${item.name} ${item.userId}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((item) => (
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
    backgroundColor: mobileColors.moderationBackground,
    padding: mobileSpacing.medium,
    gap: mobileSpacing.medium,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  panel: {
    backgroundColor: mobileColors.moderationSurface,
    padding: mobileSpacing.medium,
    borderRadius: 12,
    gap: mobileSpacing.small,
  },
});

function ActionHistory({
  controller,
  userId,
}: {
  readonly controller: import("../domain/provider-tools-controller").ProviderToolsController;
  readonly userId: string;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return (
    <LocalModerationHistory
      state={snapshot.history}
      {...(userId ? { userId } : {})}
    />
  );
}
