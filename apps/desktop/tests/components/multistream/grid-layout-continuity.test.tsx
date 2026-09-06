import { type HTMLAttributes, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from "../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

type MockStream = {
  id: string;
  platform: "twitch" | "kick";
  channelName: string;
  isMuted: boolean;
};

let mockState: {
  streams: MockStream[];
  layout: "grid" | "focus";
  focusedStreamId: string | null;
  playbackBudget: number;
};

vi.mock("@/features/multistream/data/multistream-store", () => ({
  useMultiStreamStore: (selector: (state: unknown) => unknown) =>
    selector({
      ...mockState,
      removeStream: vi.fn(),
      setFocusedStream: vi.fn(),
      toggleMute: vi.fn(),
      reorderStreams: vi.fn(),
    }),
}));

const mountCounts = new Map<string, number>();
const cleanupCounts = new Map<string, number>();

vi.mock("@/features/multistream/components/multistream/stream-slot", () => ({
  StreamSlot: ({
    streamId,
    dragHandleProps,
  }: {
    streamId: string;
    dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  }) => {
    const [mountId] = useState(() => {
      const count = (mountCounts.get(streamId) ?? 0) + 1;
      mountCounts.set(streamId, count);
      return `${streamId}:${count}`;
    });

    useEffect(
      () => () => {
        cleanupCounts.set(streamId, (cleanupCounts.get(streamId) ?? 0) + 1);
      },
      [streamId]
    );

    return (
      <div data-testid={`slot-${streamId}`} data-mount-id={mountId}>
        {dragHandleProps && <button aria-label={`drag-${streamId}`} {...dragHandleProps} />}
      </div>
    );
  },
}));

import { MultiStreamGrid } from "@/features/multistream/components/multistream/grid-layout";

// Guards: layout changes, focus changes, and grid reordering must retain each active player's mounted DOM and media lifetime.
// Guards: grid reordering changes visual placement without moving the mounted slot hosts in DOM order.
describe("MultiStreamGrid playback continuity", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps active stream slots mounted across layout and focus changes", () => {
    installElectronAPIMock();
    mountCounts.clear();
    cleanupCounts.clear();
    const streams: MockStream[] = [
      { id: "s1", platform: "twitch", channelName: "alpha", isMuted: false },
      { id: "s2", platform: "kick", channelName: "beta", isMuted: true },
    ];
    mockState = { streams, layout: "grid", focusedStreamId: null, playbackBudget: 2 };

    const view = renderWithProviders(<MultiStreamGrid />);
    const initialSlots = new Map(
      streams.map((stream) => [stream.id, screen.getByTestId(`slot-${stream.id}`)])
    );
    expect(screen.getAllByRole("button", { name: /^drag-/ })).toHaveLength(2);

    mockState = { streams, layout: "focus", focusedStreamId: "s1", playbackBudget: 2 };
    view.rerender(<MultiStreamGrid />);
    expect(screen.queryByRole("button", { name: /^drag-/ })).not.toBeInTheDocument();

    mockState = { streams, layout: "focus", focusedStreamId: "s2", playbackBudget: 2 };
    view.rerender(<MultiStreamGrid />);

    mockState = { streams, layout: "grid", focusedStreamId: null, playbackBudget: 2 };
    view.rerender(<MultiStreamGrid />);
    expect(screen.getAllByRole("button", { name: /^drag-/ })).toHaveLength(2);

    mockState = {
      streams: [...streams].reverse(),
      layout: "grid",
      focusedStreamId: null,
      playbackBudget: 2,
    };
    view.rerender(<MultiStreamGrid />);

    for (const stream of streams) {
      expect(screen.getByTestId(`slot-${stream.id}`)).toBe(initialSlots.get(stream.id));
      expect(mountCounts.get(stream.id)).toBe(1);
      expect(cleanupCounts.get(stream.id) ?? 0).toBe(0);
    }
  });

  it("reorders grid placement without reordering the mounted slot hosts", () => {
    installElectronAPIMock();
    const streams: MockStream[] = [
      { id: "s1", platform: "twitch", channelName: "alpha", isMuted: false },
      { id: "s2", platform: "kick", channelName: "beta", isMuted: true },
    ];
    mockState = { streams, layout: "grid", focusedStreamId: null, playbackBudget: 2 };

    const view = renderWithProviders(<MultiStreamGrid />);
    const layout = view.container.querySelector<HTMLElement>('[data-layout="grid"]');

    mockState = {
      streams: [...streams].reverse(),
      layout: "grid",
      focusedStreamId: null,
      playbackBudget: 2,
    };
    view.rerender(<MultiStreamGrid />);

    const placements = Array.from(
      layout?.querySelectorAll<HTMLElement>(":scope > [data-stream-placement]") ?? []
    );
    expect(
      placements.map(
        (placement) => placement.querySelector<HTMLElement>("[data-testid]")?.dataset.testid
      )
    ).toEqual(["slot-s1", "slot-s2"]);
    expect(placements.map((placement) => placement.style.order)).toEqual(["1", "0"]);
  });

  it("keeps a 16:9 focused stage above a horizontally scrolling rail", async () => {
    installElectronAPIMock();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 748,
      height: 748,
      left: 0,
      right: 824,
      top: 0,
      width: 824,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    mockState = {
      streams: [
        { id: "s1", platform: "twitch", channelName: "alpha", isMuted: false },
        { id: "s2", platform: "kick", channelName: "beta", isMuted: true },
      ],
      layout: "focus",
      focusedStreamId: "s1",
      playbackBudget: 2,
    };

    const view = renderWithProviders(<MultiStreamGrid />);

    await waitFor(() => {
      const layout = view.container.querySelector<HTMLElement>('[data-layout="focus"]');
      const focused = view.container.querySelector<HTMLElement>(
        '[data-stream-placement="focused"]'
      );
      const rail = view.container.querySelector<HTMLElement>('[data-stream-placement="rail"]');
      const focusedFrame = focused?.firstElementChild;
      const railFrame = rail?.firstElementChild;
      if (!(focusedFrame instanceof HTMLElement) || !(railFrame instanceof HTMLElement)) {
        throw new Error("Expected focused and rail frames");
      }

      expect(layout?.style.overflowX).toBe("auto");
      expect(
        Number.parseFloat(focusedFrame?.style.width ?? "0") /
          Number.parseFloat(focusedFrame?.style.height ?? "1")
      ).toBeCloseTo(16 / 9, 2);
      expect(
        Number.parseFloat(railFrame?.style.width ?? "0") /
          Number.parseFloat(railFrame?.style.height ?? "1")
      ).toBeCloseTo(16 / 9, 2);
    });
  });
});
