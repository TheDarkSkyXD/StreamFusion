import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { AdBlockSettingsView } from "../components/adblock-settings-panel";
import { TwitchPlaylistProxySettingsView } from "../components/twitch-playlist-proxy-settings-panel";
import { composeAdBlockView } from "../domain/adblock-policy";
import {
  composeTwitchPlaylistProxyView,
  DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES,
} from "../domain/twitch-playlist-proxy-preferences";

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
        onCancelDelete: () => undefined,
        onConfirmDelete: () => undefined,
        onRequestDelete: () => undefined,
        onRefreshStatuses: () => undefined,
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
      nodes.some(
        (node) => node.props.testID === "twitch-playlist-proxy-enabled",
      ),
    ).toBe(true);
    expect(
      nodes.some(
        (node) => node.props.testID === "twitch-playlist-proxy-restore",
      ),
    ).toBe(true);
  });

  it("toggles the playlist proxy enabled preference", () => {
    let enabled = false;
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
        onCancelDelete: () => undefined,
        onConfirmDelete: () => undefined,
        onRequestDelete: () => undefined,
        onRefreshStatuses: () => undefined,
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
    expect(enabled).toBe(true);
  });

  it("locks proxy while custom filtering is effective and confirms deletion", () => {
    const preferences = DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES;
    const source = preferences.sources[0];
    expect(source).toBeDefined();
    if (!source) return;
    let confirmed = false;
    const nodes = descendants(
      TwitchPlaylistProxySettingsView({
        busy: false,
        customEnabled: true,
        deleteSource: source,
        draft: null,
        draftError: null,
        onCancelDelete: () => undefined,
        onChangeDraft: () => undefined,
        onCloseDraft: () => undefined,
        onConfirmDelete: () => {
          confirmed = true;
        },
        onRefreshStatuses: () => undefined,
        onRequestDelete: () => undefined,
        onRestoreDefaults: () => undefined,
        onSaveDraft: () => undefined,
        onSavePreferences: () => undefined,
        onSetDraftError: () => undefined,
        preferences,
        statuses: { [source.id]: "online" },
        view: composeTwitchPlaylistProxyView(preferences),
      }),
    );
    expect(
      nodes.find(
        (node) => node.props.testID === "twitch-playlist-proxy-enabled",
      )?.props.disabled,
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === `twitch-playlist-proxy-status-${source.id}`,
      ),
    ).toBe(true);
    expect(confirmed).toBe(false);
    nodes
      .find(
        (node) => node.props.testID === "twitch-playlist-proxy-confirm-delete",
      )
      ?.props.onPress?.();
    expect(confirmed).toBe(true);
  });
});

describe("adblock settings while playlist proxy is on", () => {
  it("keeps custom controls available so enabling custom can disable proxy", () => {
    const view = composeAdBlockView({
      policyAllowed: true,
      preferences: { enabled: true, method: "strip" },
    });
    const nodes = descendants(
      AdBlockSettingsView({
        busy: false,
        onSave: () => undefined,
        view,
      }),
    );
    expect(
      nodes.find((node) => node.props.testID === "adblock")?.props.disabled,
    ).toBeFalsy();
    expect(
      nodes.find((node) => node.props.testID === "adblock-method-canary")?.props
        .disabled,
    ).toBeFalsy();
    expect(
      nodes.find((node) => node.props.testID === "adblock-title"),
    ).toBeTruthy();
  });
});
