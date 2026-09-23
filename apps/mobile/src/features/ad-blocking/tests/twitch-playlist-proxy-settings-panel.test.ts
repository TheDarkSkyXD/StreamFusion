import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { AdBlockSettingsView } from "../components/adblock-settings-panel";
import { TwitchPlaylistProxySettingsView } from "../components/twitch-playlist-proxy-settings-panel";
import { composeAdBlockView } from "../domain/adblock-policy";
import {
  composeTwitchPlaylistProxyView,
  DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES,
} from "../domain/twitch-playlist-proxy-preferences";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  Switch: "Switch",
}));

type ElementProps = Readonly<{
  children?: unknown;
  disabled?: boolean;
  onPress?: () => void;
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
      : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

describe("twitch playlist proxy settings view", () => {
  it("renders enable control, restore defaults, and source rows", () => {
    const preferences = DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES;
    const view = composeTwitchPlaylistProxyView(preferences);
    const nodes = descendants(
      TwitchPlaylistProxySettingsView({
        busy: false,
        draft: null,
        draftError: null,
        onChangeDraft: () => undefined,
        onCloseDraft: () => undefined,
        onRestoreDefaults: () => undefined,
        onSaveDraft: () => undefined,
        onSavePreferences: () => undefined,
        onSetDraftError: () => undefined,
        preferences,
        view,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "panel-twitch-playlist-proxy"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "twitch-playlist-proxy-enabled"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "twitch-playlist-proxy-restore"),
    ).toBe(true);
  });

  it("toggles the playlist proxy enabled preference", () => {
    let enabled = true;
    const preferences = DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES;
    const view = composeTwitchPlaylistProxyView(preferences);
    const nodes = descendants(
      TwitchPlaylistProxySettingsView({
        busy: false,
        draft: null,
        draftError: null,
        onChangeDraft: () => undefined,
        onCloseDraft: () => undefined,
        onRestoreDefaults: () => undefined,
        onSaveDraft: () => undefined,
        onSavePreferences: (next) => {
          enabled = next.enabled;
        },
        onSetDraftError: () => undefined,
        preferences,
        view,
      }),
    );
    nodes
      .find(
        (node) =>
          node.props.testID === "twitch-playlist-proxy-enabled" &&
          node.props.onPress,
      )
      ?.props.onPress?.();
    expect(enabled).toBe(false);
  });
});

describe("adblock settings pause when playlist proxy is on", () => {
  it("locks strip and canary controls while playlist proxy mode is enabled", () => {
    const view = composeAdBlockView({
      policyAllowed: true,
      preferences: { enabled: true, method: "strip" },
    });
    const nodes = descendants(
      AdBlockSettingsView({
        busy: false,
        onSave: () => undefined,
        playlistProxyEnabled: true,
        view,
      }),
    );
    expect(nodes.find((node) => node.props.testID === "adblock")?.props.disabled).toBe(
      true,
    );
    expect(
      nodes.find((node) => node.props.testID === "adblock-method-canary")?.props.disabled,
    ).toBe(true);
    expect(nodes.find((node) => node.props.testID === "adblock-title")).toBeTruthy();
  });
});
