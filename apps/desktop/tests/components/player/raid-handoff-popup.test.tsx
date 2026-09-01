import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RaidHandoffPopup } from "@/features/playback/components/raid-handoff/raid-handoff-popup";
import type { RaidHandoffPopupModel } from "@/features/playback/data/use-raid-handoff";
import { RAID_CONTRACT_PROFILES } from "@shared/raid-handoff-types";

function kickModel(overrides: Partial<RaidHandoffPopupModel> = {}): RaidHandoffPopupModel {
  return {
    offer: {
      sessionId: "kick-raid-1",
      platform: "kick",
      source: { platform: "kick", broadcasterUserId: "1", channelSlug: "source" },
      target: { platform: "kick", channelSlug: "target", displayName: "Target" },
      audience: { kind: "target-viewers", count: 1_234 },
      progress: {
        kind: "timed",
        startedAt: 0,
        endsAt: 8_000,
        provenance: "observed-first-party-client",
      },
      launchAuthority: {
        kind: "deadline",
        deadlineAt: 8_000,
        provenance: "observed-first-party-client",
      },
      receivedAt: 0,
      contract: RAID_CONTRACT_PROFILES.kick,
    },
    participation: "joining",
    audienceText: "1,234 watching Target now",
    remainingMs: 4_000,
    progressPercent: 50,
    stayHere: vi.fn(),
    joinRaid: vi.fn(),
    ...overrides,
  };
}

// Guards: the outgoing raid popup labels Kick's count as target viewers, exposes countdown status, and has no ambiguous close control.
// Guards: opting out retains a visible Join raid affordance so the local choice remains reversible.
describe("RaidHandoffPopup", () => {
  it("renders honest target-audience and countdown semantics", () => {
    render(<RaidHandoffPopup model={kickModel()} />);

    expect(screen.getByText("We're raiding Target")).toBeInTheDocument();
    expect(screen.getByText("1,234 watching Target now")).toBeInTheDocument();
    expect(screen.queryByText(/raiders|chatters/i)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Time until raid handoff" })).toHaveAttribute(
      "aria-valuetext",
      "4 seconds remaining"
    );
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("shows the reversible join action after staying", () => {
    const joinRaid = vi.fn();
    render(<RaidHandoffPopup model={kickModel({ participation: "staying", joinRaid })} />);

    fireEvent.click(screen.getByRole("button", { name: "Join raid" }));
    expect(joinRaid).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Stay here" })).not.toBeInTheDocument();
  });
});
