import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiTokensSettingsView } from "../components/api-tokens-settings-panel";
import { IntegrationsSettingsView } from "../components/integrations-settings-panel";
import { composeApiTokenSettingsView } from "../domain/api-token-status";

vi.mock("react-native", () => ({
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  View: "View",
  Switch: "Switch",
}));

vi.mock("@react-native-community/slider", () => ({
  default: "Slider",
}));

vi.mock("lucide-react-native", () => ({
  ChevronDown: "ChevronDown",
}));

vi.mock("@mobile/design/haptics", () => ({
  selectionHaptic: vi.fn(async () => undefined),
}));

type ElementProps = Readonly<{
  children?: unknown;
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

const guestTwitch = { kind: "disconnected" as const };
const guestKick = { kind: "disconnected" as const };
const connectedTwitch = {
  kind: "connected" as const,
  displayName: "NightOwl",
  login: "nightowl",
  profileImageUrl: null,
  scopes: ["chat:read", "user:read:follows"],
  missingScopes: [],
  expiresAtEpochMs: Date.UTC(2026, 11, 1),
  validatedAtEpochMs: Date.UTC(2026, 8, 1),
  refreshing: false,
  view: "summary" as const,
};

describe("integrations settings view", () => {
  it("discloses sign-in for guests and opens accounts", () => {
    let opened = false;
    const nodes = descendants(
      IntegrationsSettingsView({
        kick: guestKick,
        onOpenAccounts: () => {
          opened = true;
        },
        twitch: guestTwitch,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "panel-integrations"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "integrations-accounts"),
    ).toBe(true);
    nodes
      .find((node) => node.props.testID === "integrations-accounts")
      ?.props.onPress?.();
    expect(opened).toBe(true);
  });
});

describe("api tokens settings view", () => {
  it("shows guest not-connected and connected token status without secrets", () => {
    const guestNodes = descendants(
      ApiTokensSettingsView({
        onOpenIntegrations: () => undefined,
        view: composeApiTokenSettingsView({
          kick: guestKick,
          twitch: guestTwitch,
        }),
      }),
    );
    expect(
      guestNodes.some((node) => node.props.testID === "panel-api-tokens"),
    ).toBe(true);
    expect(
      guestNodes.some((node) => node.props.testID === "api-token-status"),
    ).toBe(true);

    const connected = composeApiTokenSettingsView({
      kick: guestKick,
      twitch: connectedTwitch,
    });
    expect(connected.twitch.status.kind).toBe("valid");
    if (connected.twitch.status.kind === "valid") {
      expect(connected.twitch.status.login).toBe("nightowl");
      expect(JSON.stringify(connected)).not.toMatch(/oauth|secret|access/i);
    }
    const nodes = descendants(
      ApiTokensSettingsView({
        onOpenIntegrations: () => undefined,
        view: connected,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "api-token-twitch")).toBe(
      true,
    );
  });
});
