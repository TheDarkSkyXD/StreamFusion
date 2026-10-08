import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { MobileAvatar } from "../avatar";

type AvatarNode = ReactElement<{
  readonly accessibilityLabel?: string;
  readonly accessibilityRole?: string;
  readonly children?: unknown;
  readonly source?: { readonly uri: string };
  readonly style?: unknown;
  readonly testID?: string;
}>;

function nodes(child: unknown): readonly AvatarNode[] {
  if (Array.isArray(child)) return child.flatMap(nodes);
  if (!isValidElement<AvatarNode["props"]>(child)) return [];
  const element: AvatarNode = child;
  return [element, ...nodes(element.props.children)];
}

function style(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return Object.assign({}, ...value.map(style));
  }
  return value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value))
    : {};
}

describe("MobileAvatar", () => {
  it("keeps a Twitch live image within the 36dp avatar and dark separator", () => {
    const rendered = nodes(
      MobileAvatar({
        livePlatform: "twitch",
        name: "Ada",
        size: 36,
        testID: "channel-avatar",
        uri: "https://example.com/ada.png",
      }),
    );
    const [avatar, gap, picture] = rendered;
    const image = rendered.find((node) => node.type === "Image");

    expect(avatar?.props.testID).toBe("channel-avatar");
    expect(avatar?.props.accessibilityLabel).toBe("Ada");
    expect(avatar?.props.accessibilityRole).toBe("image");
    expect(style(avatar?.props.style)).toMatchObject({
      width: 36,
      height: 36,
      borderColor: "#9146ff",
      borderWidth: 2,
    });
    expect(style(gap?.props.style)).toMatchObject({
      width: 32,
      height: 32,
      backgroundColor: "#0f0f0f",
    });
    expect(style(picture?.props.style)).toMatchObject({
      width: 28,
      height: 28,
      overflow: "hidden",
    });
    expect(image?.type).toBe("Image");
    expect(image?.props.source).toEqual({ uri: "https://example.com/ada.png" });
  });

  it("shows initials inside a Kick live ring when the image is absent", () => {
    const rendered = nodes(
      MobileAvatar({ livePlatform: "kick", name: "  Kora", size: 64, uri: "" }),
    );
    expect(style(rendered[0]?.props.style)).toMatchObject({
      width: 64,
      height: 64,
      borderColor: "#53fc18",
      borderWidth: 2,
    });
    expect(style(rendered[2]?.props.style)).toMatchObject({
      width: 56,
      height: 56,
    });
    expect(rendered.find((node) => node.type === "Text")?.props.children).toBe(
      "K",
    );
    expect(rendered.some((node) => node.type === "Image")).toBe(false);
  });

  it("keeps offline avatars neutral with the existing initial fallback", () => {
    const rendered = nodes(
      MobileAvatar({ livePlatform: null, name: "Ada", size: 40, uri: null }),
    );
    expect(style(rendered[0]?.props.style)).toMatchObject({
      width: 40,
      height: 40,
      borderColor: "#333333",
      borderWidth: 1,
    });
    expect(rendered.find((node) => node.type === "Text")?.props.children).toBe(
      "A",
    );
    expect(rendered.some((node) => node.type === "Image")).toBe(false);
  });
});
