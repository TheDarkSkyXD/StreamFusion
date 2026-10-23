import { act } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";

vi.mock("@/features/playback/components/player/twitch/twitch-live-player", () => ({
  TwitchLivePlayer: ({ isTheater }: { isTheater?: boolean }) => (
    <button type="button" aria-label={isTheater ? "Exit Theater Mode" : "Theater Mode"} />
  ),
}));

describe("protected mini player drag", () => {
  it("reports pointer travel after the host moves beneath the pointer", async () => {
    const messages: string[] = [];
    let receive: (event: { data: unknown }) => void = () => {};
    Object.defineProperty(window, "chrome", {
      configurable: true,
      value: {
        webview: {
          postMessage: (message: string) => messages.push(message),
          addEventListener: (_type: string, listener: typeof receive) => {
            receive = listener;
          },
          removeEventListener: vi.fn(),
        },
      },
    });
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          channelSlug: "testchannel",
          masterUrl: "https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8",
          blockerEnabled: true,
          volume: 50,
          muted: false,
          preferences: DEFAULT_USER_PREFERENCES,
        }),
      })
    );

    await import("../../composition/protected-player-entry");
    await act(async () => {
      receive({ data: { type: "bootstrap", baseUrl: `http://127.0.0.1:1/s/${"a".repeat(64)}` } });
    });
    act(() => {
      receive({ data: { type: "presentation", presentation: "mini", blockerEnabled: true } });
    });
    expect(screen.getByRole("button", { name: "Theater Mode" })).toBeTruthy();

    const topbar = screen.getByRole("button", { name: "Restore stream" }).parentElement;
    if (!topbar) throw new Error("Mini player topbar missing");
    fireEvent.pointerDown(topbar, {
      pointerId: 1,
      screenX: 1245,
      screenY: 670,
      clientX: 100,
      clientY: 20,
    });
    fireEvent.pointerMove(topbar, {
      pointerId: 1,
      screenX: 1145,
      screenY: 620,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerMove(topbar, {
      pointerId: 1,
      screenX: 1045,
      screenY: 570,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerUp(topbar, { pointerId: 1 });

    const drags = messages
      .filter((message) => message.startsWith('{"type":"drag",'))
      .map((message) => JSON.parse(message));
    expect(drags).toEqual([
      { type: "drag", dx: -100, dy: -50 },
      { type: "drag", dx: -100, dy: -50 },
    ]);

    act(() => {
      receive({
        data: { type: "presentation", presentation: "mini", blockerEnabled: true, zoom: 1.25 },
      });
    });
    fireEvent.pointerDown(topbar, {
      pointerId: 2,
      screenX: 1000,
      screenY: 600,
      clientX: 100,
      clientY: 20,
    });
    fireEvent.pointerMove(topbar, {
      pointerId: 2,
      screenX: 875,
      screenY: 537.5,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerMove(topbar, {
      pointerId: 2,
      screenX: 750,
      screenY: 475,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerUp(topbar, { pointerId: 2 });

    const zoomedDrags = messages
      .filter((message) => message.startsWith('{"type":"drag",'))
      .slice(2)
      .map((message) => JSON.parse(message));
    expect(zoomedDrags).toEqual([
      { type: "drag", dx: -100, dy: -50 },
      { type: "drag", dx: -100, dy: -50 },
    ]);

    act(() => {
      receive({
        data: { type: "presentation", presentation: "theater", blockerEnabled: true, zoom: 1.25 },
      });
    });
    expect(screen.getByRole("button", { name: "Exit Theater Mode" })).toBeTruthy();

    act(() => {
      receive({
        data: { type: "presentation", presentation: "docked", blockerEnabled: true, zoom: 1.25 },
      });
    });
    expect(screen.getByRole("button", { name: "Theater Mode" })).toBeTruthy();
  });
});
