import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_PRODUCT_PREFERENCES } from "@streamfusion/core/settings";

import {
  BufferSettingsPanel,
  PlaybackSettingsPanel,
} from "../components/settings-panels";
import { composeSettingsView } from "../domain/settings-view";

vi.mock("react-native", () => ({
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  Switch: "Switch",
}));

vi.mock("lucide-react-native", () => ({
  Check: "Check",
  ChevronDown: "ChevronDown",
}));

vi.mock("@react-native-community/slider", () => ({
  default: "Slider",
}));

vi.mock("@mobile/design/haptics", () => ({
  selectionHaptic: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

type ElementProps = Readonly<{
  children?: unknown;
  onValueChange?: (value: number) => void;
  testID?: string;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  value?: number;
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
  if (component) {
    try {
      return [element, ...descendants(component(element.props))];
    } catch {
      return [element];
    }
  }
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

describe("settings panel sliders", () => {
  it("matches desktop carousel and buffer slider ranges", () => {
    let carouselSeconds = DEFAULT_PRODUCT_PREFERENCES.carouselSeconds;
    let liveSyncDurationCount =
      DEFAULT_PRODUCT_PREFERENCES.liveSyncDurationCount;
    let forwardBufferSec = DEFAULT_PRODUCT_PREFERENCES.forwardBufferSec;
    let maxBufferSec = DEFAULT_PRODUCT_PREFERENCES.maxBufferSec;
    const view = composeSettingsView({
      preferences: DEFAULT_PRODUCT_PREFERENCES,
      streamDeviceId: "device",
    });

    const playbackNodes = descendants(
      PlaybackSettingsPanel({
        onChange: (patch) => {
          if (typeof patch.carouselSeconds === "number") {
            carouselSeconds = patch.carouselSeconds;
          }
        },
        view,
      }),
    );
    const carousel = playbackNodes.find(
      (node) => node.props.testID === "carousel-input",
    );
    expect(carousel?.props.minimumValue).toBe(15);
    expect(carousel?.props.maximumValue).toBe(120);
    expect(carousel?.props.step).toBe(5);
    carousel?.props.onValueChange?.(45);
    expect(carouselSeconds).toBe(45);

    const bufferNodes = descendants(
      BufferSettingsPanel({
        onChange: (patch) => {
          if (typeof patch.liveSyncDurationCount === "number") {
            liveSyncDurationCount = patch.liveSyncDurationCount;
          }
          if (typeof patch.forwardBufferSec === "number") {
            forwardBufferSec = patch.forwardBufferSec;
          }
          if (typeof patch.maxBufferSec === "number") {
            maxBufferSec = patch.maxBufferSec;
          }
        },
        view,
      }),
    );

    const target = bufferNodes.find(
      (node) => node.props.testID === "target-latency-input",
    );
    expect(target?.props.minimumValue).toBe(1);
    expect(target?.props.maximumValue).toBe(10);
    expect(target?.props.step).toBe(1);
    target?.props.onValueChange?.(3);
    expect(liveSyncDurationCount).toBe(3);

    const forward = bufferNodes.find(
      (node) => node.props.testID === "forward-buffer-input",
    );
    expect(forward?.props.minimumValue).toBe(5);
    expect(forward?.props.maximumValue).toBe(60);
    expect(forward?.props.step).toBe(1);
    forward?.props.onValueChange?.(22);
    expect(forwardBufferSec).toBe(22);

    const maxBuffer = bufferNodes.find(
      (node) => node.props.testID === "max-buffer-input",
    );
    expect(maxBuffer?.props.minimumValue).toBe(10);
    expect(maxBuffer?.props.maximumValue).toBe(120);
    expect(maxBuffer?.props.step).toBe(5);
    maxBuffer?.props.onValueChange?.(55);
    expect(maxBufferSec).toBe(55);
  });
});
