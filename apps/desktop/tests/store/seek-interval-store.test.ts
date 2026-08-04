import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SEEK_INTERVAL_SECONDS,
  SEEK_INTERVAL_STORAGE_KEY,
  SEEK_INTERVAL_STORE_VERSION,
  migrateSeekIntervalState,
  useSeekIntervalStore,
} from "@/store/seek-interval-store";

beforeEach(() => {
  localStorage.clear();
  useSeekIntervalStore.setState({
    rewindSeconds: DEFAULT_SEEK_INTERVAL_SECONDS,
    forwardSeconds: DEFAULT_SEEK_INTERVAL_SECONDS,
  });
});

// Guards: fresh installs must use Xtra's independent ten-second rewind and fast-forward defaults.
// Guards: independently configured whole-second intervals, including zero, must survive rehydration.
// Guards: missing, partial, or corrupt legacy payloads must hydrate each interval safely.
// Guards: invalid setter values must never enter the persisted seek-interval state.
describe("seek-interval-store", () => {
  it("defaults rewind and fast forward to ten seconds", () => {
    const state = useSeekIntervalStore.getState();

    expect(state.rewindSeconds).toBe(10);
    expect(state.forwardSeconds).toBe(10);
  });

  it("persists independent whole nonnegative intervals across rehydration", async () => {
    useSeekIntervalStore.getState().setRewindSeconds(0);
    useSeekIntervalStore.getState().setForwardSeconds(25);
    const saved = localStorage.getItem(SEEK_INTERVAL_STORAGE_KEY);

    useSeekIntervalStore.setState({
      rewindSeconds: DEFAULT_SEEK_INTERVAL_SECONDS,
      forwardSeconds: DEFAULT_SEEK_INTERVAL_SECONDS,
    });
    localStorage.setItem(SEEK_INTERVAL_STORAGE_KEY, saved!);
    await useSeekIntervalStore.persist.rehydrate();

    expect(useSeekIntervalStore.getState().rewindSeconds).toBe(0);
    expect(useSeekIntervalStore.getState().forwardSeconds).toBe(25);
  });

  it("normalizes corrupt current-version intervals during real rehydration", async () => {
    localStorage.setItem(
      SEEK_INTERVAL_STORAGE_KEY,
      JSON.stringify({
        state: { rewindSeconds: -1, forwardSeconds: 1.5 },
        version: SEEK_INTERVAL_STORE_VERSION,
      })
    );

    await useSeekIntervalStore.persist.rehydrate();

    expect(useSeekIntervalStore.getState().rewindSeconds).toBe(DEFAULT_SEEK_INTERVAL_SECONDS);
    expect(useSeekIntervalStore.getState().forwardSeconds).toBe(DEFAULT_SEEK_INTERVAL_SECONDS);
  });

  it("migrates a missing legacy payload to both defaults", () => {
    expect(migrateSeekIntervalState(undefined)).toEqual({
      rewindSeconds: 10,
      forwardSeconds: 10,
    });
  });

  it("preserves an independent legacy value while defaulting its missing sibling", () => {
    expect(migrateSeekIntervalState({ rewindSeconds: 0 })).toEqual({
      rewindSeconds: 0,
      forwardSeconds: 10,
    });
  });

  it("defaults corrupt negative and fractional legacy intervals independently", () => {
    expect(migrateSeekIntervalState({ rewindSeconds: -1, forwardSeconds: 1.5 })).toEqual({
      rewindSeconds: 10,
      forwardSeconds: 10,
    });
  });

  it("keeps invalid setter values out of the persisted public state", () => {
    useSeekIntervalStore.getState().setRewindSeconds(-1);
    useSeekIntervalStore.getState().setForwardSeconds(1.5);

    expect(useSeekIntervalStore.getState().rewindSeconds).toBe(10);
    expect(useSeekIntervalStore.getState().forwardSeconds).toBe(10);
  });
});
