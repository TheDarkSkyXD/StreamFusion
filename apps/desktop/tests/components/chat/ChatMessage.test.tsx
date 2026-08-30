import { act, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { Profiler, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatMessage } from "@/features/chat/components/chat/ChatMessage";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  type TimestampFormat,
} from "@shared/auth-types";
import type { ChatBadge, ChatMessage as ChatMessageType } from "@shared/chat-types";
import { useAuthStore } from "@/store/auth-store";
import { useChatCosmeticsStore } from "@/store/chat-cosmetics-store";

// Seed the chatDisplay prefs the renderer reads. Leaving the store at its
// natural null default (the afterEach reset) gives DEFAULT_CHAT_DISPLAY_PREFERENCES.
function setChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides },
    } as typeof s.preferences,
  }));
}

function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

beforeEach(() => {
  useChatCosmeticsStore.getState().reset();
  // Reset chatDisplay to defaults before each render so the existing tests see
  // the shipped defaults (timestamps off) and new-test overrides don't leak.
  useAuthStore.setState((s) => ({
    ...s,
    twitchUser: null,
    twitchConnected: false,
    kickUser: null,
    kickConnected: false,
    isGuest: true,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
    } as typeof s.preferences,
  }));
});

function badge(setId: string): ChatBadge {
  return { setId, version: "1", imageUrl: "https://example.com/b.png", title: setId };
}

function baseMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    id: "m1",
    platform: "twitch",
    timestamp: Date.now(),
    type: "message",
    userId: "u1",
    username: "ninja",
    displayName: "Ninja",
    color: "#ff0000",
    badges: [],
    content: [{ type: "text", content: "hello world" }],
    isAction: false,
    ...overrides,
  } as ChatMessageType;
}

function setTwitchViewer(login = "darkskyfullofstars", displayName = "DarkSkyFullOfStars") {
  useAuthStore.setState((s) => ({
    ...s,
    twitchConnected: true,
    twitchUser: {
      id: "viewer-id",
      login,
      displayName,
      profileImageUrl: "https://example.com/viewer.png",
      createdAt: "2026-01-01T00:00:00Z",
      broadcasterType: "",
    },
    isGuest: false,
  }));
}

// Guards: emote-heavy chat rows stay Kick-compact instead of adding outer row gaps around each emote line
// Guards: chat rows clip horizontal overflow without becoming per-message vertical scroll containers
// Guards: inline chat images reserve dimensions and load eagerly so virtualized fast chat does not flicker from row remeasurement
// Guards: mention fragments render as @username in chat rows without duplicating an existing @ prefix
// Guards: signed-in viewer mentions render as Twitch-style mention cards, while guest and other-user mentions stay ordinary rows
// Guards: first-time chat messages render as white-bordered Twitch-style cards instead of inline purple rows
// Guards: moderator-badged chat messages render as green moderator cards with platform-specific icons instead of ordinary rows
// Guards: signed-in Kick broadcasters do not see moderator presentation on their own channel messages
// Guards: subscription, gift, bits, cheer, and highlighted-message events render as event-specific banners instead of generic System rows
// Guards: click-to-reply uses Twitch's circular reply affordance and exact SVG path on every opted-in chat platform
// Guards: deleted chat rows can reveal the retained original message with emotes plus deletion metadata when enabled
// Guards: pin-message uses Twitch's circular hover affordance and exact SVG path instead of a generic icon
// Guards: reply and pin hover actions sit on the top edge of the chat row with visible space between them
// Guards: pin-message tooltip uses Twitch's top-end placement while keeping text left-aligned
// Guards: username hover keeps the message row background off while the username keeps its own Twitch hover state
// Guards: chat row hover highlighting respects the saved smooth-hover preference without overriding reduced-motion users
// Guards: parsed Twitch reply metadata renders inline context without crashing when its body or author fields have malformed runtime types
// Guards: long usernames keep the regular-message colon in the same wrap group as the name.
// Guards: Twitch /me action messages keep visual space between username and action text.
describe("ChatMessage", () => {
  it("renders username and text fragment", () => {
    render(<ChatMessage message={baseMessage()} />);
    expect(screen.getByText("Ninja")).toBeInTheDocument();
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
  });

  it("preserves every sender badge when no badge limit is requested", () => {
    const badges = Array.from({ length: 6 }, (_, index) => badge(`badge-${index}`));

    render(<ChatMessage message={baseMessage({ badges })} />);

    expect(screen.getAllByRole("img", { name: /^badge-/ })).toHaveLength(6);
  });

  it("keeps official role semantics while ordering enabled provider badges after Twitch badges", () => {
    const official = [badge("moderator")];
    const cosmetics = useChatCosmeticsStore.getState();
    cosmetics.setGlobalProviderBadges("bttv", [
      {
        userId: "u1",
        badge: {
          id: "bttv:pro",
          provider: "bttv",
          providerId: "pro",
          title: "Pro",
          imageUrl: "bttv.png",
        },
      },
    ]);
    cosmetics.setGlobalProviderBadges("ffz", [
      {
        userId: "u1",
        badge: {
          id: "ffz:dev",
          provider: "ffz",
          providerId: "dev",
          title: "Dev",
          imageUrl: "ffz.png",
        },
      },
    ]);
    cosmetics.applySevenTvEvent("channel-1", {
      type: "badge.upsert",
      badge: {
        id: "7tv:founder",
        provider: "7tv",
        providerId: "founder",
        title: "Founder",
        imageUrl: "7tv.png",
      },
    });
    cosmetics.applySevenTvEvent("channel-1", {
      type: "assignment.upsert",
      assignment: { userId: "u1", kind: "badge", cosmeticId: "founder" },
    });
    cosmetics.setFfzRoleBadges("channel-1", {
      moderator: {
        id: "ffz:room-moderator",
        provider: "ffz",
        providerId: "room-moderator",
        title: "FFZ Moderator",
        imageUrl: "ffz-mod.png",
      },
    });

    render(
      <ChatMessage
        message={baseMessage({ badges: official })}
        currentChannelContext={{ channelId: "channel-1", channelSlug: "ninja" }}
      />
    );

    expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual([
      "moderator",
      "FrankerFaceZ: Dev",
      "BetterTTV: Pro",
      "7TV: Founder",
    ]);
    expect(screen.getByAltText("moderator")).toHaveAttribute("src", "ffz-mod.png");
    expect(official).toEqual([badge("moderator")]);
    expect(screen.getByTestId("moderator-chat-highlight")).toBeInTheDocument();
  });

  it("removes a disabled provider at render time without changing official badges", () => {
    setChatDisplay({ enableBttvBadges: false });
    useChatCosmeticsStore.getState().setGlobalProviderBadges("bttv", [
      {
        userId: "u1",
        badge: {
          id: "bttv:pro",
          provider: "bttv",
          providerId: "pro",
          title: "Pro",
          imageUrl: "bttv.png",
        },
      },
    ]);
    render(
      <ChatMessage
        message={baseMessage({ badges: [badge("subscriber")] })}
        currentChannelContext={{ channelId: "channel-1", channelSlug: "ninja" }}
      />
    );
    expect(screen.getByAltText("subscriber")).toBeInTheDocument();
    expect(screen.queryByAltText("BetterTTV: Pro")).toBeNull();
  });

  it("uses assigned FFZ replacements in official slots and orders remaining badges by slot", () => {
    const cosmetics = useChatCosmeticsStore.getState();
    cosmetics.setGlobalProviderBadges("ffz", [
      {
        userId: "u1",
        badge: {
          id: "ffz:bot",
          provider: "ffz",
          providerId: "bot",
          title: "Bot",
          imageUrl: "bot.png",
          replaces: "moderator",
          slot: 1,
          color: "#00ad03",
        },
      },
      {
        userId: "u1",
        badge: {
          id: "ffz:late",
          provider: "ffz",
          providerId: "late",
          title: "Late",
          imageUrl: "late.png",
          slot: 20,
          color: "#abcdef",
        },
      },
      {
        userId: "u1",
        badge: {
          id: "ffz:early",
          provider: "ffz",
          providerId: "early",
          title: "Early",
          imageUrl: "early.png",
          slot: 10,
          color: "#123456",
        },
      },
    ]);

    render(
      <ChatMessage
        message={baseMessage({ badges: [badge("moderator")] })}
        currentChannelContext={{ channelId: "channel-1", channelSlug: "ninja" }}
      />
    );

    expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual([
      "moderator",
      "FrankerFaceZ: Early",
      "FrankerFaceZ: Late",
    ]);
    expect(screen.getByAltText("moderator")).toHaveAttribute("src", "bot.png");
    expect(screen.getByAltText("moderator")).toHaveStyle({ backgroundColor: "rgb(0, 173, 3)" });
    expect(screen.queryByAltText("FrankerFaceZ: Bot")).toBeNull();
    expect(screen.getByTestId("moderator-chat-highlight")).toBeInTheDocument();
  });

  it("does not rerender for an unrelated cosmetic definition", () => {
    let commitCount = 0;
    render(
      <Profiler id="chat-message" onRender={() => commitCount++}>
        <ChatMessage
          message={baseMessage()}
          currentChannelContext={{ channelId: "channel-1", channelSlug: "ninja" }}
        />
      </Profiler>
    );
    const initialCommitCount = commitCount;

    act(() => {
      useChatCosmeticsStore.getState().applySevenTvEvent("channel-1", {
        type: "badge.upsert",
        badge: {
          id: "7tv:unrelated",
          provider: "7tv",
          providerId: "unrelated",
          title: "Unrelated",
          imageUrl: "unrelated.png",
        },
      });
    });

    expect(commitCount).toBe(initialCommitCount);
  });

  it("keeps the message colon attached to a long username", () => {
    const longUsername = "ExtremelyLongUsernameForTestingTheChatSeparatorWrap";

    render(
      <ChatMessage
        message={baseMessage({
          username: longUsername.toLowerCase(),
          displayName: longUsername,
        })}
      />
    );

    const usernameContainer = screen
      .getByText(longUsername)
      .closest(".chat-line__username-container");
    expect(usernameContainer).not.toBeNull();
    expect(usernameContainer).toHaveTextContent(`${longUsername}:`);
  });

  it("keeps spacing between the username and /me action text", () => {
    render(
      <ChatMessage
        message={baseMessage({
          isAction: true,
          content: [{ type: "text", content: "waves at chat" }],
        })}
      />
    );

    const actionText = screen.getByText("waves at chat");
    expect(actionText.parentElement?.className).toContain("italic");
    expect(actionText.parentElement?.className).toContain("ml-1");
  });

  it("renders mention fragments with a single @ prefix", () => {
    render(
      <ChatMessage
        message={baseMessage({
          content: [
            { type: "text", content: "hey " },
            { type: "mention", username: "alice" },
            { type: "text", content: " " },
            { type: "mention", username: "@bob" },
          ],
        })}
      />
    );

    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.queryByText("@@bob")).not.toBeInTheDocument();
  });

  it("wraps messages that mention the signed-in Twitch viewer in the mention card", () => {
    setTwitchViewer();

    const { container } = render(
      <ChatMessage
        message={baseMessage({
          content: [
            { type: "text", content: "hi " },
            { type: "mention", username: "DarkSkyFullOfStars" },
          ],
        })}
      />
    );

    expect(screen.getByTestId("viewer-mention-highlight")).toBeInTheDocument();
    expect(screen.getByText("Mention")).toBeInTheDocument();
    expect(screen.getByText("@DarkSkyFullOfStars").className).toContain("bg-[#f7f7f8]");
    expect(
      container.querySelector('[data-testid="viewer-mention-highlight"]')?.className
    ).toContain("border-white");
  });

  it("keeps viewer mentions as ordinary rows in guest mode", () => {
    render(
      <ChatMessage
        message={baseMessage({
          content: [
            { type: "text", content: "hi " },
            { type: "mention", username: "DarkSkyFullOfStars" },
          ],
        })}
      />
    );

    expect(screen.queryByTestId("viewer-mention-highlight")).toBeNull();
    expect(screen.queryByText("Mention")).toBeNull();
    expect(screen.getByText("@DarkSkyFullOfStars").className).not.toContain("bg-[#f7f7f8]");
  });

  it("does not wrap mentions for a different username", () => {
    setTwitchViewer("darkskyfullofstars", "DarkSkyFullOfStars");

    render(
      <ChatMessage
        message={baseMessage({
          content: [
            { type: "text", content: "hi " },
            { type: "mention", username: "AnotherViewer" },
          ],
        })}
      />
    );

    expect(screen.queryByTestId("viewer-mention-highlight")).toBeNull();
    expect(screen.getByText("@AnotherViewer").className).not.toContain("bg-[#f7f7f8]");
  });

  it("wraps Twitch moderator-badged messages in the moderator card with the sword icon", () => {
    render(<ChatMessage message={baseMessage({ badges: [badge("moderator")] })} />);

    const card = screen.getByTestId("moderator-chat-highlight");
    expect(screen.getByText("Moderator")).toBeInTheDocument();
    expect(card.className).toContain("border-[#00a865]");
    expect(card.querySelector("path")?.getAttribute("d")).toBe(
      "M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z"
    );
    expect(screen.getByText("Ninja")).toBeInTheDocument();
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
  });

  it("wraps Kick moderator-badged messages in the moderator card with the hammer icon", () => {
    render(
      <ChatMessage message={baseMessage({ platform: "kick", badges: [badge("moderator")] })} />
    );

    const card = screen.getByTestId("moderator-chat-highlight");
    expect(screen.getByText("Moderator")).toBeInTheDocument();
    expect(card.className).toContain("border-[#00a865]");
    expect(card.querySelector("svg")?.getAttribute("class")).toContain("-scale-x-100");
    expect(card.querySelector("path")?.getAttribute("d")).toContain("M15.784 14.309l-8.572-7.804");
    expect(screen.getByText("Ninja")).toBeInTheDocument();
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
  });

  it("renders a Kick broadcaster channel message without moderator presentation", () => {
    render(
      <ChatMessage
        message={baseMessage({
          platform: "kick",
          userId: "kick-chat-sender-id",
          username: "anonsociety",
          displayName: "AnonSociety",
          badges: [badge("broadcaster"), badge("moderator")],
        })}
        currentChannelContext={{ channelId: "self", channelSlug: "anonsociety" }}
      />
    );

    expect(screen.queryByTestId("moderator-chat-highlight")).toBeNull();
    expect(screen.queryByText("Moderator")).toBeNull();
    expect(screen.getByAltText("broadcaster")).toBeInTheDocument();
    expect(screen.queryByAltText("moderator")).toBeNull();
  });

  it("keeps Kick broadcaster channel messages protected when Kick only sends a moderator badge", () => {
    const onBan = vi.fn();
    const onTimeout = vi.fn();
    const onDelete = vi.fn();

    render(
      <ChatMessage
        message={baseMessage({
          platform: "kick",
          userId: "kick-chat-sender-id",
          username: "anonsociety",
          displayName: "AnonSociety",
          badges: [badge("moderator")],
        })}
        currentChannelContext={{ channelId: "self", channelSlug: "anonsociety" }}
        onBan={onBan}
        onTimeout={onTimeout}
        onDelete={onDelete}
      />
    );

    expect(screen.queryByTestId("moderator-chat-highlight")).toBeNull();
    expect(screen.queryByAltText("moderator")).toBeNull();
    expect(screen.queryByRole("button", { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /timeout user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete message/i })).toBeNull();
  });

  it("keeps Kick moderator presentation for the signed-in user when modding another channel", () => {
    render(
      <ChatMessage
        message={baseMessage({
          platform: "kick",
          userId: "self",
          username: "anonsociety",
          displayName: "AnonSociety",
          badges: [badge("moderator")],
        })}
        selfUserId="self"
        currentChannelContext={{ channelId: "other-channel", channelSlug: "otherchannel" }}
      />
    );

    expect(screen.getByTestId("moderator-chat-highlight")).toBeInTheDocument();
    expect(screen.getByText("Moderator")).toBeInTheDocument();
    expect(screen.getByAltText("moderator")).toBeInTheDocument();
  });

  it("renders deleted-message highlights with sender and moderator badges/colors", () => {
    render(
      <ChatMessage
        message={baseMessage({
          badges: [badge("vip")],
          deletedByUser: {
            userId: "mod-1",
            username: "mod",
            displayName: "Mod",
            color: "#5B9BD5",
            badges: [badge("moderator")],
          },
          deletedByUsername: "mod",
          isDeleted: true,
        })}
      />
    );
    expect(screen.getByTestId("deleted-message-highlight")).toBeInTheDocument();
    expect(screen.getByAltText("vip")).toBeInTheDocument();
    expect(screen.getByAltText("moderator")).toBeInTheDocument();
    expect(screen.getByText("Ninja")).toHaveStyle({ color: "#ff0000" });
    expect(screen.getByText("Mod")).toHaveStyle({ color: "#5B9BD5" });
  });

  it("shares the row badge limit across a deleted message sender and moderator", () => {
    render(
      <ChatMessage
        badgeLimit={4}
        message={baseMessage({
          badges: [badge("author-1"), badge("author-2"), badge("author-3")],
          deletedByUser: {
            userId: "mod-1",
            username: "mod",
            displayName: "Mod",
            badges: [badge("moderator-1"), badge("moderator-2"), badge("moderator-3")],
          },
          deletedByUsername: "mod",
          isDeleted: true,
        })}
      />
    );

    expect(
      screen.getAllByAltText(/^(?:author|moderator)-\d$/).map((image) => image.getAttribute("alt"))
    ).toEqual(["author-1", "author-2", "author-3", "moderator-1"]);
  });

  it("renders ban info for ban-type messages", () => {
    render(
      <ChatMessage
        message={
          baseMessage({
            type: "ban",
            banInfo: {
              bannedUsername: "spammer",
              bannedByUsername: "mod",
              bannedUser: {
                userId: "u-spammer",
                username: "spammer",
                displayName: "Spammer",
                color: "#5B9BD5",
                badges: [badge("subscriber")],
              },
              bannedByUser: {
                userId: "mod-1",
                username: "mod",
                displayName: "Mod",
                color: "#70AD47",
                badges: [badge("moderator")],
              },
              duration: 600,
              lastMessage: "lol",
            },
          }) as ChatMessageType
        }
      />
    );
    expect(screen.getAllByAltText("subscriber").length).toBeGreaterThan(0);
    expect(screen.getByAltText("moderator")).toBeInTheDocument();
    expect(screen.getAllByText("Spammer")[0]).toHaveStyle({ color: "#5B9BD5" });
    expect(screen.getByText("Mod")).toHaveStyle({ color: "#70AD47" });
    const actionPhrase = screen.getByText(/was timed out for 10m/);
    expect(actionPhrase).toBeInTheDocument();
    expect(actionPhrase.className).toContain("font-bold");
    expect(actionPhrase.className).toContain("text-white");
  });

  it("renders permanent ban action text bold and white", () => {
    render(
      <ChatMessage
        message={
          baseMessage({
            type: "ban",
            banInfo: {
              bannedUsername: "spammer",
              bannedByUsername: "mod",
            },
          }) as ChatMessageType
        }
      />
    );

    const actionPhrase = screen.getByText(/was permanently banned/);
    expect(actionPhrase.className).toContain("font-bold");
    expect(actionPhrase.className).toContain("text-white");
  });

  it("renders Kick gifted badge before subscriber badge with Kick-style spacing", () => {
    render(
      <ChatMessage
        message={baseMessage({
          platform: "kick",
          badges: [
            {
              setId: "subscriber",
              version: "17",
              imageUrl: "https://example.com/sub.png",
              title: "17-Month Subscriber",
            },
            {
              setId: "sub_gifter",
              version: "63",
              imageUrl: "https://example.com/gift.png",
              title: "Gifted 63 subs",
            },
          ],
        })}
      />
    );

    const badgeImages = screen.getAllByRole("img");
    expect(badgeImages.map((img) => img.getAttribute("alt"))).toEqual([
      "Gifted 63 subs",
      "17-Month Subscriber",
    ]);
    expect(badgeImages[0].parentElement?.className).toContain("gap-1");
  });

  it("renders the Twitch-style click-to-reply button and fires with the message", async () => {
    const onReply = vi.fn();
    const msg = baseMessage();
    render(<ChatMessage message={msg} onReply={onReply} />);

    const button = screen.getByRole("button", { name: "Click to reply" });
    expect(button.className).toContain("h-8");
    expect(button.className).toContain("w-8");
    expect(button.className).toContain("rounded-[9000px]");
    expect(button.className).not.toContain("min-h-8");
    expect(button.className).not.toContain("min-w-8");
    expect(button.className).toContain("cursor-pointer");
    expect(button.className).toContain("bg-[#18181b]");
    expect(button.className).toContain("hover:bg-[#34343c]");
    expect(button.className).toContain("active:bg-[#393940]");
    expect(button.className).toContain("text-white");
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("h-5 w-5");
    expect(button.querySelector("path")?.getAttribute("d")).toBe(
      "M7.828 12.207 11.621 16l-1.414 1.414L4 11.207 10.207 5l1.414 1.414-3.793 3.793h5.586a7 7 0 0 1 7 7v2h-2v-2a5 5 0 0 0-5-5H7.828Z"
    );
    fireEvent.focus(button);
    expect(await screen.findAllByText("Click to reply")).not.toHaveLength(0);
    const tooltip = document.querySelector('[data-side="top"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.className).toContain("text-sm");
    expect(tooltip?.className).toContain("font-semibold");
    expect(tooltip?.className).toContain("leading-[1.4]");
    expect(tooltip?.className).toContain("!rounded-[4px]");
    expect(tooltip?.getAttribute("data-align")).toBe("end");
    expect(tooltip?.className).toContain("text-left");
    expect(tooltip?.className).toContain("!bg-white");
    expect(tooltip?.className).toContain("!text-[#0e0e10]");
    expect(tooltip?.querySelector("svg")?.className.baseVal).toContain("!fill-white");

    fireEvent.click(button);
    expect(onReply).toHaveBeenCalledWith(msg);
  });

  it("positions reply and pin hover actions half off the row with Twitch spacing", () => {
    render(<ChatMessage message={baseMessage()} onReply={vi.fn()} onPin={vi.fn()} />);

    const replyButton = screen.getByRole("button", { name: "Click to reply" });
    const pinButton = screen.getByRole("button", { name: /pin this message/i });
    const actionCluster = screen.getByTestId("chat-message-hover-actions");

    expect(actionCluster.className).toContain("absolute");
    expect(actionCluster.className).toContain("top-[-15px]");
    expect(actionCluster.className).toContain("right-1.5");
    expect(actionCluster.className).toContain("z-10");
    expect(actionCluster.className).toContain("h-8");
    expect(actionCluster.className).toContain("pl-[5px]");
    expect(actionCluster.className).toContain("gap-[5px]");
    expect(actionCluster.className).toContain("group-hover:!opacity-100");
    expect(actionCluster.className).toContain("focus-within:!opacity-100");
    expect(actionCluster.className).not.toContain("top-1/2");
    expect(actionCluster.className).not.toContain("-translate-y-1/2");
    expect([...actionCluster.querySelectorAll("button")]).toEqual([pinButton, replyButton]);
    expect(replyButton.className).not.toContain("top-1/2");
    expect(replyButton.className).not.toContain("-translate-y-1/2");
    expect(replyButton.className).toContain("h-8");
    expect(replyButton.className).toContain("w-8");
    expect(replyButton.className).toContain("rounded-[9000px]");
    expect(replyButton.className).toContain(
      "shadow-[0_1px_2px_0_rgba(0,0,0,0.9),0_0_2px_0_rgba(0,0,0,0.9)]"
    );
    expect(pinButton.className).not.toContain("top-1/2");
    expect(pinButton.className).not.toContain("-translate-y-1/2");
    expect(pinButton.className).toContain("h-8");
    expect(pinButton.className).toContain("w-8");
    expect(pinButton.className).toContain("rounded-[9000px]");
    expect(pinButton.className).toContain(
      "shadow-[0_1px_2px_0_rgba(0,0,0,0.9),0_0_2px_0_rgba(0,0,0,0.9)]"
    );
  });

  it("renders Twitch reply metadata above the message content", () => {
    render(
      <ChatMessage
        message={baseMessage({
          replyTo: {
            parentMessageId: "parent-1",
            parentUserId: "bot-1",
            parentUsername: "fossabot",
            parentDisplayName: "Fossabot",
            parentMessageBody: "@TENHQ, Please stop repeating yourself. [warning]",
          },
        })}
      />
    );

    const preview = screen.getByTestId("chat-message-reply-preview");
    expect(preview).toHaveTextContent(
      "Replying to @Fossabot: @TENHQ, Please stop repeating yourself. [warning]"
    );
    expect(preview.querySelectorAll("path")[1]?.getAttribute("d")).toBe(
      "m12 22-3-3H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4l-3 3Zm-2.172-5L12 19.172 14.172 17H19V5H5v12h4.828Z"
    );
  });

  it("renders reply metadata without crashing when the parent message body is not a string", () => {
    render(
      <ChatMessage
        message={baseMessage({
          replyTo: {
            parentMessageId: "parent-1",
            parentUserId: "bot-1",
            parentUsername: "fossabot",
            parentDisplayName: "Fossabot",
            parentMessageBody: { text: "unexpected payload" } as unknown as string,
          },
        })}
      />
    );

    expect(screen.getByTestId("chat-message-reply-preview")).toHaveTextContent(
      "Replying to @Fossabot"
    );
  });

  it("renders an unknown reply author when the parent display fields are not strings", () => {
    render(
      <ChatMessage
        message={baseMessage({
          replyTo: {
            parentMessageId: "parent-1",
            parentUserId: "bot-1",
            parentUsername: { login: "unexpected" } as unknown as string,
            parentDisplayName: ["unexpected"] as unknown as string,
            parentMessageBody: "valid body",
          },
        })}
      />
    );

    expect(screen.getByTestId("chat-message-reply-preview")).toHaveTextContent(
      "Replying to @unknown: valid body"
    );
  });
});

describe("ChatMessage chatDisplay appearance (U2)", () => {
  // Guards: every persisted Xtra timestamp format renders deterministically in local time,
  // including padding, seconds, and uppercase AM/PM, while invalid dates stay harmless.
  const FIXED_TS = new Date(2026, 4, 24, 9, 5, 7).getTime();

  it("hides the timestamp when timestamps is false (default)", () => {
    render(<ChatMessage message={baseMessage({ timestamp: FIXED_TS as unknown as Date })} />);
    expect(screen.queryByText(/9:05|09:05/)).toBeNull();
  });

  it.each<[TimestampFormat, string]>([
    ["H:mm", "9:05"],
    ["HH:mm", "09:05"],
    ["H:mm:ss", "9:05:07"],
    ["HH:mm:ss", "09:05:07"],
    ["h:mm a", "9:05 AM"],
    ["hh:mm a", "09:05 AM"],
    ["h:mm:ss a", "9:05:07 AM"],
    ["hh:mm:ss a", "09:05:07 AM"],
  ])("renders %s as %s", (timestampFormat, expected) => {
    setChatDisplay({ timestamps: true, timestampFormat });
    render(<ChatMessage message={baseMessage({ timestamp: FIXED_TS as unknown as Date })} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("does not crash or show an invalid timestamp for an invalid date", () => {
    setChatDisplay({ timestamps: true, timestampFormat: "HH:mm:ss" });
    const { container } = render(
      <ChatMessage message={baseMessage({ timestamp: new Date("invalid") })} />
    );
    expect(container).not.toHaveTextContent("Invalid Date");
  });

  it("applies fontSizePx to the message row as an inline style", () => {
    setChatDisplay({ fontSizePx: 18 });
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector(".group") as HTMLElement;
    expect(row.style.fontSize).toBe("18px");
  });

  it("uses Twitch cozy padding/line-height by default", () => {
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector(".group") as HTMLElement;
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.density).toBe("cozy");
    expect(row.className).toContain("px-4");
    expect(row.className).toContain("py-1");
    expect(row.className).toContain("leading-[22px]");
    expect(row.className).not.toContain("hover:bg-[rgba(255,255,255,0.16)]");
  });

  it("does not apply the message row hover background while hovering the username", () => {
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector(".group") as HTMLElement;
    const username = screen.getByText("Ninja");
    const messageText = screen.getByText("hello world");

    fireEvent.mouseEnter(row, { target: row });
    fireEvent.mouseMove(username);
    expect(row.className).not.toContain("bg-[rgba(255,255,255,0.16)]");

    fireEvent.mouseMove(messageText);
    expect(row.className).toContain("bg-[rgba(255,255,255,0.16)]");

    fireEvent.mouseLeave(row);
    expect(row.className).not.toContain("bg-[rgba(255,255,255,0.16)]");
  });

  it("smooths message-row hover highlighting by default", () => {
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector(".group") as HTMLElement;

    fireEvent.mouseEnter(row, { target: row });

    expect(row.className).toContain("bg-[rgba(255,255,255,0.16)]");
    expect(row.className).toContain("transition-colors");
    expect(row.className).toContain("duration-150");
  });

  it("keeps message-row hover highlighting immediate when hover smoothing is disabled", () => {
    setChatDisplay({ hoverSmooth: false });
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector(".group") as HTMLElement;

    fireEvent.mouseEnter(row, { target: row });

    expect(row.className).toContain("bg-[rgba(255,255,255,0.16)]");
    expect(row.className).not.toContain("transition-colors");
    expect(row.className).not.toContain("duration-150");
  });

  it("only smooths message-row hover highlighting when reduced motion is safe", () => {
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector(".group") as HTMLElement;
    const classes = row.className.split(" ");

    expect(classes).toContain("motion-safe:transition-colors");
    expect(classes).toContain("motion-safe:duration-150");
    expect(classes).not.toContain("transition-colors");
    expect(classes).not.toContain("duration-150");
  });

  it("uses tighter padding/line-height when density is compact", () => {
    setChatDisplay({ density: "compact" });
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector(".group") as HTMLElement;
    expect(row.className).toContain("py-0");
    expect(row.className).toContain("leading-[1.2]");
    expect(row.className).not.toContain("leading-[22px]");
  });

  it("adds loose vertical row padding when density is loose", () => {
    setChatDisplay({ density: "loose" });
    const { container } = render(<ChatMessage message={baseMessage()} />);
    const row = container.querySelector(".group") as HTMLElement;
    expect(row.className).toContain("py-3");
    expect(row.className).toContain("leading-[22px]");
    expect(row.className).not.toContain("py-1");
  });

  it("uses Twitch cozy row padding around an emote-heavy Kick message", () => {
    const { container } = render(
      <ChatMessage
        message={baseMessage({
          platform: "kick",
          username: "COME_AT_ME_BRAHHH",
          displayName: "COME_AT_ME_BRAHHH",
          content: [
            {
              type: "emote",
              id: "kick-mia",
              name: "KICKMIA",
              url: "https://example.com/kickmia.png",
            },
            { type: "text", content: " KICK MIA" },
          ],
        })}
      />
    );

    const row = container.querySelector(".group") as HTMLElement;
    expect(row.className).toContain("py-1");
    expect(row.className).toContain("leading-[22px]");
    expect(screen.getByAltText("KICKMIA")).toBeInTheDocument();
    expect(screen.getByText("KICK MIA")).toBeInTheDocument();
  });

  it("applies emoteSizePx to rendered emote images", () => {
    setChatDisplay({ emoteSizePx: 40 });
    const msg = baseMessage({
      content: [{ type: "emote", id: "e1", name: "Kappa", url: "https://example.com/kappa.png" }],
    });
    render(<ChatMessage message={msg} />);
    const img = screen.getByAltText("Kappa") as HTMLImageElement;
    expect(img.style.height).toBe("40px");
    expect(img.style.width).toBe("40px");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("fetchpriority")).toBe("low");
    expect(img.className).not.toContain("transition-transform");
    expect(img.className).not.toContain("hover:scale");
  });

  it("renders chat badges with reserved dimensions and async decode to avoid row remeasurement flicker", () => {
    render(
      <ChatMessage
        message={baseMessage({
          badges: [
            {
              setId: "moderator",
              version: "1",
              imageUrl: "https://example.com/mod.png",
              title: "Badge",
            },
          ],
        })}
      />
    );

    const img = screen.getByAltText("Badge") as HTMLImageElement;
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("fetchpriority")).toBe("auto");
    expect(img.className).toContain("w-4");
    expect(img.className).toContain("h-4");
  });

  it("preserves truncation-safe wrapping at min font size with a long username + message", () => {
    // Regression guard for the truncation-trio learning: a very long username +
    // message at the smallest font must not strip the break-words wrapper.
    setChatDisplay({ fontSizePx: 10 });
    const longName = "a".repeat(40);
    const longText = "lorem ipsum ".repeat(20).trim();
    const { container } = render(
      <ChatMessage
        message={baseMessage({
          username: longName,
          displayName: longName,
          content: [{ type: "text", content: longText }],
        })}
      />
    );
    // The content wrapper keeps break-words so long tokens wrap instead of overflow.
    expect(container.querySelector(".break-words")).not.toBeNull();
    expect(screen.getByText(longName)).toBeInTheDocument();
  });

  it("clamps hostile message content so it cannot create horizontal chat scroll", () => {
    const longToken = "x".repeat(180);
    const { container } = render(
      <ChatMessage
        message={baseMessage({
          content: [
            { type: "text", content: longToken },
            {
              type: "emote",
              id: "wide",
              name: "WideEmote",
              url: "https://example.com/wide.png",
            },
            {
              type: "link",
              text: `https://example.com/${longToken}`,
              url: `https://example.com/${longToken}`,
            },
          ],
        })}
      />
    );

    const row = container.querySelector(".group") as HTMLElement;
    expect(row.className).toContain("overflow-x-clip");
    expect(row.className).not.toContain("overflow-x-hidden");

    const content = row.querySelector('[data-testid="chat-message-content"]') as HTMLElement;
    expect(content.className).toContain("max-w-full");
    expect(content.className).toContain("[overflow-wrap:anywhere]");

    const emote = screen.getByAltText("WideEmote") as HTMLImageElement;
    expect(emote.style.maxWidth).toBe("100%");
  });
});

describe("ChatMessage event/notice visibility (U5)", () => {
  function banMessage(): ChatMessageType {
    return baseMessage({
      type: "ban",
      banInfo: {
        bannedUsername: "spammer",
        bannedByUsername: "mod",
        duration: 600,
        lastMessage: "lol",
      },
    }) as ChatMessageType;
  }

  it("renders the ban/timeout notice by default (showClearChat true)", () => {
    render(<ChatMessage message={banMessage()} />);
    expect(screen.getByTestId("moderation-action-highlight")).toBeInTheDocument();
    expect(screen.getAllByText("spammer").length).toBeGreaterThan(0);
  });

  it("renders ban/timeout highlights with the framed Cozy style when selected", () => {
    setChatDisplay({ moderationHighlightStyle: "cozy" });
    render(<ChatMessage message={banMessage()} />);

    const highlight = screen.getByTestId("moderation-action-highlight");
    expect(highlight.className).toContain("rounded-[6px]");
    expect(highlight.className).toContain("border-[#f87171]");
    expect(highlight).not.toHaveAccessibleName("Twitch Timeout notice");
  });

  it("keeps timeout and ban summary usernames on one line", () => {
    render(
      <ChatMessage
        message={baseMessage({
          type: "ban",
          banInfo: {
            bannedUsername: "juice94",
            bannedByUsername: "ModBot",
            bannedUser: {
              userId: "u-juice94",
              username: "juice94",
              displayName: "juice94",
              color: "#1ba6ff",
              badges: [],
            },
            bannedByUser: {
              userId: "u-modbot",
              username: "ModBot",
              displayName: "ModBot",
              color: "#ffb454",
              badges: [],
            },
            duration: 3600,
          },
        })}
      />
    );

    const highlightedNames = screen
      .getByTestId("moderation-action-highlight")
      .querySelectorAll(".chat-line__username-container");
    expect(highlightedNames).toHaveLength(2);
    highlightedNames.forEach((name) => {
      expect(name.className).toContain("whitespace-nowrap");
    });
  });

  it("bottom-aligns deleted-message text inside Cozy timeout/ban highlights", () => {
    setChatDisplay({ moderationHighlightStyle: "cozy" });
    render(
      <ChatMessage
        message={baseMessage({
          type: "ban",
          banInfo: {
            bannedUsername: "spammer",
            bannedByUsername: "mod",
            bannedUser: {
              userId: "u-spammer",
              username: "spammer",
              displayName: "Spammer",
              color: "#5B9BD5",
              badges: [badge("subscriber")],
            },
            duration: 600,
            deletedMessageDetails: [
              {
                id: "cozy-deleted-1",
                author: {
                  userId: "u-spammer",
                  username: "spammer",
                  displayName: "Spammer",
                  color: "#5B9BD5",
                  badges: [badge("subscriber")],
                },
                content: [{ type: "text", content: "cozy deleted message" }],
                rawContent: "cozy deleted message",
                deletedAt: new Date("2026-06-29T17:45:00"),
              },
            ],
          },
        })}
      />
    );

    const deletedMessages = screen.getByTestId("moderation-deleted-messages");
    const firstRow = deletedMessages.querySelector("li");
    expect(deletedMessages.className).toContain("[&_li>span:first-child]:items-end");
    expect(firstRow?.children[0]?.className).toContain("items-end");
    expect(firstRow?.className).toContain("text-base");
    expect(firstRow?.className).toContain("leading-[22px]");
    expect(firstRow?.querySelector(".chat-line__username-container")?.className).toContain(
      "whitespace-nowrap"
    );
    expect(firstRow?.querySelector(".chat-line__username-container")).toHaveTextContent("Spammer:");
    expect(firstRow?.children[1]?.className).toContain("align-bottom");
    expect(firstRow?.children[1]?.className).toContain("ml-1");
    expect(deletedMessages).toHaveTextContent("cozy deleted message");
  });

  it("renders every retained timeout/ban-deleted message in the moderation highlight", () => {
    const deletedAt = new Date("2026-06-29T17:45:00");
    render(
      <ChatMessage
        message={baseMessage({
          timestamp: deletedAt,
          type: "ban",
          banInfo: {
            bannedUsername: "spammer",
            bannedByUsername: "mod",
            bannedUser: {
              userId: "u-spammer",
              username: "spammer",
              displayName: "Spammer",
              color: "#5B9BD5",
              badges: [badge("subscriber")],
            },
            duration: 600,
            lastMessage: "second deleted message with a lot of detail",
            deletedMessages: [
              "first deleted message with full wording",
              "second deleted message with a lot of detail",
            ],
            deletedMessageDetails: [
              {
                id: "deleted-1",
                author: {
                  userId: "u-spammer",
                  username: "spammer",
                  displayName: "Spammer",
                  color: "#5B9BD5",
                  badges: [badge("subscriber")],
                },
                content: [
                  { type: "text", content: "first deleted message with full wording " },
                  {
                    type: "emote",
                    id: "25",
                    name: "Kappa",
                    url: "https://example.com/kappa.png",
                    isAnimated: false,
                  },
                ],
                rawContent: "first deleted message with full wording Kappa",
                deletedAt,
              },
              {
                id: "deleted-2",
                author: {
                  userId: "u-spammer",
                  username: "spammer",
                  displayName: "Spammer",
                  color: "#5B9BD5",
                  badges: [badge("subscriber")],
                },
                content: [{ type: "text", content: "second deleted message with a lot of detail" }],
                rawContent: "second deleted message with a lot of detail",
                deletedAt,
              },
            ],
          },
        })}
      />
    );

    const deletedMessages = screen.getByTestId("moderation-deleted-messages");
    expect(deletedMessages).toHaveTextContent("first deleted message with full wording");
    expect(deletedMessages).toHaveTextContent("second deleted message with a lot of detail");
    expect(deletedMessages.textContent?.match(/Spammer/g)).toHaveLength(2);
    expect(screen.getByAltText("Kappa")).toBeInTheDocument();
    expect(screen.getAllByAltText("subscriber")).toHaveLength(3);
    const firstRow = deletedMessages.querySelector("li");
    expect(firstRow?.className).toContain("text-white");
    expect(firstRow?.className).toContain("text-base");
    expect(firstRow?.className).toContain("leading-[22px]");
    expect(firstRow?.className).toContain("align-bottom");
    expect(firstRow?.children[0]?.className).toContain("items-end");
    expect(firstRow?.querySelector(".chat-line__username-container")?.className).toContain(
      "whitespace-nowrap"
    );
    expect(firstRow?.querySelector(".chat-line__username-container")).toHaveTextContent("Spammer:");
    expect(firstRow?.children[1]?.className).toContain("align-bottom");
    expect(firstRow?.children[1]?.className).toContain("ml-1");
    expect(deletedMessages.querySelector(".truncate")).toBeNull();
    expect(screen.queryByText(/last:/i)).toBeNull();
    expect(screen.getByText(/5:45 PM|17:45/)).toBeInTheDocument();
  });

  it("uses a full action date and time in audit timeout/ban highlights", () => {
    setChatDisplay({ deletedMessageDisplay: "audit" });
    render(
      <ChatMessage
        message={baseMessage({
          timestamp: new Date("2026-06-29T17:45:00"),
          type: "ban",
          banInfo: {
            bannedUsername: "spammer",
            bannedByUsername: "mod",
            duration: 600,
            lastMessage: "audit deleted message",
          },
        })}
      />
    );

    const highlight = screen.getByTestId("moderation-action-highlight");
    expect(highlight).toHaveTextContent("2026");
    expect(highlight).toHaveTextContent(/5:45 PM|17:45/);
  });

  it("hides the ban/timeout notice when showClearChat is false", () => {
    setChatDisplay({ showClearChat: false });
    const { container } = render(<ChatMessage message={banMessage()} />);
    expect(screen.queryByText("spammer")).toBeNull();
    // The whole row is suppressed, not just the text.
    expect(container.firstChild).toBeNull();
  });

  it("keeps ban notices visible but hides the retained last message when deleted messages are off", () => {
    setChatDisplay({ showClearMsg: false });
    render(<ChatMessage message={banMessage()} />);

    expect(screen.getByText("spammer")).toBeInTheDocument();
    expect(screen.queryByText(/last:/i)).toBeNull();
  });

  it("renders retained deleted-message content with compact moderation details by default", () => {
    render(
      <ChatMessage
        message={baseMessage({
          isDeleted: true,
          deletedAt: new Date("2026-06-29T17:45:00"),
          deletedByUsername: "ModBot",
          content: [
            { type: "text", content: "too spicy " },
            {
              type: "emote",
              id: "25",
              name: "Kappa",
              url: "https://example.com/kappa.png",
              isAnimated: false,
            },
            { type: "text", content: " 🙂" },
          ],
          rawContent: "too spicy Kappa 🙂",
        })}
      />
    );

    expect(screen.getByTestId("deleted-message-highlight")).toBeInTheDocument();
    expect(screen.getByText("Deleted message")).toBeInTheDocument();
    expect(screen.getByText("Ninja")).toBeInTheDocument();
    const deletedText = screen.getByText(/too spicy/i);
    expect(deletedText).toBeInTheDocument();
    expect(deletedText.parentElement?.className).toContain("align-bottom");
    expect(deletedText.parentElement?.className).toContain("ml-1");
    expect(
      screen.getByText("Ninja").closest(".chat-line__username-container")?.parentElement?.className
    ).toContain("items-end");
    expect(
      screen.getByText("Ninja").closest(".chat-line__username-container")?.className
    ).toContain("whitespace-nowrap");
    expect(screen.getByText("Ninja").closest(".chat-line__username-container")).toHaveTextContent(
      "Ninja:"
    );
    expect(screen.getByAltText("Kappa")).toBeInTheDocument();
    expect(screen.getByText(/deleted by/i)).toBeInTheDocument();
    expect(screen.getByText("ModBot")).toBeInTheDocument();
    const deletedAt = screen.getByText(/5:45 PM|17:45/);
    expect(deletedAt).toBeInTheDocument();
    expect(deletedAt.className).toContain("align-bottom");
    expect(deletedAt.parentElement?.className).toContain("align-bottom");
  });

  it("keeps deleted-message highlight attribution usernames on one line", () => {
    render(
      <ChatMessage
        message={baseMessage({
          isDeleted: true,
          deletedAt: new Date("2026-06-29T17:45:00"),
          deletedByUser: {
            userId: "u-modbot",
            username: "ModBot",
            displayName: "ModBot",
            color: "#ffb454",
            badges: [],
          },
        })}
      />
    );

    const highlightedNames = screen
      .getByTestId("deleted-message-highlight")
      .querySelectorAll(".chat-line__username-container");
    expect(highlightedNames).toHaveLength(2);
    highlightedNames.forEach((name) => {
      expect(name.className).toContain("whitespace-nowrap");
    });
  });

  it("renders deleted-message highlights with the framed Cozy style when selected", () => {
    setChatDisplay({ moderationHighlightStyle: "cozy" });
    render(<ChatMessage message={baseMessage({ isDeleted: true })} />);

    const highlight = screen.getByTestId("deleted-message-highlight");
    expect(highlight.className).toContain("rounded-[6px]");
    expect(highlight.className).toContain("border-[#ff6b6b]");
    expect(highlight).not.toHaveAccessibleName("Twitch Deleted message notice");
    const deletedText = screen.getByText("hello world");
    expect(deletedText).toBeInTheDocument();
    expect(deletedText.parentElement?.className).toContain("align-bottom");
    expect(deletedText.parentElement?.className).toContain("ml-1");
    expect(
      screen.getByText("Ninja").closest(".chat-line__username-container")?.parentElement?.className
    ).toContain("items-end");
    expect(
      screen.getByText("Ninja").closest(".chat-line__username-container")?.className
    ).toContain("whitespace-nowrap");
    expect(screen.getByText("Ninja").closest(".chat-line__username-container")).toHaveTextContent(
      "Ninja:"
    );
    expect(screen.getByText(/Deleted by/i).className).toContain("align-bottom");
  });

  it("renders deleted-message rows according to tombstone, message-only, and audit modes", () => {
    setChatDisplay({ deletedMessageDisplay: "tombstone" });
    const { rerender } = render(<ChatMessage message={baseMessage({ isDeleted: true })} />);
    expect(screen.getByText(/message deleted/i)).toBeInTheDocument();
    expect(screen.queryByTestId("deleted-message-highlight")).toBeNull();

    act(() => setChatDisplay({ deletedMessageDisplay: "message" }));
    rerender(<ChatMessage message={baseMessage({ isDeleted: true })} />);
    expect(screen.getByTestId("deleted-message-highlight")).toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.queryByText("Ninja")).toBeNull();

    act(() => setChatDisplay({ deletedMessageDisplay: "audit" }));
    rerender(<ChatMessage message={baseMessage({ isDeleted: true })} />);
    expect(screen.getByText(/Twitch - id m1/)).toBeInTheDocument();
  });

  it("falls back to the plain tombstone when deleted content is no longer retained", () => {
    render(
      <ChatMessage
        message={baseMessage({
          isDeleted: true,
          content: [],
          rawContent: "",
        })}
      />
    );

    expect(screen.getByText(/message deleted/i)).toBeInTheDocument();
    expect(screen.queryByTestId("deleted-message-highlight")).toBeNull();
  });

  it("hides the deletion tombstone when showClearMsg is false", () => {
    setChatDisplay({ showClearMsg: false });
    const { container } = render(<ChatMessage message={baseMessage({ isDeleted: true })} />);
    expect(screen.queryByText(/message deleted/i)).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("wraps first-time chat messages in the white-bordered highlight card by default", () => {
    const { container } = render(<ChatMessage message={baseMessage({ isHighlighted: true })} />);
    const card = screen.getByTestId("first-time-chat-highlight");
    const row = container.querySelector(".group") as HTMLElement;

    expect(screen.getByText("First Time Chat")).toBeInTheDocument();
    expect(card.className).toContain("border-white");
    expect(row.className).not.toContain("border-purple-500");
  });

  it("keeps first-time chat precedence over moderator badge cards", () => {
    render(
      <ChatMessage message={baseMessage({ badges: [badge("moderator")], isHighlighted: true })} />
    );

    expect(screen.getByTestId("first-time-chat-highlight")).toBeInTheDocument();
    expect(screen.queryByTestId("moderator-chat-highlight")).toBeNull();
  });

  it("wraps paid highlighted messages in the highlighted-message banner", () => {
    render(
      <ChatMessage
        message={baseMessage({
          isHighlighted: true,
          highlightKind: "highlighted-message",
          content: [{ type: "text", content: "read this one" }],
        })}
      />
    );

    const card = screen.getByTestId("highlighted-message-highlight");
    expect(card).toHaveAccessibleName("Twitch Highlighted Message notice");
    expect(card.style.borderLeft).toMatch(/^3px solid/);
    expect(screen.queryByTestId("first-time-chat-highlight")).toBeNull();
    expect(screen.getByText("read this one")).toBeInTheDocument();
  });

  it.each([
    [
      "subscription",
      "subscription-highlight",
      "Twitch Subscription notice",
      "ImJustAGhostt subscribed with Prime.",
    ],
    ["resub", "resub-highlight", "Twitch Resub notice", "They have subscribed for 38 months!"],
    [
      "gifted-sub",
      "gifted-sub-highlight",
      "Twitch Gifted Sub notice",
      "Anon gifted 5 subscriptions!",
    ],
    ["bits", "bits-highlight", "Twitch Bits notice", "Bits badge unlocked!"],
  ] as const)("wraps %s system events in their own banner without a System username", (highlightKind, testId, ariaLabel, text) => {
    const { container } = render(
      <ChatMessage
        message={baseMessage({
          type: "system",
          platform: "twitch",
          username: "System",
          displayName: "System",
          isHighlighted: true,
          highlightKind,
          content: [{ type: "text", content: text }],
        })}
      />
    );

    const card = screen.getByTestId(testId);
    expect(card).toBeInTheDocument();
    expect(card).toHaveAccessibleName(ariaLabel);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText("Subscription")).toBeNull();
    expect(screen.queryByText("Twitch")).toBeNull();
    expect(screen.queryByText("System")).toBeNull();
    expect(container.querySelector(".group")).toBeNull();
    expect(card.style.borderLeft).toMatch(/^3px solid/);
  });

  it("renders subscription event usernames with their color and profile affordance", () => {
    render(
      <ChatMessage
        currentChannelContext={{ channelId: "channel-1", channelSlug: "streamer" }}
        message={baseMessage({
          type: "system",
          platform: "twitch",
          userId: "subber-id",
          username: "ssquirrrellll",
          displayName: "Ssquirrrellll",
          color: "#c084fc",
          isHighlighted: true,
          highlightKind: "subscription",
          content: [{ type: "text", content: "Ssquirrrellll subscribed at Tier 1" }],
          rawContent: "Ssquirrrellll subscribed at Tier 1",
        })}
      />
    );

    expect(screen.getByTestId("subscription-highlight")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ssquirrrellll" })).toBeInTheDocument();
    expect(screen.getByText("Ssquirrrellll")).toHaveStyle({ color: "rgb(192, 132, 252)" });
    expect(screen.getByText("Ssquirrrellll").closest(".flex-col")?.className).toContain(
      "items-start"
    );
    expect(screen.getByTestId("subscription-highlight").style.borderLeft).toMatch(/^3px solid/);
    expect(screen.getByText("Subscribed at Tier 1")).toBeInTheDocument();
  });

  it("wraps Twitch bits chat messages as cheer highlights", () => {
    render(
      <ChatMessage
        message={baseMessage({
          type: "bits",
          bits: 100,
          highlightKind: "cheer",
          content: [{ type: "text", content: "cheer100 lets go" }],
        })}
      />
    );

    expect(screen.getByTestId("cheer-highlight")).toHaveAccessibleName("Twitch Cheer notice");
    expect(screen.getByText("Ninja")).toBeInTheDocument();
    expect(screen.getByText("cheer100 lets go")).toBeInTheDocument();
  });

  it("removes the highlight on a chat message when firstMsgHighlight is false", () => {
    setChatDisplay({ firstMsgHighlight: false });
    const { container } = render(<ChatMessage message={baseMessage({ isHighlighted: true })} />);
    const row = container.querySelector(".group") as HTMLElement;
    expect(screen.queryByTestId("first-time-chat-highlight")).toBeNull();
    expect(row.className).not.toContain("border-purple-500");
  });

  it("keeps the highlight on system lines even when firstMsgHighlight is false", () => {
    // System / connection / notice lines set isHighlighted for their own
    // styling; the viewer toggle only governs real chat messages.
    setChatDisplay({ firstMsgHighlight: false });
    const { container } = render(
      <ChatMessage
        message={baseMessage({
          type: "system",
          isHighlighted: true,
          content: [{ type: "text", content: "Connected to the channel" }],
        })}
      />
    );
    const row = container.querySelector(".group") as HTMLElement;
    expect(row.className).toContain("border-purple-500");
  });

  it("renders emotes in a system message as text when systemMessageEmotes is false", () => {
    setChatDisplay({ systemMessageEmotes: false });
    render(
      <ChatMessage
        message={baseMessage({
          type: "system",
          content: [
            { type: "text", content: "new sub! " },
            { type: "emote", id: "e1", name: "PogChamp", url: "https://example.com/pog.png" },
          ],
        })}
      />
    );
    // The emote name shows as text; no <img> is rendered for it.
    expect(screen.getByText("PogChamp")).toBeInTheDocument();
    expect(screen.queryByAltText("PogChamp")).toBeNull();
  });

  it("renders emotes in a system message as images when systemMessageEmotes is true (default)", () => {
    render(
      <ChatMessage
        message={baseMessage({
          type: "system",
          content: [
            { type: "emote", id: "e1", name: "PogChamp", url: "https://example.com/pog.png" },
          ],
        })}
      />
    );
    expect(screen.getByAltText("PogChamp")).toBeInTheDocument();
  });

  it("renders emotes normally in a regular chat message regardless of systemMessageEmotes", () => {
    setChatDisplay({ systemMessageEmotes: false });
    render(
      <ChatMessage
        message={baseMessage({
          content: [
            { type: "emote", id: "e1", name: "Kappa", url: "https://example.com/kappa.png" },
          ],
        })}
      />
    );
    expect(screen.getByAltText("Kappa")).toBeInTheDocument();
  });
});

describe("ChatMessage mod toolbar (U10)", () => {
  const allCallbacks = () => ({
    onTimeout: vi.fn(),
    onWarn: vi.fn(),
    onBan: vi.fn(),
    onUnban: vi.fn(),
    onDelete: vi.fn(),
    onPin: vi.fn(),
  });

  it("renders all inline mod toolbar buttons when all callbacks are passed", () => {
    const cbs = allCallbacks();
    render(<ChatMessage message={baseMessage()} {...cbs} />);
    expect(screen.getByRole("button", { name: /timeout user/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /warn user/i })).toBeInTheDocument();
    const banButton = screen.getByRole("button", { name: /^ban user$/i });
    expect(banButton).toBeInTheDocument();
    expect(banButton.className).toContain("cursor-pointer");
    expect(banButton.className).toContain("hover:bg-[rgba(83,83,95,0.48)]");
    expect(banButton.className).toContain("active:bg-[rgba(83,83,95,0.55)]");
    expect(screen.getByRole("button", { name: /unban user/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete message/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pin this message/i })).toBeInTheDocument();
  });

  it("uses Twitch-style white tooltips for inline mod buttons", async () => {
    const cbs = allCallbacks();
    render(<ChatMessage message={baseMessage()} {...cbs} />);

    fireEvent.focus(screen.getByRole("button", { name: /^ban user$/i }));

    expect(await screen.findAllByText("Ban user")).not.toHaveLength(0);
    const tooltip = document.querySelector('[data-side="top"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.className).toContain("!bg-white");
    expect(tooltip?.className).toContain("!text-[#0e0e10]");
    expect(tooltip?.className).toContain("font-semibold");
    expect(tooltip?.className).toContain("leading-[1.4]");
    expect(tooltip?.className).toContain("!rounded-[4px]");
    expect(tooltip?.querySelector("svg")?.className.baseVal).toContain("!fill-white");
  });

  it("renders badges to the right of inline mod toolbar buttons", () => {
    const cbs = allCallbacks();
    render(<ChatMessage message={baseMessage({ badges: [badge("vip")] })} {...cbs} />);

    const banButton = screen.getByRole("button", { name: /^ban user$/i });
    const badgeImage = screen.getByAltText("vip");

    expect(banButton.compareDocumentPosition(badgeImage)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders only the Pin button when only onPin is passed", () => {
    render(<ChatMessage message={baseMessage()} onPin={vi.fn()} />);
    expect(screen.getByRole("button", { name: /pin this message/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /timeout user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /warn user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /unban user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete message/i })).toBeNull();
  });

  it("renders no toolbar buttons when no callbacks are passed", () => {
    render(<ChatMessage message={baseMessage()} />);
    expect(screen.queryByRole("button", { name: /pin this message/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /timeout user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /warn user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /unban user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete message/i })).toBeNull();
  });

  it("hides toolbar entirely when sender has broadcaster badge (AE1)", () => {
    const cbs = allCallbacks();
    render(<ChatMessage message={baseMessage({ badges: [badge("broadcaster")] })} {...cbs} />);
    expect(screen.queryByRole("button", { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /timeout user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /warn user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete message/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pin this message/i })).toBeNull();
  });

  it.each([
    "twitch",
    "kick",
  ] as const)("shows only the inline delete mod button on the signed-in user's own %s message", (platform) => {
    const cbs = allCallbacks();
    render(
      <ChatMessage
        message={baseMessage({ platform, userId: "self", badges: [badge("moderator")] })}
        selfUserId="self"
        {...cbs}
      />
    );
    expect(screen.queryByRole("button", { name: /timeout user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /warn user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /unban user/i })).toBeNull();
    expect(screen.getByRole("button", { name: /delete message/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pin this message/i })).toBeInTheDocument();
  });

  it("hides toolbar when sender has moderator badge and is not the signed-in user", () => {
    const cbs = allCallbacks();
    render(
      <ChatMessage
        message={baseMessage({ userId: "other", badges: [badge("moderator")] })}
        selfUserId="self"
        {...cbs}
      />
    );
    expect(screen.queryByRole("button", { name: /^ban user$/i })).toBeNull();
  });

  it.each(["staff", "admin", "global_mod"])("hides toolbar when sender has %s badge", (setId) => {
    const cbs = allCallbacks();
    render(<ChatMessage message={baseMessage({ badges: [badge(setId)] })} {...cbs} />);
    expect(screen.queryByRole("button", { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /timeout user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /warn user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete message/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pin this message/i })).toBeNull();
  });

  it("fires onTimeout with the message when timeout button is clicked", () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole("button", { name: /timeout user/i }));
    expect(cbs.onTimeout).toHaveBeenCalledTimes(1);
    expect(cbs.onTimeout).toHaveBeenCalledWith(msg);
  });

  it("fires onBan with the message when ban button is clicked", () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole("button", { name: /^ban user$/i }));
    expect(cbs.onBan).toHaveBeenCalledTimes(1);
    expect(cbs.onBan).toHaveBeenCalledWith(msg);
  });

  it("fires onWarn with the message when warn button is clicked", () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole("button", { name: /warn user/i }));
    expect(cbs.onWarn).toHaveBeenCalledTimes(1);
    expect(cbs.onWarn).toHaveBeenCalledWith(msg);
  });

  it("fires onUnban with the message when unban button is clicked", () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole("button", { name: /unban user/i }));
    expect(cbs.onUnban).toHaveBeenCalledTimes(1);
    expect(cbs.onUnban).toHaveBeenCalledWith(msg);
  });

  it("fires onDelete with the message when delete button is clicked", () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    fireEvent.click(screen.getByRole("button", { name: /delete message/i }));
    expect(cbs.onDelete).toHaveBeenCalledTimes(1);
    expect(cbs.onDelete).toHaveBeenCalledWith(msg);
  });

  it("fires onPin with the message when pin button is clicked", async () => {
    const cbs = allCallbacks();
    const msg = baseMessage();
    render(<ChatMessage message={msg} {...cbs} />);
    const button = screen.getByRole("button", { name: /pin this message/i });
    expect(button.className).toContain("h-8");
    expect(button.className).toContain("w-8");
    expect(button.className).toContain("rounded-[9000px]");
    expect(button.className).not.toContain("min-h-8");
    expect(button.className).not.toContain("min-w-8");
    expect(button.className).toContain("cursor-pointer");
    expect(button.className).toContain("bg-[#18181b]");
    expect(button.className).toContain("hover:bg-[#34343c]");
    expect(button.className).toContain("active:bg-[#393940]");
    expect(button.className).toContain("text-white");
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("h-5 w-5");
    expect(button.querySelectorAll("path")[0]?.getAttribute("d")).toBe(
      "M18 4V2H6v2h2v5a3 3 0 0 0-3 3v4h14v-4a3 3 0 0 0-3-3V4h2Zm-1 10H7v-2a1 1 0 0 1 1-1h2V4h4v7h2a1 1 0 0 1 1 1v2Z"
    );
    expect(button.querySelectorAll("path")[1]?.getAttribute("d")).toBe("M13 18h-2v4h2v-4Z");
    fireEvent.focus(button);
    expect(await screen.findAllByText("Pin this message")).not.toHaveLength(0);
    const tooltip = document.querySelector('[data-side="top"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.className).toContain("text-sm");
    expect(tooltip?.className).toContain("font-semibold");
    expect(tooltip?.className).toContain("leading-[1.4]");
    expect(tooltip?.className).toContain("!rounded-[4px]");
    expect(tooltip?.getAttribute("data-align")).toBe("end");
    expect(tooltip?.className).toContain("text-left");
    expect(tooltip?.className).toContain("!bg-white");
    expect(tooltip?.className).toContain("!text-[#0e0e10]");
    expect(tooltip?.querySelector("svg")?.className.baseVal).toContain("!fill-white");
    fireEvent.click(button);
    expect(cbs.onPin).toHaveBeenCalledTimes(1);
    expect(cbs.onPin).toHaveBeenCalledWith(msg);
  });

  it("does not render toolbar on ban-type messages", () => {
    const cbs = allCallbacks();
    render(
      <ChatMessage
        message={
          baseMessage({
            type: "ban",
            banInfo: {
              bannedUsername: "spammer",
              bannedByUsername: "mod",
              duration: 600,
              lastMessage: "lol",
            },
          }) as ChatMessageType
        }
        {...cbs}
      />
    );
    expect(screen.queryByRole("button", { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /warn user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pin this message/i })).toBeNull();
  });

  it("does not render toolbar when isDeleted is true", () => {
    const cbs = allCallbacks();
    render(<ChatMessage message={baseMessage({ isDeleted: true })} {...cbs} />);
    expect(screen.queryByRole("button", { name: /^ban user$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /warn user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pin this message/i })).toBeNull();
  });
});
