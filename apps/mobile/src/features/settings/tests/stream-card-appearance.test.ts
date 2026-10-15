// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_PRODUCT_PREFERENCES } from "@streamfusion/core/settings";
import { AppearanceSettingsPanel } from "../components/settings-panels";
import { composeSettingsView } from "../domain/settings-view";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../components/settings-controls", () => ({
  SettingsSection: ({ children }: { readonly children: ReactNode }) =>
    createElement("section", null, children),
  SettingsSwitch: ({
    checked,
    label,
    onToggle,
    testID,
  }: {
    readonly checked: boolean;
    readonly label: string;
    readonly onToggle: () => void;
    readonly testID: string;
  }) =>
    createElement(
      "button",
      { "data-checked": checked, "data-testid": testID, onClick: onToggle },
      label,
    ),
  SettingsCopy: () => null,
  SettingsSelect: () => null,
  SettingsLanguagePicker: () => null,
  SettingsSlider: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Appearance stream card setting", () => {
  it("shows a compact-default switch and applies the large choice", () => {
    const patches: unknown[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        createElement(AppearanceSettingsPanel, {
          onChange: (patch) => patches.push(patch),
          view: composeSettingsView({
            preferences: DEFAULT_PRODUCT_PREFERENCES,
          }),
        }),
      );
    });
    try {
      const switchButton = container.querySelector(
        '[data-testid="large-stream-cards"]',
      );
      expect(switchButton?.textContent).toBe("Show large stream cards");
      expect(switchButton?.getAttribute("data-checked")).toBe("false");
      if (!(switchButton instanceof HTMLElement)) {
        throw new Error("Missing stream card switch");
      }
      act(() => switchButton.click());
      expect(patches).toEqual([{ showLargeStreamCards: true }]);
    } finally {
      act(() => root.unmount());
    }
  });
});
