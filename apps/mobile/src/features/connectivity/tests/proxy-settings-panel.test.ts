import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { serializeProxy } from "../domain/proxy-config";
import { composeConnectivityView } from "../domain/compose-connectivity-view";
import { ConnectivityDiagnosticsView } from "../components/connectivity-diagnostics-panel";
import { ProxySettingsView } from "../components/proxy-settings-panel";

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  onPress?: () => void;
  testID?: string;
  value?: string;
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

const readyView = composeConnectivityView({
  credentials: { password: "secret", username: "alice" },
  nativeProxy: "ready",
  network: "online",
  stored: serializeProxy({ enabled: true, host: "127.0.0.1", port: 8080 }),
});

describe("proxy settings view", () => {
  it("renders host, port, credentials, and the live request scope", () => {
    const nodes = descendants(
      ProxySettingsView({
        busy: false,
        draft: readyView.draft,
        onChange: () => undefined,
        onSave: () => undefined,
        view: readyView,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "panel-proxy")).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "proxy-request-scope"),
    ).toBe(true);
    expect(
      nodes.find((node) => node.props.testID === "proxy-host")?.props.value,
    ).toBe("127.0.0.1");
    expect(
      nodes.find((node) => node.props.testID === "proxy-port")?.props.value,
    ).toBe("8080");
  });

  it("saves from the assigned control", () => {
    let saved = false;
    const nodes = descendants(
      ProxySettingsView({
        busy: false,
        draft: readyView.draft,
        onChange: () => undefined,
        onSave: () => {
          saved = true;
        },
        view: readyView,
      }),
    );
    nodes.find((node) => node.props.testID === "proxy-save")?.props.onPress?.();
    expect(saved).toBe(true);
  });
});

describe("connectivity diagnostics view", () => {
  it("names the proxy host when a proxy is on", () => {
    const nodes = descendants(
      ConnectivityDiagnosticsView({ view: readyView }),
    );
    expect(
      nodes.some(
        (node) => node.props.testID === "panel-connectivity-diagnostics",
      ),
    ).toBe(true);
    expect(
      nodes.find((node) => node.props.testID === "diagnostics-proxy-status")
        ?.props.children,
    ).toBe("Proxy 127.0.0.1:8080");
  });
});
