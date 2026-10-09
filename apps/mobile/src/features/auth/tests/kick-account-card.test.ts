import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  KickAccountCard,
  type KickAccountActions,
} from "../components/kick-account-card";
import type { KickAccountSessionSnapshot } from "../domain/kick-account-session-controller";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const host =
    (tag: string) =>
    (props: { readonly children?: ReactNode; readonly testID?: string }) =>
      createElement(tag, { "data-testid": props.testID }, props.children);
  return {
    Image: host("img"),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: host("span"),
    View: host("div"),
  };
});

vi.mock("@mobile/design/button", async () => {
  const { createElement } = await import("react");
  return {
    MobileButton: (props: {
      readonly children: string;
      readonly testID: string;
    }) =>
      createElement("button", { "data-testid": props.testID }, props.children),
  };
});

const actions: KickAccountActions = {
  cancel: () => undefined,
  connect: () => undefined,
  disconnect: () => undefined,
  manage: () => undefined,
  refresh: () => undefined,
  retry: () => undefined,
};

function render(
  model: KickAccountSessionSnapshot,
  fixtureAvailable: boolean,
  developmentFixture = false,
) {
  return renderToStaticMarkup(
    createElement(KickAccountCard, {
      actions,
      developmentFixture,
      model,
      onEnableDevelopmentFixture: fixtureAvailable
        ? () => undefined
        : undefined,
    }),
  );
}

describe("Kick account fixture action", () => {
  it("appears after a connection failure when the development handler is available", () => {
    const failure = {
      kind: "failed",
      failure: "connection",
      message: "Kick configuration is unavailable.",
    } satisfies KickAccountSessionSnapshot;

    expect(render(failure, true)).toContain(
      'data-testid="development-kick-auth-fixture"',
    );
    expect(render(failure, false)).not.toContain(
      'data-testid="development-kick-auth-fixture"',
    );
    expect(render(failure, true, true)).not.toContain(
      'data-testid="development-kick-auth-fixture"',
    );
    expect(render({ kind: "restoring" }, true)).not.toContain(
      'data-testid="development-kick-auth-fixture"',
    );
  });
});
