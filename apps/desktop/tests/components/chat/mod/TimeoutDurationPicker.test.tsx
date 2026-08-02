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
  it("renders the six Twitch presets plus Custom", () => {
    render(<TimeoutDurationPicker disabled={false} onChange={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(7);
    for (const { label } of PRESETS) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();
  });

  it("defaults to 10m and reports the policy's native unit", () => {
    const onTwitchChange = vi.fn();
    const { unmount } = render(
      <TimeoutDurationPicker disabled={false} onChange={onTwitchChange} />
    );
    expect(screen.getByRole("button", { name: "10m" })).toHaveAttribute("data-selected", "true");
    expect(onTwitchChange).toHaveBeenCalledWith(600);
    unmount();

    const onKickChange = vi.fn();
    render(
      <TimeoutDurationPicker
        disabled={false}
        policy={{
          durationUnit: "minutes",
          minDuration: 1,
          maxDuration: 10_080,
          supportsReason: true,
          maxReasonLength: 100,
        }}
        onChange={onKickChange}
      />
    );
    expect(screen.queryByRole("button", { name: "10s" })).toBeNull();
    expect(screen.getByRole("button", { name: "10m" })).toHaveAttribute("data-selected", "true");
    expect(onKickChange).toHaveBeenCalledWith(10);
  });

  it.each(PRESETS)("clicking $label reports $seconds seconds", ({ label, seconds }) => {
    const onChange = vi.fn();
    render(<TimeoutDurationPicker disabled={false} onChange={onChange} />);
    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onChange).toHaveBeenCalledWith(seconds);
  });

  it("validates a whole-minute Custom value inline", () => {
    const onValidationChange = vi.fn();
    render(
      <TimeoutDurationPicker
        disabled={false}
        policy={{
          durationUnit: "minutes",
          minDuration: 1,
          maxDuration: 10_080,
          supportsReason: true,
          maxReasonLength: 100,
        }}
        onChange={() => {}}
        onValidationChange={onValidationChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const input = screen.getByRole("spinbutton", { name: "Custom duration in minutes" });
    fireEvent.change(input, { target: { value: "0.5" } });
    expect(screen.getByText("Enter a whole number from 1 to 10080 minutes.")).toBeInTheDocument();
    expect(onValidationChange).toHaveBeenLastCalledWith(false);
  });

  it("disables presets and Custom when pending", () => {
    render(<TimeoutDurationPicker disabled onChange={() => {}} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
