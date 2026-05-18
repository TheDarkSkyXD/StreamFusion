/**
 * InlineModStrip
 *
 * Horizontal strip that sits above the message list (between any pinned
 * banner and the messages themselves) and gives a moderator one-click
 * access to chat-mode toggles and one-shot actions. Click handlers lift
 * the action up to the parent — the parent owns the
 * {@link ModActionConfirmDialog} that asks the moderator to confirm.
 *
 * Layout: left group = 4 toggles (slow / followers / subscribers / emote),
 * right group = up to 5 one-shots (clear / raid / unique-chat / commercial
 * / shield). Twitch broadcaster sees all 9; Twitch mod sees 7 (no raid,
 * no commercial); Kick sees 5 (the four toggles + clear).
 */

import {
  LuArrowRight,
  LuClock,
  LuCrown,
  LuFingerprint,
  LuPlay,
  LuShield,
  LuSmile,
  LuTrash2,
  LuUserCheck,
} from "react-icons/lu";

export type InlineModAction =
  | { kind: "slow-mode"; currentlyActive: boolean }
  | { kind: "followers-only"; currentlyActive: boolean }
  | { kind: "subscribers-only"; currentlyActive: boolean }
  | { kind: "emote-only"; currentlyActive: boolean }
  | { kind: "clear" }
  | { kind: "raid" }
  | { kind: "unique-chat"; currentlyActive: boolean }
  | { kind: "commercial" }
  | { kind: "shield"; currentlyActive: boolean };

export interface InlineModStripRoomState {
  slowMode: number | null;
  followersOnly: number | null;
  subscribersOnly: boolean;
  emoteOnly: boolean;
  uniqueChat: boolean;
  shieldMode: boolean;
}

export interface InlineModStripProps {
  platform: "twitch" | "kick";
  isBroadcaster: boolean;
  /** Channel id — passed back to consumers via context, not used here directly. */
  channelId: string;
  /** Channel slug — passed back to consumers via context, not used here directly. */
  channelSlug: string;
  onActionClick: (action: InlineModAction) => void;
  roomState: InlineModStripRoomState;
}

const ACTIVE_CLASS =
  "bg-[#9146FF]/20 text-purple-300 border border-purple-400/60";
const INACTIVE_CLASS =
  "text-gray-400 hover:text-white hover:bg-white/10 border border-transparent";

interface StripButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}

function StripButton({ label, active, onClick, children, testId }: StripButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-active={active ? "true" : "false"}
      data-testid={testId}
      onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
        active ? ACTIVE_CLASS : INACTIVE_CLASS
      }`}
    >
      {children}
    </button>
  );
}

export function InlineModStrip({
  platform,
  isBroadcaster,
  onActionClick,
  roomState,
}: InlineModStripProps) {
  const isTwitch = platform === "twitch";
  const slowActive = roomState.slowMode !== null;
  const followersActive = roomState.followersOnly !== null;
  const subsActive = roomState.subscribersOnly;
  const emoteActive = roomState.emoteOnly;
  const uniqueActive = roomState.uniqueChat;
  const shieldActive = roomState.shieldMode;

  return (
    <div
      className="flex items-center gap-1 px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-background-tertiary,#1a1a1a)]"
      data-testid="inline-mod-strip"
      role="toolbar"
      aria-label="Chat moderation actions"
    >
      {/* Left group: chat-mode toggles. Same set across platforms. */}
      <StripButton
        label={slowActive ? "Turn off slow mode" : "Turn on slow mode"}
        active={slowActive}
        onClick={() =>
          onActionClick({ kind: "slow-mode", currentlyActive: slowActive })
        }
        testId="inline-mod-strip-slow"
      >
        <LuClock className="w-4 h-4" />
      </StripButton>
      <StripButton
        label={
          followersActive ? "Turn off followers-only mode" : "Turn on followers-only mode"
        }
        active={followersActive}
        onClick={() =>
          onActionClick({
            kind: "followers-only",
            currentlyActive: followersActive,
          })
        }
        testId="inline-mod-strip-followers"
      >
        <LuUserCheck className="w-4 h-4" />
      </StripButton>
      <StripButton
        label={
          subsActive ? "Turn off subscribers-only mode" : "Turn on subscribers-only mode"
        }
        active={subsActive}
        onClick={() =>
          onActionClick({
            kind: "subscribers-only",
            currentlyActive: subsActive,
          })
        }
        testId="inline-mod-strip-subscribers"
      >
        <LuCrown className="w-4 h-4" />
      </StripButton>
      <StripButton
        label={emoteActive ? "Turn off emote-only mode" : "Turn on emote-only mode"}
        active={emoteActive}
        onClick={() =>
          onActionClick({ kind: "emote-only", currentlyActive: emoteActive })
        }
        testId="inline-mod-strip-emote"
      >
        <LuSmile className="w-4 h-4" />
      </StripButton>

      <div className="flex-1" />

      {/* Right group: one-shots + Twitch-only toggles. */}
      <StripButton
        label="Clear chat"
        onClick={() => onActionClick({ kind: "clear" })}
        testId="inline-mod-strip-clear"
      >
        <LuTrash2 className="w-4 h-4" />
      </StripButton>

      {isTwitch && isBroadcaster ? (
        <StripButton
          label="Start a raid"
          onClick={() => onActionClick({ kind: "raid" })}
          testId="inline-mod-strip-raid"
        >
          <LuArrowRight className="w-4 h-4" />
        </StripButton>
      ) : null}

      {isTwitch ? (
        <StripButton
          label={uniqueActive ? "Turn off unique-chat mode" : "Turn on unique-chat mode"}
          active={uniqueActive}
          onClick={() =>
            onActionClick({ kind: "unique-chat", currentlyActive: uniqueActive })
          }
          testId="inline-mod-strip-unique"
        >
          <LuFingerprint className="w-4 h-4" />
        </StripButton>
      ) : null}

      {isTwitch && isBroadcaster ? (
        <StripButton
          label="Run a commercial"
          onClick={() => onActionClick({ kind: "commercial" })}
          testId="inline-mod-strip-commercial"
        >
          <LuPlay className="w-4 h-4" />
        </StripButton>
      ) : null}

      {isTwitch ? (
        <StripButton
          label={shieldActive ? "Disable Shield Mode" : "Enable Shield Mode"}
          active={shieldActive}
          onClick={() =>
            onActionClick({ kind: "shield", currentlyActive: shieldActive })
          }
          testId="inline-mod-strip-shield"
        >
          <LuShield className="w-4 h-4" />
        </StripButton>
      ) : null}
    </div>
  );
}
