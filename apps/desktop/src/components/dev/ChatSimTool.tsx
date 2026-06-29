/**
 * Chat event simulator. Injects synthetic chat events so devs can verify the
 * UI for ban markers, first-time chatter highlights, sub notices, raids, etc.
 *
 * Most events push directly into the chat-store via addMessage — same path
 * the real handlers use, so the rendered DOM is identical to production.
 * Kick-only pinned messages and polls live in component-local state, so
 * those go via kickChatService.emit() (works once a Kick chat is mounted).
 */

import { useState } from "react";

import { kickChatService, kickPinToNormalized } from "../../backend/services/chat/kick-chat";
import { twitchChatService } from "../../backend/services/chat/twitch-chat";
import type { ModerationHighlightStyle, UserPreferences } from "../../shared/auth-types";
import {
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
} from "../../shared/auth-types";
import type {
  ChatHighlightKind,
  ChatMessage,
  ChatPlatform,
  KickPinnedMessage,
  KickPoll,
  NormalizedPinnedMessage,
  UnifiedPrediction,
} from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { buildChannelKey, useChatStore } from "../../store/chat-store";
import { useDevModOverrideStore } from "../../store/dev-mod-override-store";
import { useReconnectDialogStore } from "../../store/reconnect-dialog-store";

import { DEBUG_TOKENS } from "./tokens";

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

function getInitialPlatform(): ChatPlatform {
  const { connectionStatus } = useChatStore.getState();
  if (connectionStatus.twitch.channels.length > 0) return "twitch";
  if (connectionStatus.kick.channels.length > 0) return "kick";
  return "twitch";
}

interface FakeUser {
  username: string;
  displayName: string;
  color: string;
}

const POOL: FakeUser[] = [
  { username: "alice", displayName: "Alice", color: "#FF7F50" },
  { username: "bob", displayName: "Bob", color: "#5B9BD5" },
  { username: "eve", displayName: "Eve", color: "#70AD47" },
  { username: "mallory", displayName: "Mallory", color: "#9B5BD5" },
  { username: "trent", displayName: "Trent", color: "#FFC000" },
];

function pickUser(): FakeUser {
  return POOL[Math.floor(Math.random() * POOL.length)];
}

const DEBUG_BADGE_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Crect width='18' height='18' rx='4' fill='%23dc143c'/%3E%3Cpath d='M9 3.5l1.6 3.2 3.5.5-2.5 2.4.6 3.5L9 11.5 5.8 13.1l.6-3.5-2.5-2.4 3.5-.5L9 3.5z' fill='white'/%3E%3C/svg%3E";

function debugBadge(platform: ChatPlatform): ChatMessage["badges"][number] {
  return {
    setId: platform === "kick" ? "subscriber" : "vip",
    version: "1",
    imageUrl: DEBUG_BADGE_IMAGE,
    title: platform === "kick" ? "Subscriber" : "VIP",
  };
}

function moderatorPresentation(platform: ChatPlatform): NonNullable<ChatMessage["deletedByUser"]> {
  return {
    userId: "moderatorbot",
    username: "ModeratorBot",
    displayName: "ModeratorBot",
    color: "#f87171",
    badges: [
      {
        setId: "moderator",
        version: "1",
        imageUrl: DEBUG_BADGE_IMAGE,
        title: "Moderator",
      },
    ],
  };
}

function styleLabel(style: ModerationHighlightStyle): "Compact" | "Framed" {
  return style === "compact" ? "Compact" : "Framed";
}

const GIFT_RECIPIENT_DISPLAY_NAMES = [
  "ecchatan21",
  "TorchOsrs",
  "5maestr0",
  "Cursedsnek",
  "SVIIIXD",
  "PixelMint",
  "NovaWarden",
  "lunarbyte",
  "StaticMango",
  "VelvetRush",
];

function buildGiftRecipient(index: number): FakeUser {
  const displayName =
    GIFT_RECIPIENT_DISPLAY_NAMES[index] ?? `GiftedViewer${String(index + 1).padStart(2, "0")}`;

  return {
    username: displayName.toLowerCase(),
    displayName,
    color: "#f472b6",
  };
}

const sectionStyle: React.CSSProperties = { marginBottom: 14 };

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: DEBUG_TOKENS.textSecondary,
  margin: "0 0 8px 0",
};

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const baseButtonStyle: React.CSSProperties = {
  background: DEBUG_TOKENS.surfaceRaised,
  color: DEBUG_TOKENS.textPrimary,
  border: `1px solid ${DEBUG_TOKENS.border}`,
  padding: "6px 12px",
  cursor: "pointer",
  font: `12.5px/1.2 ${DEBUG_TOKENS.fontUi}`,
  fontWeight: 500,
  borderRadius: 6,
  transition: "all 0.12s",
};

function PillButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...baseButtonStyle,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = DEBUG_TOKENS.surfaceSubtle;
        e.currentTarget.style.borderColor = DEBUG_TOKENS.borderStrong;
        e.currentTarget.style.color = DEBUG_TOKENS.textPrimary;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = DEBUG_TOKENS.surfaceRaised;
        e.currentTarget.style.borderColor = DEBUG_TOKENS.border;
        e.currentTarget.style.color = DEBUG_TOKENS.textPrimary;
      }}
    >
      {children}
    </button>
  );
}

export function ChatSimTool() {
  const [platform, setPlatform] = useState<ChatPlatform>(getInitialPlatform);
  const connectedChannels = useChatStore(
    (state) => state.connectionStatus[platform]?.channels ?? []
  );
  const targetChannel = connectedChannels[0] ?? "debug-channel";
  const debugChannelKey = buildChannelKey(platform, targetChannel);

  const inject = (overrides: Partial<ChatMessage>) => {
    const u = pickUser();
    const msg: ChatMessage = {
      id: uid("debug"),
      platform,
      type: "message",
      channel: targetChannel,
      userId: u.username,
      username: u.username,
      displayName: u.displayName,
      color: u.color,
      badges: [],
      content: [{ type: "text", content: "Test message" }],
      rawContent: "Test message",
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
      ...overrides,
    };
    useChatStore.getState().addMessage(msg);
  };

  const setModerationHighlightPreviewStyle = (style: ModerationHighlightStyle) => {
    const preferences = useAuthStore.getState().preferences ?? DEFAULT_USER_PREFERENCES;
    useAuthStore.setState({
      preferences: {
        ...preferences,
        chatDisplay: {
          ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
          ...(preferences.chatDisplay ?? {}),
          deletedMessageDisplay: "compact",
          moderationHighlightStyle: style,
          showClearChat: true,
          showClearMsg: true,
        },
      } as UserPreferences,
    });
  };

  const injectRandom = () => {
    const variants = [
      "GG!",
      "let's go",
      "what's the move chat",
      "POG",
      "incredible play",
      "no way that just happened",
      "first",
      "sub hype",
    ];
    const text = variants[Math.floor(Math.random() * variants.length)];
    inject({ content: [{ type: "text", content: text }], rawContent: text });
  };

  const injectFirstTime = () => {
    inject({
      content: [{ type: "text", content: "first time here, hi chat!" }],
      rawContent: "first time here, hi chat!",
      isHighlighted: true,
    });
  };

  const injectAction = () => {
    inject({
      isAction: true,
      content: [{ type: "text", content: "waves at chat" }],
      rawContent: "waves at chat",
    });
  };

  const injectMention = () => {
    inject({
      content: [
        { type: "mention", username: "sodapoppin" },
        { type: "text", content: " nice play!" },
      ],
      rawContent: "@sodapoppin nice play!",
    });
  };

  const injectLong = () => {
    const text =
      "This is an intentionally long message that should test wrapping behavior across multiple lines. ".repeat(
        4
      );
    inject({ content: [{ type: "text", content: text }], rawContent: text });
  };

  const injectLongUsername = () => {
    inject({
      username: "extremely_long_username_for_testing",
      displayName: "ExtremelyLongUsernameForTesting",
      content: [{ type: "text", content: "long-username probe" }],
      rawContent: "long-username probe",
    });
  };

  const injectClearAll = () => {
    useChatStore.getState().clearMessages(debugChannelKey);
    inject({
      type: "system",
      userId: "system",
      username: "System",
      displayName: "System",
      color: "#808080",
      content: [{ type: "text", content: "Chat was cleared" }],
      rawContent: "Chat was cleared",
      isHighlighted: true,
    });
  };

  const injectSystemNotice = (text: string) => {
    inject({
      type: "system",
      userId: "system",
      username: "System",
      displayName: "System",
      color: "#808080",
      content: [{ type: "text", content: text }],
      rawContent: text,
      isHighlighted: true,
    });
  };

  const injectEventNotice = (user: FakeUser, text: string, highlightKind: ChatHighlightKind) => {
    inject({
      type: "system",
      userId: user.username,
      username: user.username,
      displayName: user.displayName,
      color: user.color,
      content: [{ type: "text", content: text }],
      rawContent: text,
      isHighlighted: true,
      highlightKind,
    });
  };

  const injectSub = () => {
    const u = pickUser();
    injectEventNotice(u, `${u.displayName} subscribed with Prime.`, "subscription");
  };

  const injectResub = (months: number) => {
    const u = pickUser();
    injectEventNotice(
      u,
      `${u.displayName} subscribed with Prime. They've subscribed for ${months} months!`,
      "resub"
    );
  };

  const injectGiftSub = () => {
    const u = pickUser();
    const r = pickUser();
    injectEventNotice(u, `${u.displayName} gifted a Tier 1 Sub to ${r.displayName}!`, "gifted-sub");
  };

  const injectMysteryGift = (count: number) => {
    const u = POOL[0];
    injectEventNotice(
      u,
      `${u.displayName} gifted ${count} Tier 1 Subs to the channel!`,
      "gifted-sub"
    );

    for (let index = 0; index < count; index++) {
      const recipient = buildGiftRecipient(index);
      injectEventNotice(
        u,
        `${u.displayName} gifted a Tier 1 Sub to ${recipient.displayName}!`,
        "gifted-sub"
      );
    }
  };

  const injectRaid = (count: number) => {
    const u = pickUser();
    injectEventNotice(u, `${count} raiders from ${u.displayName} have joined!`, "raid");
  };

  const injectDeletedMessagePreview = (style: ModerationHighlightStyle) => {
    setModerationHighlightPreviewStyle(style);
    const u = pickUser();
    const deletedAt = new Date();
    const msg: ChatMessage = {
      id: uid("deleted-debug"),
      platform,
      type: "message",
      channel: targetChannel,
      userId: u.username,
      username: u.username,
      displayName: u.displayName,
      color: u.color,
      badges: [debugBadge(platform)],
      content: [
        { type: "text", content: "debug deleted message " },
        {
          type: "emote",
          id: "25",
          name: "Kappa",
          url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0",
          isAnimated: false,
        },
        { type: "text", content: " :)" },
      ],
      rawContent: "debug deleted message Kappa :)",
      timestamp: deletedAt,
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    const store = useChatStore.getState();
    store.addMessage(msg);
    store.deleteMessage(debugChannelKey, msg.id, {
      deletedAt,
      deletedByUser: moderatorPresentation(platform),
      deletedByUsername: "ModeratorBot",
    });
  };

  const injectModerationActionPreview = (style: ModerationHighlightStyle, duration?: number) => {
    setModerationHighlightPreviewStyle(style);
    const u = pickUser();
    const deletedAt = new Date();
    const store = useChatStore.getState();
    const actionPrefix = duration ? "timeout" : "ban";
    const removedMessages: ChatMessage[] = [1, 2, 3].map((index) => ({
      id: uid(`${actionPrefix}-debug-${index}`),
      platform,
      type: "message",
      channel: targetChannel,
      userId: u.username,
      username: u.username,
      displayName: u.displayName,
      color: u.color,
      badges: [debugBadge(platform)],
      content:
        index === 1
          ? [
              { type: "text", content: `${actionPrefix} preview message 1 ` },
              {
                type: "emote",
                id: "25",
                name: "Kappa",
                url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0",
                isAnimated: false,
              },
            ]
          : [{ type: "text", content: `${actionPrefix} preview message ${index}` }],
      rawContent:
        index === 1
          ? `${actionPrefix} preview message 1 Kappa`
          : `${actionPrefix} preview message ${index}`,
      timestamp: deletedAt,
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    }));

    for (const msg of removedMessages) {
      store.addMessage(msg);
    }

    store.deleteMessagesByUser(debugChannelKey, u.username, {
      deletedAt,
      deletedByUser: moderatorPresentation(platform),
      deletedByUsername: "ModeratorBot",
    });
    store.addMessage({
      id: uid(`${actionPrefix}-debug-ban`),
      platform,
      type: "ban",
      channel: targetChannel,
      userId: "system",
      username: "System",
      displayName: "System",
      color: "#808080",
      badges: [],
      content: [],
      rawContent: "",
      timestamp: deletedAt,
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
      banInfo: {
        bannedUsername: u.displayName,
        bannedByUsername: "ModeratorBot",
        bannedByUser: moderatorPresentation(platform),
        bannedUser: {
          userId: u.username,
          username: u.username,
          displayName: u.displayName,
          color: u.color,
          badges: [debugBadge(platform)],
        },
        lastMessage: removedMessages[1].rawContent,
        deletedMessages: removedMessages.map((message) => message.rawContent),
        deletedMessageDetails: removedMessages.map((message) => ({
          id: message.id,
          author: {
            userId: message.userId,
            username: message.username,
            displayName: message.displayName,
            color: message.color,
            badges: message.badges,
          },
          content: message.content,
          rawContent: message.rawContent,
          deletedAt,
        })),
        duration,
      },
    });
  };

  const injectPinnedKick = () => {
    if (platform !== "kick") return;
    const u = pickUser();
    const pin: KickPinnedMessage = {
      message: {
        id: uid("pin-msg"),
        content: "Check the !discord for tonight's bracket. Drops are on.",
        created_at: new Date().toISOString(),
        sender: { username: u.username, identity: { color: u.color } },
      },
      pinned_by: { username: "ModeratorBot", identity: { color: "#FF6F61" } },
    };
    kickChatService.emit("pinnedMessage", kickPinToNormalized(pin));
  };

  const injectPinnedClearKick = () => {
    if (platform !== "kick") return;
    kickChatService.emit("pinnedMessageCleared");
  };

  const injectPinnedTwitch = () => {
    if (platform !== "twitch") return;
    const u = pickUser();
    // Synthetic NormalizedPinnedMessage emitted via the same event the
    // GraphQL poller uses, so the banner renders through the production path.
    const pinnedAtMs = Date.now();
    const now = new Date(pinnedAtMs).toISOString();
    const expiresAt = new Date(pinnedAtMs + 10 * 60 * 1_000).toISOString();
    const pinId = uid("twitch-pin");
    const pin: NormalizedPinnedMessage = {
      platform: "twitch",
      messageId: pinId,
      pinRecordId: pinId,
      author: {
        username: u.username,
        displayName: u.displayName,
        color: u.color,
        badges: [],
      },
      content: [
        { type: "text", content: "Check the !discord for tonight's bracket. Drops are on." },
      ],
      pinnedBy: { username: "ModeratorBot", color: "#FF6F61", badges: [] },
      pinnedAt: now,
      sentAt: now,
      expiresAt,
    };
    twitchChatService.emit("pinnedMessage", pin);
  };

  const injectPinnedClearTwitch = () => {
    if (platform !== "twitch") return;
    twitchChatService.emit("pinnedMessageCleared");
  };

  const injectPollKick = () => {
    if (platform !== "kick") return;
    const poll: KickPoll = {
      title: "Which game next?",
      options: [
        { id: 1, label: "Marbles", votes: 18 },
        { id: 2, label: "Just Chatting", votes: 41 },
        { id: 3, label: "Slots", votes: 9 },
      ],
      remaining: 30,
      duration: 60,
    };
    kickChatService.emit("pollUpdate", poll);
  };

  const injectPollEndedKick = () => {
    if (platform !== "kick") return;
    const poll: KickPoll = {
      title: "Which game next?",
      options: [
        { id: 1, label: "Marbles", votes: 22 },
        { id: 2, label: "Just Chatting", votes: 67 },
        { id: 3, label: "Slots", votes: 11 },
      ],
      remaining: 0,
      duration: 60,
    };
    kickChatService.emit("pollUpdate", poll);
  };

  // Twitch poll injection (closes the Kick-only asymmetry, R29). The
  // existing `pollUpdate` event type carries `KickPoll`-shaped data —
  // generic enough for Twitch's title+options+remaining+duration shape —
  // and `twitchChatService` extends the same `ChatServiceEvents` interface.
  // Production rendering for Twitch polls is not in this plan's scope (the
  // viewer-side Twitch poll widget doesn't exist yet); the buttons emit
  // through the same seam a future widget would consume.
  const injectPollTwitch = () => {
    if (platform !== "twitch") return;
    const poll: KickPoll = {
      title: "Which game next?",
      options: [
        { id: 1, label: "Marbles", votes: 18 },
        { id: 2, label: "Just Chatting", votes: 41 },
        { id: 3, label: "Slots", votes: 9 },
      ],
      // Fresh poll — full window remaining so the widget's bar starts at
      // 100% and visibly drains over `duration` seconds.
      remaining: 60,
      duration: 60,
    };
    twitchChatService.emit("pollUpdate", poll);
  };

  const injectPollEndedTwitch = () => {
    if (platform !== "twitch") return;
    const poll: KickPoll = {
      title: "Which game next?",
      options: [
        { id: 1, label: "Marbles", votes: 22 },
        { id: 2, label: "Just Chatting", votes: 67 },
        { id: 3, label: "Slots", votes: 11 },
      ],
      remaining: 0,
      duration: 60,
    };
    twitchChatService.emit("pollUpdate", poll);
  };

  // Prediction injection (R28). Synthetic `UnifiedPrediction` emitted via the
  // same `predictionUpdate` event a real PubSub / Pusher subscription would
  // fire. Production rendering pending U6 (viewer prediction widget).
  const buildSyntheticPrediction = (
    p: "twitch" | "kick",
    status: "ACTIVE" | "RESOLVED"
  ): UnifiedPrediction => {
    const id = uid("pred");
    const outcomeA = uid("outcome-a");
    const outcomeB = uid("outcome-b");
    return {
      id,
      platform: p,
      // Dev sentinel — empty channelId tells the chat handlers to accept the
      // event into whichever channel is currently rendered, since the sim
      // tool has no view of the active channel id.
      channelId: "",
      // Same sentinel for the slug fallback — empty matches no real slug, so
      // the multiview filter falls through to the channelId-empty escape hatch.
      channelSlug: "",
      title: p === "twitch" ? "Who wins next game?" : "BroVBro - Golf it Overall",
      status,
      outcomes: [
        {
          id: outcomeA,
          title: p === "twitch" ? "Sodapoppin" : "BroVBro",
          color: p === "twitch" ? "blue" : null,
          totalAmount: status === "RESOLVED" ? 2_400_000 : 979_100,
          userCount: status === "RESOLVED" ? 45 : 22,
          topPredictors:
            p === "twitch"
              ? [{ userId: "blackgio789", userName: "blackgio789", amount: 50_000 }]
              : undefined,
        },
        {
          id: outcomeB,
          title: p === "twitch" ? "EggsQc" : "OqaXex",
          color: p === "twitch" ? "pink" : null,
          totalAmount: status === "RESOLVED" ? 705_000 : 848_900,
          userCount: status === "RESOLVED" ? 17 : 19,
        },
      ],
      winningOutcomeId: status === "RESOLVED" ? outcomeA : null,
      predictionWindowSeconds: 120,
      // Anchor the countdown at injection time so the time-remaining bar
      // visibly drains over the 120s window for an ACTIVE sim prediction.
      createdAt: new Date().toISOString(),
      endedAt: status === "RESOLVED" ? new Date().toISOString() : null,
      viewerOutcomeId: null,
      viewerStake: null,
    };
  };

  const injectPredictionTwitch = () => {
    if (platform !== "twitch") return;
    twitchChatService.emit("predictionUpdate", buildSyntheticPrediction("twitch", "ACTIVE"));
  };

  const injectPredictionEndedTwitch = () => {
    if (platform !== "twitch") return;
    twitchChatService.emit("predictionUpdate", buildSyntheticPrediction("twitch", "RESOLVED"));
  };

  const injectPredictionKick = () => {
    if (platform !== "kick") return;
    kickChatService.emit("predictionUpdate", buildSyntheticPrediction("kick", "ACTIVE"));
  };

  const injectPredictionEndedKick = () => {
    if (platform !== "kick") return;
    kickChatService.emit("predictionUpdate", buildSyntheticPrediction("kick", "RESOLVED"));
  };

  const isKick = platform === "kick";
  const isTwitch = platform === "twitch";

  // Mod-action debug controls (U8/U9) — read the dev-override store + the
  // reconnect-dialog opener so the panel can flip flags and pop dialogs
  // without touching real OAuth.
  const forceModRole = useDevModOverrideStore((s) => s.forceModRole);
  const forceModScopes = useDevModOverrideStore((s) => s.forceModScopes);
  const forceResolvedId = useDevModOverrideStore((s) => s.forceResolvedTwitchBroadcasterId);
  const forceBroadcasterIdentity = useDevModOverrideStore((s) => s.forceBroadcasterIdentity);
  const setForceModRole = useDevModOverrideStore((s) => s.setForceModRole);
  const setForceModScopes = useDevModOverrideStore((s) => s.setForceModScopes);
  const setForceResolvedId = useDevModOverrideStore((s) => s.setForceResolvedTwitchBroadcasterId);
  const setForceBroadcasterIdentity = useDevModOverrideStore((s) => s.setForceBroadcasterIdentity);
  const openReconnectDialog = useReconnectDialogStore((s) => s.open);
  const platformActionTitle = (
    enabled: boolean,
    enabledTitle: string,
    requiredPlatform: "Kick" | "Twitch"
  ) => (enabled ? enabledTitle : `Switch platform to ${requiredPlatform}`);

  return (
    <div>
      <div
        style={{
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <label
          htmlFor="chat-sim-platform"
          style={{ color: DEBUG_TOKENS.textSecondary, fontSize: 13 }}
        >
          Platform
        </label>
        <select
          id="chat-sim-platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as ChatPlatform)}
          style={{
            background: DEBUG_TOKENS.surfaceRaised,
            color: DEBUG_TOKENS.textPrimary,
            border: `1px solid ${DEBUG_TOKENS.border}`,
            font: `13px/1.2 ${DEBUG_TOKENS.fontUi}`,
            padding: "5px 10px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <option value="twitch">Twitch</option>
          <option value="kick">Kick</option>
        </select>
      </div>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Messages</div>
        <div style={buttonRowStyle}>
          <PillButton title={`Inject a random ${platform} chat message`} onClick={injectRandom}>
            random
          </PillButton>
          <PillButton
            title="Inject a highlighted first-time chatter message"
            onClick={injectFirstTime}
          >
            first-time chatter
          </PillButton>
          {isTwitch && (
            <PillButton title="Inject a Twitch /me action message" onClick={injectAction}>
              /me action
            </PillButton>
          )}
          <PillButton title="Inject a message with a mention fragment" onClick={injectMention}>
            mention
          </PillButton>
          <PillButton title="Inject a long wrapping chat message" onClick={injectLong}>
            long wrap
          </PillButton>
          <PillButton
            title="Inject a chat message from an extra-long username"
            onClick={injectLongUsername}
          >
            long username
          </PillButton>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Moderation</div>
        <div style={buttonRowStyle}>
          <PillButton
            title="Clear the debug target chat and inject a clear notice"
            onClick={injectClearAll}
          >
            clear all
          </PillButton>
          {(["compact", "cozy"] as const).map((style) => (
            <PillButton
              key={`deleted-${style}`}
              title={`Show a ${styleLabel(style)} deleted-message highlight for ${platform}`}
              onClick={() => injectDeletedMessagePreview(style)}
            >
              deleted {styleLabel(style).toLowerCase()}
            </PillButton>
          ))}
          {(["compact", "cozy"] as const).map((style) => (
            <PillButton
              key={`timeout-${style}`}
              title={`Show a ${styleLabel(style)} timeout highlight with deleted rows for ${platform}`}
              onClick={() => injectModerationActionPreview(style, 600)}
            >
              timeout {styleLabel(style).toLowerCase()}
            </PillButton>
          ))}
          {(["compact", "cozy"] as const).map((style) => (
            <PillButton
              key={`ban-${style}`}
              title={`Show a ${styleLabel(style)} ban highlight with deleted rows for ${platform}`}
              onClick={() => injectModerationActionPreview(style)}
            >
              ban {styleLabel(style).toLowerCase()}
            </PillButton>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Notices</div>
        <div style={buttonRowStyle}>
          <PillButton title="Inject a subscription notice" onClick={injectSub}>
            sub
          </PillButton>
          <PillButton title="Inject a 5 month resub notice" onClick={() => injectResub(5)}>
            resub 5mo
          </PillButton>
          <PillButton title="Inject a 36 month resub notice" onClick={() => injectResub(36)}>
            resub 3yr
          </PillButton>
          <PillButton title="Inject a gifted subscription notice" onClick={injectGiftSub}>
            gift sub
          </PillButton>
          <PillButton
            title="Inject a 50 mystery gifts notice"
            onClick={() => injectMysteryGift(50)}
          >
            50 mystery gifts
          </PillButton>
          <PillButton title="Inject a 1.2k viewer raid notice" onClick={() => injectRaid(1234)}>
            raid 1.2k
          </PillButton>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Twitch-only</div>
        <div style={buttonRowStyle}>
          <PillButton
            onClick={injectPinnedTwitch}
            disabled={!isTwitch}
            title={platformActionTitle(isTwitch, "Show a Twitch pinned message banner", "Twitch")}
          >
            pin message
          </PillButton>
          <PillButton
            onClick={injectPinnedClearTwitch}
            disabled={!isTwitch}
            title={platformActionTitle(
              isTwitch,
              "Clear the Twitch pinned message banner",
              "Twitch"
            )}
          >
            clear pin
          </PillButton>
          <PillButton
            onClick={injectPollTwitch}
            disabled={!isTwitch}
            title={platformActionTitle(isTwitch, "Show a live Twitch poll widget", "Twitch")}
          >
            poll (live)
          </PillButton>
          <PillButton
            onClick={injectPollEndedTwitch}
            disabled={!isTwitch}
            title={platformActionTitle(isTwitch, "Show an ended Twitch poll widget", "Twitch")}
          >
            poll (ended)
          </PillButton>
          <PillButton
            onClick={injectPredictionTwitch}
            disabled={!isTwitch}
            title={platformActionTitle(isTwitch, "Show a live Twitch prediction banner", "Twitch")}
          >
            prediction (live)
          </PillButton>
          <PillButton
            onClick={injectPredictionEndedTwitch}
            disabled={!isTwitch}
            title={platformActionTitle(
              isTwitch,
              "Show a resolved Twitch prediction banner",
              "Twitch"
            )}
          >
            prediction (ended)
          </PillButton>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Mod actions (Twitch)</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: DEBUG_TOKENS.textPrimary,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={forceModRole}
              onChange={(e) => setForceModRole(e.target.checked)}
              style={{ cursor: "pointer", accentColor: "#9146FF" }}
            />
            <span>
              force mod role
              <span style={{ color: DEBUG_TOKENS.textSecondary, marginLeft: 6, fontSize: 11 }}>
                — shows Pin on hover + Unpin on banner
              </span>
            </span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: DEBUG_TOKENS.textPrimary,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={forceModScopes}
              onChange={(e) => setForceModScopes(e.target.checked)}
              style={{ cursor: "pointer", accentColor: "#9146FF" }}
            />
            <span>
              force mod scopes
              <span style={{ color: DEBUG_TOKENS.textSecondary, marginLeft: 6, fontSize: 11 }}>
                — skips reconnect dialog; mutation still requires real token
              </span>
            </span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: DEBUG_TOKENS.textPrimary,
            }}
          >
            <span style={{ minWidth: 110 }}>force resolved id</span>
            <input
              type="text"
              value={forceResolvedId}
              onChange={(e) => setForceResolvedId(e.target.value.trim())}
              placeholder="(empty = real Helix call)"
              aria-label="Force resolved Twitch broadcaster id"
              style={{
                flex: 1,
                background: DEBUG_TOKENS.surfaceRaised,
                color: DEBUG_TOKENS.textPrimary,
                border: `1px solid ${DEBUG_TOKENS.border}`,
                font: `12.5px/1.2 ${DEBUG_TOKENS.fontUi}`,
                padding: "4px 8px",
                borderRadius: 6,
              }}
            />
          </label>
          <div
            style={{
              color: DEBUG_TOKENS.textSecondary,
              fontSize: 11,
              marginLeft: 22,
            }}
          >
            — bypass /users resolve on /mod/twitch/$login pages
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: DEBUG_TOKENS.textPrimary,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={forceBroadcasterIdentity}
              onChange={(e) => setForceBroadcasterIdentity(e.target.checked)}
              style={{ cursor: "pointer", accentColor: "#9146FF" }}
            />
            <span>
              force broadcaster identity
              <span style={{ color: DEBUG_TOKENS.textSecondary, marginLeft: 6, fontSize: 11 }}>
                — unlocks Moderators / VIPs / Engagement gates
              </span>
            </span>
          </label>
        </div>
        <div style={buttonRowStyle}>
          <PillButton
            title="Open the reconnect dialog with Twitch moderator scopes missing"
            onClick={() =>
              openReconnectDialog({
                missingScopes: ["user:read:moderated_channels", "moderator:manage:chat_messages"],
              })
            }
          >
            show reconnect dialog
          </PillButton>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Kick-only</div>
        <div style={buttonRowStyle}>
          <PillButton
            onClick={injectPinnedKick}
            disabled={!isKick}
            title={platformActionTitle(isKick, "Show a Kick pinned message banner", "Kick")}
          >
            pin message
          </PillButton>
          <PillButton
            onClick={injectPinnedClearKick}
            disabled={!isKick}
            title={platformActionTitle(isKick, "Clear the Kick pinned message banner", "Kick")}
          >
            clear pin
          </PillButton>
          <PillButton
            onClick={injectPollKick}
            disabled={!isKick}
            title={platformActionTitle(isKick, "Show a live Kick poll widget", "Kick")}
          >
            poll (live)
          </PillButton>
          <PillButton
            onClick={injectPollEndedKick}
            disabled={!isKick}
            title={platformActionTitle(isKick, "Show an ended Kick poll widget", "Kick")}
          >
            poll (ended)
          </PillButton>
          <PillButton
            onClick={injectPredictionKick}
            disabled={!isKick}
            title={platformActionTitle(isKick, "Show a live Kick prediction banner", "Kick")}
          >
            prediction (live)
          </PillButton>
          <PillButton
            onClick={injectPredictionEndedKick}
            disabled={!isKick}
            title={platformActionTitle(isKick, "Show a resolved Kick prediction banner", "Kick")}
          >
            prediction (ended)
          </PillButton>
        </div>
      </section>
    </div>
  );
}
