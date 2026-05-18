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
import type {
  ChatMessage,
  ChatPlatform,
  KickPinnedMessage,
  KickPoll,
  NormalizedPinnedMessage,
} from "../../shared/chat-types";
import { useChatStore } from "../../store/chat-store";
import { useDevModOverrideStore } from "../../store/dev-mod-override-store";
import { useReconnectDialogStore } from "../../store/reconnect-dialog-store";

import { DEBUG_TOKENS } from "./tokens";

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
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
  title?: string;
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
  const [platform, setPlatform] = useState<ChatPlatform>("twitch");

  const inject = (overrides: Partial<ChatMessage>) => {
    const u = pickUser();
    const msg: ChatMessage = {
      id: uid("debug"),
      platform,
      type: "message",
      channel: "debug-channel",
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

  const injectBan = (duration?: number) => {
    const u = pickUser();
    inject({
      type: "ban",
      userId: "system",
      username: "System",
      displayName: "System",
      color: "#808080",
      content: [],
      rawContent: "",
      banInfo: {
        bannedUsername: u.displayName,
        bannedByUsername: "ModeratorBot",
        lastMessage: "this was the last thing they said",
        duration,
      },
    });
  };

  const injectClearAll = () => {
    useChatStore.getState().clearMessages(platform);
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

  const injectSub = () => {
    const u = pickUser();
    injectSystemNotice(`${u.displayName} just subscribed!`);
  };

  const injectResub = (months: number) => {
    const u = pickUser();
    injectSystemNotice(`${u.displayName} resubscribed for ${months} months!`);
  };

  const injectGiftSub = () => {
    const u = pickUser();
    const r = pickUser();
    injectSystemNotice(`${u.displayName} gifted a subscription to ${r.displayName}!`);
  };

  const injectMysteryGift = (count: number) => {
    const u = pickUser();
    injectSystemNotice(`${u.displayName} is gifting ${count} subs to the channel!`);
  };

  const injectRaid = (count: number) => {
    const u = pickUser();
    injectSystemNotice(`${count} raiders from ${u.displayName} have joined!`);
  };

  const injectDeleteLast = () => {
    const messages = useChatStore.getState().messages;
    const last = [...messages].reverse().find((m) => m.type === "message");
    if (last) useChatStore.getState().deleteMessage(last.id);
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
    const now = new Date().toISOString();
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
      expiresAt: null,
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

  const isKick = platform === "kick";
  const isTwitch = platform === "twitch";
  const kickDisabledTitle = isKick ? "" : "Switch platform to Kick";

  // Mod-action debug controls (U8/U9) — read the dev-override store + the
  // reconnect-dialog opener so the panel can flip flags and pop dialogs
  // without touching real OAuth.
  const forceModRole = useDevModOverrideStore((s) => s.forceModRole);
  const forceModScopes = useDevModOverrideStore((s) => s.forceModScopes);
  const setForceModRole = useDevModOverrideStore((s) => s.setForceModRole);
  const setForceModScopes = useDevModOverrideStore((s) => s.setForceModScopes);
  const openReconnectDialog = useReconnectDialogStore((s) => s.open);
  const twitchDisabledTitle = isTwitch ? "" : "Switch platform to Twitch";

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
        <label style={{ color: DEBUG_TOKENS.textSecondary, fontSize: 13 }}>Platform</label>
        <select
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
          <PillButton onClick={injectRandom}>random</PillButton>
          <PillButton onClick={injectFirstTime}>first-time chatter</PillButton>
          <PillButton onClick={injectAction}>/me action</PillButton>
          <PillButton onClick={injectMention}>mention</PillButton>
          <PillButton onClick={injectLong}>long wrap</PillButton>
          <PillButton onClick={injectLongUsername}>long username</PillButton>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Moderation</div>
        <div style={buttonRowStyle}>
          <PillButton onClick={() => injectBan(60)}>timeout 60s</PillButton>
          <PillButton onClick={() => injectBan(600)}>timeout 10m</PillButton>
          <PillButton onClick={() => injectBan()}>perma ban</PillButton>
          <PillButton onClick={injectClearAll}>clear all</PillButton>
          <PillButton onClick={injectDeleteLast}>delete last</PillButton>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Notices</div>
        <div style={buttonRowStyle}>
          <PillButton onClick={injectSub}>sub</PillButton>
          <PillButton onClick={() => injectResub(5)}>resub 5mo</PillButton>
          <PillButton onClick={() => injectResub(36)}>resub 3yr</PillButton>
          <PillButton onClick={injectGiftSub}>gift sub</PillButton>
          <PillButton onClick={() => injectMysteryGift(50)}>50 mystery gifts</PillButton>
          <PillButton onClick={() => injectRaid(1234)}>raid 1.2k</PillButton>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Twitch-only</div>
        <div style={buttonRowStyle}>
          <PillButton onClick={injectPinnedTwitch} disabled={!isTwitch} title={twitchDisabledTitle}>
            pin message
          </PillButton>
          <PillButton
            onClick={injectPinnedClearTwitch}
            disabled={!isTwitch}
            title={twitchDisabledTitle}
          >
            clear pin
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
        </div>
        <div style={buttonRowStyle}>
          <PillButton onClick={openReconnectDialog}>show reconnect dialog</PillButton>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Kick-only</div>
        <div style={buttonRowStyle}>
          <PillButton onClick={injectPinnedKick} disabled={!isKick} title={kickDisabledTitle}>
            pin message
          </PillButton>
          <PillButton onClick={injectPinnedClearKick} disabled={!isKick} title={kickDisabledTitle}>
            clear pin
          </PillButton>
          <PillButton onClick={injectPollKick} disabled={!isKick} title={kickDisabledTitle}>
            poll (live)
          </PillButton>
          <PillButton onClick={injectPollEndedKick} disabled={!isKick} title={kickDisabledTitle}>
            poll (ended)
          </PillButton>
        </div>
      </section>
    </div>
  );
}
