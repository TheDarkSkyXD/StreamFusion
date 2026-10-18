import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { shouldShowBottomNavigation } from "@mobile/features/shell/domain/shell-layout";

const source = readFileSync(
  new URL("../components/app-shell.tsx", import.meta.url),
  "utf8",
);

describe("shell layout", () => {
  it("hides compact bottom navigation while the keyboard is open", () => {
    expect(source).toContain("const keyboard = useKeyboardInset()");
    expect(source).toContain("safeFrameBottomInset({");
    expect(source).toContain('applyKeyboardOverlay: Platform.OS !== "android"');
    const portrait = {
      height: 800,
      width: 390,
      placement: "bottom" as const,
      playerOnlySurface: false,
      keyboardOpen: false,
    };
    expect(shouldShowBottomNavigation(portrait)).toBe(true);
    expect(
      shouldShowBottomNavigation({ ...portrait, keyboardOpen: true }),
    ).toBe(false);
    expect(
      shouldShowBottomNavigation({ ...portrait, playerOnlySurface: true }),
    ).toBe(false);
    expect(
      shouldShowBottomNavigation({ ...portrait, height: 390, width: 800 }),
    ).toBe(false);
    expect(
      shouldShowBottomNavigation({ ...portrait, height: 390, width: 390 }),
    ).toBe(true);
  });

  it("extends bottom tab bar background through the system inset", () => {
    expect(source).toContain("bottomInset={bottomInset}");
    expect(source).toContain(
      'placement === "bottom" ? { paddingBottom: bottomInset } : null',
    );
    expect(source).not.toContain(
      "paddingBottom: bottomNavigationSafeInset(insets.bottom)",
    );
  });

  it("keeps portrait workspace scroll bounds explicit", () => {
    expect(source).toContain("style={styles.screenScroll}");
    expect(source).toMatch(
      /screenScroll:\s*\{[^}]*flex:\s*1,[^}]*minHeight:\s*0,/u,
    );
  });

  it("paints the shell with tab surface so Android under-nav chrome matches", () => {
    expect(source).toMatch(
      /app:\s*\{[\s\S]*?backgroundColor:\s*mobileColors\.surface/u,
    );
    expect(source).toMatch(
      /safeFrame:\s*\{[\s\S]*?backgroundColor:\s*mobileColors\.surface/u,
    );
    expect(source).toContain('applyKeyboardOverlay: Platform.OS !== "android"');
  });
});
