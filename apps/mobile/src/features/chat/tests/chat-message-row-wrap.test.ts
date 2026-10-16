import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@mobile/features/settings/domain/chat-display-preferences";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../components/chat-username", () => ({
  ChatUsername: ({ name }: { readonly name: string }) =>
    createElement("Text", null, name),
}));
vi.mock("@mobile/design/emote-image", () => ({
  MobileEmoteImage: ({ name }: { readonly name: string }) =>
    createElement("Image", { accessibilityLabel: name }),
}));

import { ChatMessageRow } from "../components/chat-message-row";

it("starts a long message beside the username and leaves later words free to wrap", () => {
  const html = renderToStaticMarkup(
    createElement(ChatMessageRow, {
      message: {
        id: "long-line",
        text: "Hello chat, this message runs much longer than the row",
        displayName: "Viewer",
        username: "viewer",
        userId: "viewer-1",
        badges: [],
      },
      platform: "twitch",
      emotes: [],
      preferences: DEFAULT_CHAT_DISPLAY_PREFERENCES,
      onSelect: () => undefined,
    }),
  );
  const row = new JSDOM(html).window.document.querySelector(
    '[testid="watch-chat-message-long-line"]',
  );
  expect(row).not.toBeNull();
  const children = Array.from(row?.children ?? []);
  const colon = children.findIndex((child) => child.textContent === ": ");
  expect(children[colon + 1]?.textContent).toBe("Hello ");
  expect(children[colon + 2]?.textContent).toBe("chat, ");
  expect(children.slice(colon + 1).map((child) => child.textContent).join(""))
    .toBe("Hello chat, this message runs much longer than the row");
});
