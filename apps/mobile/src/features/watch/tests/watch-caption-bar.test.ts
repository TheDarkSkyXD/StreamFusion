import { isValidElement, type ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WatchCaptionBar } from "../components/watch-caption-bar";
import { WatchCaptionOverlay } from "../components/watch-caption-overlay";
import type { CaptionModelState } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Modal: "Modal",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "android" },
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  View: "View",
}));

type ElementProps = Readonly<{
  children?: unknown;
  onPress?: () => void;
  disabled?: boolean;
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

function byTestId(
  nodes: readonly Element[],
  testID: string,
): Element | undefined {
  return nodes.find((node) => node.props.testID === testID);
}

const i18nTest = vi.hoisted(() => ({
  t: (key: string, _options?: Record<string, unknown>) => key as string,
}));

const productModel: CaptionModelState = {
  modelId: "english-v1",
  pack: "product",
  phase: "ready",
  installed: true,
  sha256Verified: true,
  displaySize: "39.30 MiB",
  expectedBytes: 41_205_931,
  downloadedBytes: 41_205_931,
  audioUploadAttempts: 0,
  languageLabel: "English",
  license: "Apache-2.0",
  statusMessage: "English speech model ready offline.",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      i18nTest.t(key, options),
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

  it("hides CC when disabled and explains an unavailable native host", () => {
    expect(WatchCaptionBar({ eligibility: { kind: "hidden" } })).toBeNull();
    const nodes = descendants(
      WatchCaptionBar({
        eligibility: {
          kind: "unsupported",
          reason: "This requires the native Android client.",
        },
      }),
    );
    expect(byTestId(nodes, "watch-captions-unavailable")).toBeDefined();
    expect(byTestId(nodes, "watch-caption-start")).toBeUndefined();
  });

  it("downloads a speech model instead of promoting a diagnostic fixture", () => {
    const install = vi.fn();
    const nodes = descendants(
      WatchCaptionBar({
        eligibility: {
          kind: "eligible",
          label: "Local captions",
          sessionId: "actual-player",
        },
        model: { ...productModel, pack: "fixture" },
        onInstall: install,
      }),
    );
    byTestId(nodes, "watch-caption-install")?.props.onPress?.();
    expect(install).toHaveBeenCalledOnce();
    expect(byTestId(nodes, "watch-caption-start")).toBeUndefined();
  });

  it("starts only after the product model verifies and disables operations while busy", () => {
    const start = vi.fn();
    const eligibility = {
      kind: "eligible",
      label: "Local captions",
      sessionId: "actual-player",
    } as const;
    const nodes = descendants(
      WatchCaptionBar({ eligibility, model: productModel, onStart: start }),
    );
    byTestId(nodes, "watch-caption-start")?.props.onPress?.();
    expect(start).toHaveBeenCalledOnce();
    const busy = descendants(
      WatchCaptionBar({
        eligibility,
        model: productModel,
        onStart: start,
        busy: true,
      }),
    );
    expect(byTestId(busy, "watch-caption-start")?.props.disabled).toBe(true);
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

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => [initial, () => undefined],
  };
});

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("lucide-react-native", () => ({ ChevronRight: "ChevronRight" }));
