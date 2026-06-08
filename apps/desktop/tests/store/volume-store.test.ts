import { beforeEach, describe, expect, it } from "vitest";

import { useVolumeStore } from "@/store/volume-store";

function resetStore() {
  useVolumeStore.setState({ volume: 100, isMuted: false });
}

beforeEach(() => resetStore());

// Guards: setVolume clamps numeric AND functional updaters into 0–100 so a deep mute via slider drag or scroll-wheel can't smuggle a negative volume into the audio element
// Guards: toggleMute flips isMuted without touching volume — preserves the "mute toggle restores prior level" UX
describe("volume-store initial state", () => {
  it("starts at volume 100 and unmuted", () => {
    expect(useVolumeStore.getState().volume).toBe(100);
    expect(useVolumeStore.getState().isMuted).toBe(false);
  });
});

describe("volume-store setVolume", () => {
  it("sets volume with a numeric value", () => {
    useVolumeStore.getState().setVolume(50);
    expect(useVolumeStore.getState().volume).toBe(50);
  });

  it("sets volume with a function updater", () => {
    useVolumeStore.getState().setVolume(80);
    useVolumeStore.getState().setVolume((prev) => prev - 10);
    expect(useVolumeStore.getState().volume).toBe(70);
  });

  it("clamps volume to 0 at the low end", () => {
    useVolumeStore.getState().setVolume(-10);
    expect(useVolumeStore.getState().volume).toBe(0);
  });

  it("clamps volume to 100 at the high end", () => {
    useVolumeStore.getState().setVolume(200);
    expect(useVolumeStore.getState().volume).toBe(100);
  });

  it("clamps functional updates too", () => {
    useVolumeStore.getState().setVolume(() => -50);
    expect(useVolumeStore.getState().volume).toBe(0);
    useVolumeStore.getState().setVolume(() => 999);
    expect(useVolumeStore.getState().volume).toBe(100);
  });
});

describe("volume-store toggleMute", () => {
  it("toggles mute state", () => {
    expect(useVolumeStore.getState().isMuted).toBe(false);
    useVolumeStore.getState().toggleMute();
    expect(useVolumeStore.getState().isMuted).toBe(true);
    useVolumeStore.getState().toggleMute();
    expect(useVolumeStore.getState().isMuted).toBe(false);
  });
});
