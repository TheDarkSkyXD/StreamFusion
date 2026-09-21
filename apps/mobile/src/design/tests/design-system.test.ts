import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { MobileButton } from "../button";
import { MobileFilterChip } from "../chip";
import { MobilePlatformBadge } from "../platform-badge";
import { MobileScreenHeader } from "../screen-header";
import { MobileStatusPanel } from "../status-panel";
import { MobileCatalogTags, catalogTagLabels } from "../tag";
import { mobileColors, mobileRadii, mobileShadows, mobileType } from "../tokens";
import { MobileUnderlineTabs } from "../underline-tabs";
import { MobileVerifiedBadge } from "../verified-badge";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  accessibilityState?: Readonly<{ disabled?: boolean; selected?: boolean }>;
  children?: unknown;
  disabled?: boolean;
  onPress?: () => void;
  style?: unknown;
  testID?: string;
}>;
type Element = ReactElement<ElementProps>;

function descendants(node: unknown): readonly Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child));
  if (!isValidElement<ElementProps>(node)) return [];
  const element: Element = node;
  const candidate = element.type as unknown;
  const component =
    typeof candidate === "function"
      ? (candidate as (props: ElementProps) => unknown)
      : typeof candidate === "object" &&
          candidate !== null &&
          "type" in candidate &&
          typeof candidate.type === "function"
        ? (candidate.type as (props: ElementProps) => unknown)
        : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (style == null || style === false) return {};
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
  }
  if (typeof style === "object") return style as Record<string, unknown>;
  return {};
}

function resolveStyle(style: unknown): Record<string, unknown> {
  if (typeof style === "function") {
    return flattenStyle(
      (style as (state: { readonly pressed: boolean }) => unknown)({
        pressed: false,
      }),
    );
  }
  return flattenStyle(style);
}

describe("mobile design tokens", () => {
  it("keeps DESIGN.md void palette, tag chips, and platform guests", () => {
    expect(mobileColors.background).toBe("#0f0f0f");
    expect(mobileColors.surface).toBe("#1a1a1a");
    expect(mobileColors.surfaceMuted).toBe("#252525");
    expect(mobileColors.surfaceRaised).toBe("#2d2d2d");
    expect(mobileColors.live).toBe("#dc143c");
    expect(mobileColors.tagSurface).toBe("#4a4d55");
    expect(mobileColors.tagText).toBe("#efeff1");
    expect(mobileColors.twitch).toBe("#9146ff");
    expect(mobileColors.kick).toBe("#53fc18");
    expect(mobileRadii.large).toBe(12);
    expect(mobileRadii.full).toBe(999);
    expect(mobileType.display.fontSize).toBe(24);
    expect(mobileType.display.fontWeight).toBe("700");
    expect(mobileType.body.fontSize).toBe(16);
  });
});

describe("mobile design primitives", () => {
  it("renders a primary button as storm white on void black", () => {
    const pressed: string[] = [];
    const nodes = descendants(
      MobileButton({
        accessibilityLabel: "Retry Twitch",
        children: "Retry twitch",
        onPress: () => pressed.push("retry"),
        testID: "home-retry-twitch",
        variant: "primary",
      }),
    );
    const button = nodes.find((node) => node.props.testID === "home-retry-twitch");
    expect(resolveStyle(button?.props.style).backgroundColor).toBe(
      mobileColors.textPrimary,
    );
    const label = nodes.find((node) => node.props.children === "Retry twitch");
    expect(resolveStyle(label?.props.style).color).toBe(mobileColors.background);
    button?.props.onPress?.();
    expect(pressed).toEqual(["retry"]);
  });

  it("uses Twitch purple and Kick green for platform guests", () => {
    const twitch = descendants(
      MobileButton({
        accessibilityLabel: "Retry twitch",
        children: "Retry twitch",
        onPress: () => undefined,
        testID: "home-retry-twitch",
        variant: "twitch",
      }),
    );
    const kick = descendants(
      MobileButton({
        accessibilityLabel: "Retry kick",
        children: "Retry kick",
        onPress: () => undefined,
        testID: "home-retry-kick",
        variant: "kick",
      }),
    );
    const twitchButton = twitch.find(
      (node) => node.props.testID === "home-retry-twitch",
    );
    const kickButton = kick.find((node) => node.props.testID === "home-retry-kick");
    expect(resolveStyle(twitchButton?.props.style).backgroundColor).toBe(
      mobileColors.twitch,
    );
    expect(resolveStyle(kickButton?.props.style).backgroundColor).toBe(
      mobileColors.kick,
    );
    expect(
      kick.some(
        (node) =>
          node.props.children === "Retry kick" &&
          flattenStyle(node.props.style).color === mobileColors.background,
      ),
    ).toBe(true);
  });

  it("uses pill tag chips and selected nav fill", () => {
    const nodes = descendants(
      MobileFilterChip({
        accessibilityLabel: "Live tab",
        accessibilityRole: "tab",
        label: "Live",
        onPress: () => undefined,
        selected: true,
        testID: "search-tab-streams",
      }),
    );
    const chip = nodes.find((node) => node.props.testID === "search-tab-streams");
    expect(resolveStyle(chip?.props.style).borderRadius).toBe(mobileRadii.full);
    expect(resolveStyle(chip?.props.style).backgroundColor).toBe(
      mobileColors.navigationSelected,
    );
    expect(chip?.props.accessibilityState?.selected).toBe(true);
  });

  it("keeps Twitch badges white-on-purple and Kick badges void-on-green", () => {
    const twitch = descendants(MobilePlatformBadge({ platform: "twitch" }));
    const kick = descendants(MobilePlatformBadge({ platform: "kick" }));
    expect(
      twitch.some(
        (node) => resolveStyle(node.props.style).backgroundColor === mobileColors.twitch,
      ),
    ).toBe(true);
    expect(
      twitch.some(
        (node) =>
          node.props.children === "TWITCH" &&
          flattenStyle(node.props.style).color === mobileColors.textPrimary,
      ),
    ).toBe(true);
    expect(
      kick.some(
        (node) => flattenStyle(node.props.style).backgroundColor === mobileColors.kick,
      ),
    ).toBe(true);
    expect(
      kick.some(
        (node) =>
          node.props.children === "KICK" &&
          flattenStyle(node.props.style).color === mobileColors.background,
      ),
    ).toBe(true);
  });

  it("uses display type for screen titles and a bordered empty panel", () => {
    const header = descendants(
      MobileScreenHeader({ summary: "Live recommendations.", title: "Home" }),
    );
    const title = header.find((node) => node.props.children === "Home");
    expect(flattenStyle(title?.props.style).fontSize).toBe(24);
    const panel = descendants(
      MobileStatusPanel({
        children: "No live recommendations are available right now.",
        testID: "home-empty",
        tone: "empty",
      }),
    );
    const box = panel.find((node) => node.props.testID === "home-empty");
    expect(flattenStyle(box?.props.style).borderColor).toBe(mobileColors.border);
    expect(flattenStyle(box?.props.style).backgroundColor).toBe(mobileColors.surface);
  });

  it("keeps catalog tags compact and verified badges as platform guests", () => {
    expect(catalogTagLabels({ language: "en", tags: ["en", "proof", " "] })).toEqual([
      "en",
      "proof",
    ]);
    const tags = descendants(
      MobileCatalogTags({
        language: "en",
        tags: ["proof"],
        testID: "stream-tags",
      }),
    );
    expect(tags.some((node) => node.props.testID === "stream-tags")).toBe(true);
    const proof = tags.find((node) => node.props.children === "proof");
    expect(flattenStyle(proof?.props.style).color).toBe(mobileColors.tagText);
    const twitch = descendants(MobileVerifiedBadge({ platform: "twitch" }));
    const kick = descendants(MobileVerifiedBadge({ platform: "kick" }));
    expect(
      twitch.some(
        (node) => resolveStyle(node.props.style).backgroundColor === mobileColors.twitch,
      ),
    ).toBe(true);
    expect(
      kick.some(
        (node) => resolveStyle(node.props.style).backgroundColor === mobileColors.kick,
      ),
    ).toBe(true);
    expect(mobileShadows.toast).toContain("rgba(0,0,0,0.3)");
    expect(mobileShadows.popover).toContain("0 4px 16px");
    expect(mobileShadows.dialog).toContain("0 8px 32px");
    expect(mobileColors.playerScrim).toBe("rgba(15,15,15,0.42)");
  });
});

describe("MobileUnderlineTabs", () => {
  it("marks the active tab selected without pill chip styling", () => {
    const selected: string[] = [];
    const nodes = descendants(
      MobileUnderlineTabs({
        accessibilityLabel: "Modes",
        onSelect: (id) => selected.push(id),
        selectedId: "search",
        tabs: [
          { id: "search", label: "Search", testID: "tab-search" },
          { id: "history", label: "History", testID: "tab-history" },
        ],
        testID: "mode-tabs",
      }),
    );
    expect(nodes.some((node) => node.props.testID === "mode-tabs")).toBe(true);
    const active = nodes.find((node) => node.props.testID === "tab-search");
    expect(active?.props.accessibilityState?.selected).toBe(true);
    const inactive = nodes.find((node) => node.props.testID === "tab-history");
    expect(inactive?.props.accessibilityState?.selected).toBe(false);
    inactive?.props.onPress?.();
    expect(selected).toEqual(["history"]);
  });
});
