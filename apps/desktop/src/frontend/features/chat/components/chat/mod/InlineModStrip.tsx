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
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../../components/ui/tooltip";

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

const ACTIVE_CLASS = "bg-[#9146FF]/20 text-purple-300 border border-purple-400/60";
const INACTIVE_CLASS =
  "text-neutral-400 hover:text-white hover:bg-white/10 border border-transparent";

interface StripButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}

function StripButton({ label, active, onClick, children, testId }: StripButtonProps) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
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
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function InlineModStrip({
  platform,
  isBroadcaster,
  onActionClick,
  roomState,
}: InlineModStripProps) {
  const { t } = useTranslation();
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
      aria-label={t("chatModeration.toolbar")}
    >
      {/* Left group: chat-mode toggles. Same set across platforms. */}
      <StripButton
        label={
          slowActive ? t("chatModeration.turnOffSlowMode") : t("chatModeration.turnOnSlowMode")
        }
        active={slowActive}
        onClick={() => onActionClick({ kind: "slow-mode", currentlyActive: slowActive })}
        testId="inline-mod-strip-slow"
      >
        <LuClock className="w-4 h-4" />
      </StripButton>
      <StripButton
        label={
          followersActive
            ? t("chatModeration.turnOffFollowersMode")
            : t("chatModeration.turnOnFollowersMode")
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
          subsActive
            ? t("chatModeration.turnOffSubscribersMode")
            : t("chatModeration.turnOnSubscribersMode")
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
        label={
          emoteActive ? t("chatModeration.turnOffEmoteMode") : t("chatModeration.turnOnEmoteMode")
        }
        active={emoteActive}
        onClick={() => onActionClick({ kind: "emote-only", currentlyActive: emoteActive })}
        testId="inline-mod-strip-emote"
      >
        <LuSmile className="w-4 h-4" />
      </StripButton>

      <div className="flex-1" />

      {/* Right group: one-shots + Twitch-only toggles. */}
      <StripButton
        label={t("chatModeration.clearChat")}
        onClick={() => onActionClick({ kind: "clear" })}
        testId="inline-mod-strip-clear"
      >
        <LuTrash2 className="w-4 h-4" />
      </StripButton>

      {isTwitch && isBroadcaster ? (
        <StripButton
          label={t("chatModeration.startRaid")}
          onClick={() => onActionClick({ kind: "raid" })}
          testId="inline-mod-strip-raid"
        >
          <LuArrowRight className="w-4 h-4" />
        </StripButton>
      ) : null}

      {isTwitch ? (
        <StripButton
          label={
            uniqueActive
              ? t("chatModeration.turnOffUniqueChat")
              : t("chatModeration.turnOnUniqueChat")
          }
          active={uniqueActive}
          onClick={() => onActionClick({ kind: "unique-chat", currentlyActive: uniqueActive })}
          testId="inline-mod-strip-unique"
        >
          <LuFingerprint className="w-4 h-4" />
        </StripButton>
      ) : null}

      {isTwitch && isBroadcaster ? (
        <StripButton
          label={t("chatModeration.runCommercial")}
          onClick={() => onActionClick({ kind: "commercial" })}
          testId="inline-mod-strip-commercial"
        >
          <LuPlay className="w-4 h-4" />
        </StripButton>
      ) : null}

      {isTwitch ? (
        <StripButton
          label={
            shieldActive
              ? t("chatModeration.disableShieldMode")
              : t("chatModeration.enableShieldMode")
          }
          active={shieldActive}
          onClick={() => onActionClick({ kind: "shield", currentlyActive: shieldActive })}
          testId="inline-mod-strip-shield"
        >
          <LuShield className="w-4 h-4" />
        </StripButton>
      ) : null}
    </div>
  );
}
