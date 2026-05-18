import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimeoutDurationPicker } from "@/components/chat/mod/TimeoutDurationPicker";

const PRESETS: Array<{ label: string; seconds: number }> = [
  { label: "10s", seconds: 10 },
  { label: "1m", seconds: 60 },
  { label: "10m", seconds: 600 },
  { label: "30m", seconds: 1800 },
  { label: "24h", seconds: 86_400 },
  { label: "7d", seconds: 604_800 },
];

describe("TimeoutDurationPicker", () => {
  it("renders exactly 6 chips with the AE3 preset labels", () => {
    render(<TimeoutDurationPicker disabled={false} onChange={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(6);
    for (const { label } of PRESETS) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${label}$`) }),
      ).toBeInTheDocument();
    }
  });

  it("defaults to the 10m chip and fires onChange(600) once on mount", () => {
    const onChange = vi.fn();
    render(<TimeoutDurationPicker disabled={false} onChange={onChange} />);
    const tenMinutes = screen.getByRole("button", { name: /^10m$/ });
    expect(tenMinutes).toHaveAttribute("data-selected", "true");
    // The other five chips are not selected.
    for (const { label } of PRESETS.filter((p) => p.label !== "10m")) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${label}$`) }),
      ).toHaveAttribute("data-selected", "false");
    }
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(600);
  });

  it.each(PRESETS)(
    "clicking the $label chip fires onChange($seconds)",
    ({ label, seconds }) => {
      const onChange = vi.fn();
      render(<TimeoutDurationPicker disabled={false} onChange={onChange} />);
      // Reset to ignore the on-mount default-emit so we assert only the click.
      onChange.mockClear();
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(`^${label}$`) }),
      );
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(seconds);
    },
  );

  it("disables every chip when disabled=true", () => {
    render(<TimeoutDurationPicker disabled={true} onChange={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(6);
    for (const btn of buttons) {
      expect(btn).toBeDisabled();
    }
  });

  it("does not render any custom-duration input (AE3 — exactly six chips)", () => {
    render(<TimeoutDurationPicker disabled={false} onChange={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});
