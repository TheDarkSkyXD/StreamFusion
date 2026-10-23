import { describe, expect, it, vi } from "vitest";
import {
  measureProtectedPlayerLayout,
  observeProtectedPlayerLayout,
  observeProtectedPlayerOcclusion,
} from "@/features/playback/adapters/electron/protected-player-layout";

describe("protected player layout", () => {
  it("keeps full player bounds while clipping paint and input through overflow parents", () => {
    const parent = document.createElement("div");
    const player = document.createElement("div");
    parent.style.overflow = "hidden";
    parent.appendChild(player);
    document.body.appendChild(parent);
    parent.getBoundingClientRect = () => new DOMRect(20, 30, 300, 180);
    player.getBoundingClientRect = () => new DOMRect(10, 10, 320, 180);
    const layout = measureProtectedPlayerLayout(player);
    expect(layout).toEqual({
      kind: "visible",
      boundsCss: { x: 10, y: 10, width: 320, height: 180 },
      clipCss: { x: 20, y: 30, width: 300, height: 160 },
      radiusCss: 0,
    });
    parent.remove();
  });

  it("holds an overlapping app dialog invisible until native hide is acknowledged", async () => {
    const player = document.createElement("div");
    player.getBoundingClientRect = () => new DOMRect(10, 10, 320, 180);
    document.body.appendChild(player);
    let acknowledge!: () => void;
    const hidden = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const change = vi.fn((occluded: boolean) => (occluded ? hidden : Promise.resolve()));
    const stop = observeProtectedPlayerOcclusion(player, change);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.getBoundingClientRect = () => new DOMRect(20, 20, 100, 100);
    document.body.appendChild(dialog);
    await vi.waitFor(() => expect(change).toHaveBeenCalledWith(true));
    expect(dialog.style.opacity).toBe("0");
    acknowledge();
    await vi.waitFor(() => expect(dialog.style.opacity).toBe(""));
    dialog.remove();
    await vi.waitFor(() => expect(change).toHaveBeenCalledWith(false));
    stop();
    player.remove();
  });

  it("follows the portal into a new mini ancestor for drag transforms", async () => {
    const dock = document.createElement("div");
    const mini = document.createElement("div");
    const player = document.createElement("div");
    dock.appendChild(player);
    document.body.append(dock, mini);
    const change = vi.fn();
    const stop = observeProtectedPlayerLayout(player, change);
    await vi.waitFor(() => expect(change).toHaveBeenCalled());
    mini.appendChild(player);
    await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    mini.style.transform = "translate3d(40px, 20px, 0)";
    await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(3));
    stop();
    dock.remove();
    mini.remove();
  });
});
