import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Switch } from "@/components/ui/switch";

// Guards: app switches keep Twitch's 36x20 outlined-pill style with a 14px thumb and centered checked-state check icon.
describe("Switch", () => {
  it("renders a Twitch-style switch track, thumb, and checked icon", () => {
    render(<Switch aria-label="Example switch" checked />);

    const root = screen.getByRole("switch", { name: "Example switch" });
    const thumb = root.querySelector("[data-state]") as HTMLElement;
    const check = root.querySelector(".sf-switch-check") as SVGElement;
    const checkPath = check.querySelector("path") as SVGPathElement;

    expect(root).toHaveClass(
      "sf-switch",
      "relative",
      "h-5",
      "w-9",
      "rounded-[12px]",
      "border-2",
      "p-0"
    );
    expect(root).toHaveClass("focus-visible:ring-[#efeff1]");
    expect(root.className).not.toContain("purple");
    expect(root.className).not.toContain("data-[state=checked]:bg-white");
    expect(thumb).toHaveClass(
      "sf-switch-thumb",
      "h-[14px]",
      "w-[14px]",
      "rounded-full",
      "bg-white"
    );
    expect(thumb).toHaveClass("translate-x-[2px]");
    expect(thumb).toHaveClass("data-[state=checked]:translate-x-[18px]");
    expect(thumb).toHaveClass("data-[state=unchecked]:translate-x-[2px]");
    expect(check).toHaveClass("sf-switch-check");
    expect(checkPath).toHaveAttribute("d", "m13 6-6 6-4-4 1.5-1.5L7 9l4.5-4.5L13 6Z");
  });

  it("keeps the checked icon centered in Twitch's left switch lane", () => {
    const css = readFileSync("src/frontend/global.css", "utf8");

    expect(css).toContain(".sf-switch-check");
    expect(css).toContain("top: 0;");
    expect(css).toContain("left: 1px;");
    expect(css).toContain("width: 14px;");
    expect(css).toContain("height: 14px;");
  });
});
