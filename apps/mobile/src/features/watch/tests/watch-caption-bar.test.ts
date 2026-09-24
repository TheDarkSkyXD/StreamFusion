import { isValidElement, type ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WatchCaptionBar } from "../components/watch-caption-bar";
import { WatchCaptionOverlay } from "../components/watch-caption-overlay";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
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

function byTestId(nodes: readonly Element[], testID: string): Element | undefined {
  return nodes.find((node) => node.props.testID === testID);
}

function press(nodes: readonly Element[], testID: string): void {
  byTestId(nodes, testID)?.props.onPress?.();
}

const i18nTest = vi.hoisted(() => ({
  t: (key: string, _options?: Record<string, unknown>) => key as string,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => i18nTest.t(key, options),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

describe("Watch caption chrome", () => {
  beforeAll(async () => {
    const { bootstrapMobileI18n, i18n } = await import("@mobile/i18n");
    await bootstrapMobileI18n();
    i18nTest.t = (key: string, options?: Record<string, unknown>) =>
      i18n.t(key, options as never);
  });

  it("hides Watch caption chrome when the English model is not installed", () => {
    expect(
      WatchCaptionBar({
        eligibility: {
          kind: "eligible",
          label: "Captions",
          sessionId: "cap-twitch-twitch-1",
        },
        model: {
          audioUploadAttempts: 0,
          displaySize: "43.11 MiB",
          downloadedBytes: 0,
          expectedBytes: 45_202_074,
          installed: false,
          languageLabel: "English",
          license: "Apache-2.0",
          modelId: "english-v1",
          pack: "none",
          phase: "not-installed",
          sha256Verified: false,
          statusMessage:
            "Install the 43.11 MiB English model to caption this Stream locally.",
        },
        onInstall: () => undefined,
        onRemove: () => undefined,
        onStart: () => undefined,
        onStop: () => undefined,
        session: null,
      }),
    ).toBeNull();
  });

  it("never offers Install English model or Remove model on Watch", () => {
    const nodes = descendants(
      WatchCaptionBar({
        eligibility: {
          kind: "eligible",
          label: "Captions",
          sessionId: "cap-twitch-twitch-1",
        },
        model: {
          audioUploadAttempts: 0,
          displaySize: "43.11 MiB",
          downloadedBytes: 45_202_074,
          expectedBytes: 45_202_074,
          installed: true,
          languageLabel: "English",
          license: "Apache-2.0",
          modelId: "english-v1",
          pack: "fixture",
          phase: "ready",
          sha256Verified: true,
          statusMessage: "English model ready offline.",
        },
        onInstall: () => undefined,
        onRemove: () => undefined,
        onStart: () => undefined,
        onStop: () => undefined,
        session: {
          audioLeftDevice: false,
          audioUploadAttempts: 0,
          cueText: "",
          microphonePermissionRequested: false,
          pcmBytesProcessed: 0,
          sessionId: "cap-twitch-twitch-1",
          state: "stopped",
        },
      }),
    );
    expect(byTestId(nodes, "watch-captions-install")).toBeUndefined();
    expect(byTestId(nodes, "watch-captions-remove")).toBeUndefined();
    expect(byTestId(nodes, "watch-captions-start")).toBeTruthy();
  });

  it("starts and stops captions after the model is already installed", () => {
    const actions: string[] = [];
    const installed = WatchCaptionBar({
      eligibility: {
        kind: "eligible",
        label: "Captions",
        sessionId: "cap-twitch-twitch-1",
      },
      model: {
        audioUploadAttempts: 0,
        displaySize: "43.11 MiB",
        downloadedBytes: 45_202_074,
        expectedBytes: 45_202_074,
        installed: true,
        languageLabel: "English",
        license: "Apache-2.0",
        modelId: "english-v1",
        pack: "fixture",
        phase: "ready",
        sha256Verified: true,
        statusMessage: "English model ready offline. 43.11 MiB. Audio stays on this device.",
      },
      onStart: () => actions.push("start"),
      onStop: () => actions.push("stop"),
      session: {
        audioLeftDevice: false,
        audioUploadAttempts: 0,
        cueText: "",
        microphonePermissionRequested: false,
        pcmBytesProcessed: 0,
        sessionId: "cap-twitch-twitch-1",
        state: "stopped",
      },
    });
    press(descendants(installed), "watch-captions-start");
    const active = WatchCaptionBar({
      eligibility: {
        kind: "eligible",
        label: "Captions",
        sessionId: "cap-twitch-twitch-1",
      },
      model: {
        audioUploadAttempts: 0,
        displaySize: "43.11 MiB",
        downloadedBytes: 45_202_074,
        expectedBytes: 45_202_074,
        installed: true,
        languageLabel: "English",
        license: "Apache-2.0",
        modelId: "english-v1",
        pack: "fixture",
        phase: "ready",
        sha256Verified: true,
        statusMessage: "English model ready offline. 43.11 MiB. Audio stays on this device.",
      },
      onStart: () => actions.push("start"),
      onStop: () => actions.push("stop"),
      session: {
        audioLeftDevice: false,
        audioUploadAttempts: 0,
        cueText: "Local captions are running on this device.",
        microphonePermissionRequested: false,
        pcmBytesProcessed: 640,
        sessionId: "cap-twitch-twitch-1",
        state: "active",
      },
    });
    press(descendants(active), "watch-captions-stop");
    expect(actions).toEqual(["start", "stop"]);
  });

  it("hides the bar when captions are not offered", () => {
    expect(
      WatchCaptionBar({
        eligibility: { kind: "hidden" },
        model: null,
        onStart: () => undefined,
        onStop: () => undefined,
        session: null,
      }),
    ).toBeNull();
  });

  it("renders overlay cue text and stays empty without a cue", () => {
    expect(WatchCaptionOverlay({ text: "" })).toBeNull();
    const nodes = descendants(
      WatchCaptionOverlay({
        text: "Decoded program audio stays on this phone.",
      }),
    );
    expect(byTestId(nodes, "watch-caption-cue")?.props.children).toBe(
      "Decoded program audio stays on this phone.",
    );
  });
});
