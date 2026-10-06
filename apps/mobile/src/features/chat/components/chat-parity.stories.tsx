import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@mobile/features/settings/domain/chat-display-preferences";
import type { ChatDisplayPreferences } from "@mobile/features/settings/capabilities/chat-display-settings";
import type {
  ChatCosmeticBadge,
  ChatEmote,
  ChatUserCosmetics,
} from "../capabilities/chat-interactions";
import type { WatchChatMessage } from "../capabilities/watch-chat";
import type { Platform } from "@streamfusion/core/platform";
import { getBundledBadgeUrl } from "../utils/kick-badge-assets";
import { parseKickIdentityBadges, parseKickSubscriberCatalog, resolveKickChatBadges } from "../domain/kick-chat-badges";
import { ChatMessageRow } from "./chat-message-row";

const image = (color: string, mark: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><rect width="56" height="56" rx="12" fill="${color}"/><text x="28" y="37" fill="white" font-size="27" font-family="sans-serif" font-weight="bold" text-anchor="middle">${mark}</text></svg>`)}`;

const officialMod = image("#5a5d66", "M");
const sevenBadge = image("#a970ff", "7");
const bttvBadge = image("#3d9fcb", "B");
const ffzMod = image("#e5972a", "F");
const baseEmote = image("#772ce8", "P");
const overlayEmote = image("#dc143c", "+");
const staticEmote = image("#404040", "S");
const animatedEmote = image("#a970ff", "A");

const noSelection = () => undefined;
const message = (
  id: string,
  text: string,
  changes: Partial<WatchChatMessage> = {},
): WatchChatMessage => ({
  id,
  text,
  displayName: "Viewer",
  username: "viewer",
  userId: "viewer-1",
  badges: [],
  ...changes,
});

function RowCase({
  label,
  item,
  preferences = DEFAULT_CHAT_DISPLAY_PREFERENCES,
  cosmetics,
  roleBadges,
  emotes = [],
  platform = "twitch",
}: {
  readonly label: string;
  readonly item: WatchChatMessage;
  readonly preferences?: ChatDisplayPreferences;
  readonly cosmetics?: ChatUserCosmetics;
  readonly roleBadges?: readonly ChatCosmeticBadge[];
  readonly emotes?: readonly ChatEmote[];
  readonly platform?: Platform;
}) {
  return (
    <View
      style={{
        gap: mobileSpacing.small,
        padding: mobileSpacing.medium,
        backgroundColor: mobileColors.surface,
        borderColor: mobileColors.border,
        borderWidth: 1,
        borderRadius: mobileRadii.large,
      }}
    >
      <Text style={mobileType.label}>{label}</Text>
      <ChatMessageRow
        message={item}
        platform={platform}
        emotes={emotes}
        preferences={preferences}
        cosmetics={cosmetics}
        roleBadges={roleBadges}
        onSelect={noSelection}
      />
    </View>
  );
}

const meta = {
  title: "Features/Chat/Parity",
  component: ChatMessageRow,
  decorators: [
    (Story) => (
      <View
        style={{
          width: 400,
          minHeight: 380,
          padding: mobileSpacing.medium,
          gap: mobileSpacing.small,
          backgroundColor: mobileColors.background,
        }}
      >
        <Story />
      </View>
    ),
  ],
  args: {
    message: message("base", "Hello chat"),
    platform: "twitch",
    emotes: [],
    preferences: DEFAULT_CHAT_DISPLAY_PREFERENCES,
    onSelect: noSelection,
  },
} satisfies Meta<typeof ChatMessageRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SubscriptionGiftRaidNotices: Story = {
  render: () => (
    <View style={{ gap: mobileSpacing.small }}>
      <RowCase
        label="Subscription"
        item={message("sub", "subscribed for 4 months", {
          kind: "notice",
          noticeKind: "subscription",
          displayName: "Mira",
        })}
      />
      <RowCase
        label="Gift"
        item={message("gift", "gifted 5 subscriptions", {
          kind: "notice",
          noticeKind: "gift",
          displayName: "Omar",
        })}
      />
      <RowCase
        label="Raid"
        item={message("raid", "raided with 124 viewers", {
          kind: "notice",
          noticeKind: "raid",
          displayName: "Sage",
        })}
      />
    </View>
  ),
};

export const FirstMessage: Story = {
  render: () => (
    <RowCase
      label="First message highlight"
      item={message("first", "First time here. This looks fun!", {
        firstMessage: true,
        displayName: "NewChatter",
      })}
    />
  ),
};

const removed = message("removed", "A message removed by a moderator", {
  deletedAt: Date.UTC(2026, 9, 5, 18, 30),
  deletedBy: "Moderator",
  deletionKind: "message",
});

export const DeletedTombstone: Story = {
  render: () => (
    <RowCase
      label="Deleted message, tombstone"
      item={removed}
      preferences={{
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        deletedMessageDisplay: "tombstone",
      }}
    />
  ),
};

export const DeletedAudit: Story = {
  render: () => (
    <RowCase
      label="Deleted message, audit"
      item={{ ...removed, id: "audit" }}
      preferences={{
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        deletedMessageDisplay: "audit",
        moderationHighlightStyle: "cozy",
      }}
    />
  ),
};

const ffzRole: ChatCosmeticBadge = {
  id: "ffz-mod",
  provider: "ffz",
  title: "FFZ Moderator",
  imageUrl: ffzMod,
  replaces: "moderator",
};
const providerCosmetics: ChatUserCosmetics = {
  badges: [
    {
      id: "seven-supporter",
      provider: "7tv",
      title: "7TV Supporter",
      imageUrl: sevenBadge,
    },
    {
      id: "bttv-supporter",
      provider: "bttv",
      title: "BTTV Supporter",
      imageUrl: bttvBadge,
    },
  ],
};

export const ProviderBadgesAndFfzRole: Story = {
  render: () => (
    <RowCase
      label="7TV and BTTV badges with FFZ moderator replacement"
      item={message("role", "Keeping chat tidy", {
        displayName: "ModAster",
        badges: [
          {
            setId: "moderator",
            version: "1",
            title: "Moderator",
            imageUrl: officialMod,
          },
        ],
      })}
      cosmetics={providerCosmetics}
      roleBadges={[ffzRole]}
    />
  ),
};

const layeredPaint: ChatUserCosmetics = {
  badges: [],
  paint: {
    kind: "layers",
    id: "layered-seven-paint",
    layers: [
      {
        kind: "linear",
        opacity: 1,
        angle: 30,
        stops: [
          { at: 0, color: "#a970ff" },
          { at: 0.5, color: "#53fc18" },
          { at: 1, color: "#a970ff" },
        ],
      },
      {
        kind: "radial",
        opacity: 0.35,
        shape: "ellipse",
        stops: [
          { at: 0, color: "#ffffff" },
          { at: 1, color: "#772ce8" },
        ],
      },
    ],
    shadows: [{ xOffset: 0, yOffset: 1, radius: 2, color: "#0f0f0f" }],
  },
};

export const Layered7tvGradientPaint: Story = {
  render: () => (
    <RowCase
      label="Layered 7TV username paint"
      item={message("paint", "A painted name in the same chat row", {
        displayName: "PaintedViewer",
      })}
      cosmetics={layeredPaint}
    />
  ),
};

const stackedEmotes: readonly ChatEmote[] = [
  {
    id: "base",
    name: "Pog",
    insertion: "Pog",
    provider: "7tv",
    imageUrl: baseEmote,
  },
  {
    id: "overlay",
    name: "Halo",
    insertion: "Halo",
    provider: "7tv",
    imageUrl: overlayEmote,
    zeroWidth: true,
  },
];

export const OverlayEmotes: Story = {
  render: () => (
    <RowCase
      label="Zero-width emote overlays the base"
      item={message("overlay", "Pog Halo looks good")}
      emotes={stackedEmotes}
    />
  ),
};

const motionEmote: ChatEmote = {
  id: "motion",
  name: "Loop",
  insertion: "Loop",
  provider: "7tv",
  imageUrl: animatedEmote,
  animatedImageUrl: animatedEmote,
  staticImageUrl: staticEmote,
};

export const AnimationDisabled: Story = {
  render: () => (
    <RowCase
      label="Animated emote setting off, static image shown"
      item={message("static", "Loop stays still")}
      emotes={[motionEmote]}
      preferences={{
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        animatedEmotes: false,
      }}
    />
  ),
};

const spreenSubscriberCatalog = parseKickSubscriberCatalog({
  subscriber_badges: [
    { months: 1, badge_image: { src: "https://files.kick.com/channel_subscriber_badges/1096607/conversion/original-fullsize.png" } },
    { months: 12, badge_image: { src: "https://files.kick.com/channel_subscriber_badges/1096612/conversion/original-fullsize.png" } },
    { months: 24, badge_image: { src: "https://files.kick.com/channel_subscriber_badges/1096615/conversion/original-fullsize.png" } },
  ],
});

const kickRoleBadges = parseKickIdentityBadges(
  ["broadcaster", "moderator", "vip", "og", "founder", "verified"].map((type) => ({ type, text: type })),
  getBundledBadgeUrl,
);
const kickSubscriberBadges = resolveKickChatBadges(
  parseKickIdentityBadges([{ type: "subscriber", text: "Subscriber", count: 14 }], getBundledBadgeUrl),
  spreenSubscriberCatalog,
);
const kickGiftBadges = parseKickIdentityBadges(
  [{ type: "sub_gifter", text: "Sub gifter", count: 50 }],
  getBundledBadgeUrl,
);

export const KickOfficialBadges: Story = {
  render: () => (
    <View style={{ gap: mobileSpacing.small }}>
      <RowCase label="Kick roles" platform="kick" item={message("kick-roles", "Official role artwork", { badges: kickRoleBadges })} />
      <RowCase label="Spreen subscriber, 14 months uses 12-month tier" platform="kick" item={message("kick-sub", "Channel-specific subscriber badge", { badges: kickSubscriberBadges })} />
      <RowCase label="Kick sub gifter, 50 gifts" platform="kick" item={message("kick-gift", "Count-tiered gift badge", { badges: kickGiftBadges })} />
    </View>
  ),
};
