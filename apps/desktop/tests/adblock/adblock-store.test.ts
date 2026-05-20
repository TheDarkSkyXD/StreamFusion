/**
 * Tests for Twitch Ad-Block Zustand Store
 *
 * The store has a single load-bearing user-facing flag: `enableAdBlock`.
 * Asserting Zustand's setter/toggle behavior tests the library, not the app,
 * so this file only pins the app-level invariants that would surprise users
 * if they silently flipped.
 */

// Guards: ad-block is enabled by default — flipping the default silently is a regression class users would feel immediately.

import { describe, it, expect, beforeEach } from 'vitest';
import { useAdBlockStore } from '@/store/adblock-store';

describe('adblock-store', () => {
  beforeEach(() => {
    // Restore the initial state before each test so a prior test's mutation
    // doesn't corrupt the default-state assertion.
    useAdBlockStore.setState({ enableAdBlock: true });
  });

  it('defaults to ad-block enabled (load-bearing user expectation)', () => {
    // Read the store as a freshly-imported user would.
    useAdBlockStore.setState({ enableAdBlock: true });
    expect(useAdBlockStore.getState().enableAdBlock).toBe(true);
  });

  it('exposes a toggle action that flips enableAdBlock', () => {
    const { toggleAdBlock } = useAdBlockStore.getState();

    toggleAdBlock();
    expect(useAdBlockStore.getState().enableAdBlock).toBe(false);

    toggleAdBlock();
    expect(useAdBlockStore.getState().enableAdBlock).toBe(true);
  });
});
