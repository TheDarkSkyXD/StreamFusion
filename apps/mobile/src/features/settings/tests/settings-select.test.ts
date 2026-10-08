// @vitest-environment jsdom

import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSelect } from "../components/settings-controls";

vi.mock("react-native", () => {
  type HostProps = {
    readonly accessibilityLabel?: string;
    readonly children?: ReactNode;
    readonly disabled?: boolean;
    readonly onPress?: () => void;
    readonly role?: string;
    readonly testID?: string;
    readonly visible?: boolean;
  };
  const host = (tag: string) =>
    function Host(props: HostProps) {
      return createElement(
        tag,
        {
          "aria-label": props.accessibilityLabel,
          "data-testid": props.testID,
          disabled: props.disabled,
          onClick: props.onPress,
          role: props.role,
        },
        props.children,
      );
    };
  return {
    KeyboardAvoidingView: host("div"),
    Modal: (props: HostProps) => (props.visible ? host("div")(props) : null),
    Platform: { OS: "android" },
    Pressable: host("button"),
    ScrollView: host("div"),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host("span"),
    View: host("div"),
  };
});

vi.mock("lucide-react-native", () => ({ ChevronDown: () => null }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

describe("settings selection", () => {
  it("opens from the row label, saves numeric choices, and dismisses without changing the value", async () => {
    const selections: number[] = [];
    function SpeedPicker() {
      const [current, setCurrent] = useState(1);
      return createElement(SettingsSelect<number>, {
        current,
        label: "Playback speed",
        detail: "Choose a speed for recorded videos.",
        onSelect: (value) => {
          selections.push(value);
          setCurrent(value);
        },
        options: [
          { label: "Normal", value: 1 },
          { label: "1.5×", value: 1.5 },
        ],
        testID: "speed",
      });
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(SpeedPicker)));
    const trigger = container.querySelector<HTMLButtonElement>(
      "[data-testid='speed-picker-trigger']",
    );
    if (!trigger) throw new Error("Missing speed picker");
    const label = [...trigger.querySelectorAll("span")].find(
      (node) => node.textContent === "Playback speed",
    );
    if (!label) throw new Error("Missing picker label");
    await act(async () => label.click());
    const choice = container.querySelector<HTMLButtonElement>(
      "[data-testid='speed-picker-option-1.5']",
    );
    if (!choice) throw new Error("Missing speed choice");
    await act(async () => choice.click());
    expect(selections).toEqual([1.5]);
    expect(trigger.getAttribute("aria-label")).toBe("Playback speed, 1.5×");
    expect(
      container.querySelector("[data-testid='speed-picker-menu']"),
    ).toBeNull();
    await act(async () => trigger.click());
    const close = container.querySelector<HTMLButtonElement>(
      "[aria-label='Close sheet']",
    );
    if (!close) throw new Error("Missing sheet close button");
    await act(async () => close.click());
    expect(trigger.getAttribute("aria-label")).toBe("Playback speed, 1.5×");
    expect(selections).toEqual([1.5]);
    expect(
      container.querySelector("[data-testid='speed-picker-menu']"),
    ).toBeNull();
  });
});
