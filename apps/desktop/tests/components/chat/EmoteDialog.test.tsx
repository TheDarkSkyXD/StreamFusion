import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Emote, EmoteProvider } from '@/backend/services/emotes/emote-types';

/* ------------------------------------------------------------------------- */
/* Mutable store mock (selector-capable, mirrors EmotePicker.test pattern)   */
/* ------------------------------------------------------------------------- */

interface MockState {
  loadedGlobalPlatforms: Set<'twitch' | 'kick'>;
  loadedChannels: Set<string>;
  activeChannelId: string | null;
  favoriteEmotes: Emote[];
  recentEmotes: Emote[];
  isLoading: boolean;
  emotesByProvider: Map<EmoteProvider, Emote[]>;
  getEmotesByProvider: () => Map<EmoteProvider, Emote[]>;
  addRecentEmote: ReturnType<typeof vi.fn>;
  toggleFavorite: ReturnType<typeof vi.fn>;
  isFavorite: (id: string) => boolean;
  favoriteIds: Set<string>;
}

const mockState: MockState = {
  loadedGlobalPlatforms: new Set(['twitch']),
  loadedChannels: new Set(),
  activeChannelId: null,
  favoriteEmotes: [],
  recentEmotes: [],
  isLoading: false,
  emotesByProvider: new Map(),
  getEmotesByProvider: () => mockState.emotesByProvider,
  addRecentEmote: vi.fn(),
  toggleFavorite: vi.fn(),
  isFavorite: (id: string) => mockState.favoriteIds.has(id),
  favoriteIds: new Set(),
};

vi.mock('@/store/emote-store', () => ({
  useEmoteStore: (selector?: (s: MockState) => unknown) =>
    selector ? selector(mockState) : mockState,
}));

/* ------------------------------------------------------------------------- */
/* Controllable IntersectionObserver mock                                    */
/* ------------------------------------------------------------------------- */

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
interface RegisteredObserver {
  callback: IOCallback;
  elements: Set<Element>;
}
const observers: RegisteredObserver[] = [];

class MockIntersectionObserver {
  private record: RegisteredObserver;
  constructor(callback: IOCallback) {
    this.record = { callback, elements: new Set() };
    observers.push(this.record);
  }
  observe(el: Element) {
    this.record.elements.add(el);
  }
  unobserve(el: Element) {
    this.record.elements.delete(el);
  }
  disconnect() {
    this.record.elements.clear();
    const idx = observers.indexOf(this.record);
    if (idx >= 0) observers.splice(idx, 1);
  }
  takeRecords() {
    return [];
  }
}

function triggerAllIntersect() {
  // Snapshot to avoid mutation while iterating (disconnect on observer cleanup).
  const snapshot = observers.slice();
  for (const o of snapshot) {
    o.callback([{ isIntersecting: true }]);
  }
}

beforeEach(() => {
  // Reset state
  mockState.recentEmotes = [];
  mockState.favoriteEmotes = [];
  mockState.emotesByProvider = new Map();
  mockState.favoriteIds = new Set();
  mockState.addRecentEmote.mockReset();
  mockState.toggleFavorite.mockReset();
  observers.length = 0;
  // Install controllable IO
  (globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  observers.length = 0;
});

import { EmoteDialog } from '@/components/chat/EmoteDialog';

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function makeEmote(partial: Partial<Emote> & { id: string; name: string; provider: EmoteProvider }): Emote {
  return {
    id: partial.id,
    name: partial.name,
    provider: partial.provider,
    isGlobal: partial.isGlobal ?? false,
    isAnimated: partial.isAnimated ?? false,
    isZeroWidth: partial.isZeroWidth ?? false,
    channelId: partial.channelId,
    urls: partial.urls ?? {
      url1x: `https://example.test/${partial.id}/1x.webp`,
      url2x: `https://example.test/${partial.id}/2x.webp`,
    },
    owner: partial.owner,
    subscribersOnly: partial.subscribersOnly,
  };
}

function renderDialog(props: Partial<React.ComponentProps<typeof EmoteDialog>> = {}) {
  // Create a real anchor element attached to the DOM.
  const anchor = document.createElement('button');
  anchor.textContent = 'anchor';
  document.body.appendChild(anchor);
  const anchorRef = { current: anchor } as React.RefObject<HTMLElement>;
  const onClose = props.onClose ?? vi.fn();
  const onSelect = props.onSelect ?? vi.fn();
  const utils = render(
    <EmoteDialog
      isOpen={props.isOpen ?? true}
      onClose={onClose}
      onSelect={onSelect}
      anchorRef={anchorRef}
      scope={props.scope ?? 'native'}
      platform={props.platform ?? 'kick'}
      channelId={props.channelId ?? 'chan-1'}
      viewerIsSubscribed={props.viewerIsSubscribed}
    />
  );
  return { ...utils, onClose, onSelect, anchor };
}

function findSection(title: string): HTMLElement | null {
  const heading = screen.queryByRole('button', { name: new RegExp(`^${title}`, 'i'), expanded: true })
    ?? screen.queryByRole('button', { name: new RegExp(`^${title}`, 'i') });
  if (!heading) return null;
  return heading.parentElement;
}

/* ------------------------------------------------------------------------- */
/* Tests                                                                     */
/* ------------------------------------------------------------------------- */

describe('EmoteDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders Kick provider section only for scope=native platform=kick', () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ['kick', [makeEmote({ id: 'k1', name: 'kickHype', provider: 'kick' })]],
      ['7tv', [makeEmote({ id: 's1', name: 'PogChamp', provider: '7tv' })]],
    ]);
    renderDialog({ scope: 'native', platform: 'kick' });
    expect(screen.getByRole('button', { name: /^Kick/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^7TV/ })).not.toBeInTheDocument();
  });

  it('renders 7TV, BTTV, FFZ sections for scope=thirdParty platform=twitch', () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ['7tv', [makeEmote({ id: 's1', name: 'PogChamp', provider: '7tv' })]],
      ['bttv', [makeEmote({ id: 'b1', name: 'monkaS', provider: 'bttv' })]],
      ['ffz', [makeEmote({ id: 'f1', name: 'OhMyDog', provider: 'ffz' })]],
    ]);
    renderDialog({ scope: 'thirdParty', platform: 'twitch' });
    // Section header buttons have aria-expanded; sub-section icons have aria-pressed.
    expect(screen.getByRole('button', { name: /^7TV/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^BetterTTV/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^FrankerFaceZ/, expanded: true })).toBeInTheDocument();
  });

  it('pins Recent and Favorites at the top of the body', () => {
    mockState.recentEmotes = [makeEmote({ id: 'k1', name: 'kickHype', provider: 'kick' })];
    mockState.favoriteEmotes = [makeEmote({ id: 'k2', name: 'kickFav', provider: 'kick' })];
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ['kick', [makeEmote({ id: 'k3', name: 'kickEmote', provider: 'kick' })]],
    ]);
    renderDialog({ scope: 'native', platform: 'kick' });
    const headings = screen.getAllByRole('button', { name: /^(Recent|Favorites|Kick)/ });
    const titles = headings.map((h) => h.textContent ?? '');
    const recentIdx = titles.findIndex((t) => t.startsWith('Recent'));
    const favoritesIdx = titles.findIndex((t) => t.startsWith('Favorites'));
    const kickIdx = titles.findIndex((t) => t.startsWith('Kick'));
    expect(recentIdx).toBeLessThan(kickIdx);
    expect(favoritesIdx).toBeLessThan(kickIdx);
  });

  it('filters Recent to scope providers', () => {
    mockState.recentEmotes = [
      makeEmote({ id: 'k1', name: 'kickHype', provider: 'kick' }),
      makeEmote({ id: 's1', name: 'PogChamp', provider: '7tv' }),
    ];
    renderDialog({ scope: 'native', platform: 'kick' });
    // Only kickHype should appear in Recent (scoped to kick provider).
    expect(screen.getByLabelText('kickHype')).toBeInTheDocument();
    expect(screen.queryByLabelText('PogChamp')).not.toBeInTheDocument();
  });

  it('filters by search within scope', () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ['7tv', [
        makeEmote({ id: 's1', name: 'PogChamp', provider: '7tv' }),
        makeEmote({ id: 's2', name: 'KEKW', provider: '7tv' }),
      ]],
      ['bttv', [makeEmote({ id: 'b1', name: 'monkaS', provider: 'bttv' })]],
    ]);
    renderDialog({ scope: 'thirdParty', platform: 'twitch' });
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'pog' } });
    expect(screen.getByLabelText('PogChamp')).toBeInTheDocument();
    expect(screen.queryByLabelText('KEKW')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('monkaS')).not.toBeInTheDocument();
  });

  it('sub-section filter (thirdParty twitch): click 7TV hides BTTV/FFZ but keeps Recent/Favorites', () => {
    mockState.recentEmotes = [makeEmote({ id: 's-r', name: 'recentSTV', provider: '7tv' })];
    mockState.favoriteEmotes = [makeEmote({ id: 's-f', name: 'favSTV', provider: '7tv' })];
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ['7tv', [makeEmote({ id: 's1', name: 'PogChamp', provider: '7tv' })]],
      ['bttv', [makeEmote({ id: 'b1', name: 'monkaS', provider: 'bttv' })]],
      ['ffz', [makeEmote({ id: 'f1', name: 'OhMyDog', provider: 'ffz' })]],
    ]);
    renderDialog({ scope: 'thirdParty', platform: 'twitch' });

    // Click the 7TV sub-section icon (aria-label "7TV", aria-pressed=false).
    fireEvent.click(screen.getByRole('button', { name: '7TV', pressed: false }));

    // 7TV section heading still present (aria-expanded distinguishes from icon).
    expect(screen.getByRole('button', { name: /^7TV/, expanded: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^BetterTTV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^FrankerFaceZ/ })).not.toBeInTheDocument();
    // Recent and Favorites stay visible.
    expect(screen.getByRole('button', { name: /^Recent/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Favorites/ })).toBeInTheDocument();
  });

  it('sub-section filter toggles off when re-clicked', () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ['7tv', [makeEmote({ id: 's1', name: 'PogChamp', provider: '7tv' })]],
      ['bttv', [makeEmote({ id: 'b1', name: 'monkaS', provider: 'bttv' })]],
      ['ffz', [makeEmote({ id: 'f1', name: 'OhMyDog', provider: 'ffz' })]],
    ]);
    renderDialog({ scope: 'thirdParty', platform: 'twitch' });

    const stvIcon = screen.getByRole('button', { name: '7TV', pressed: false });
    fireEvent.click(stvIcon);
    expect(screen.queryByRole('button', { name: /^BetterTTV/ })).not.toBeInTheDocument();
    // click again to clear
    const stvIconActive = screen.getByRole('button', { name: '7TV', pressed: true });
    fireEvent.click(stvIconActive);
    expect(screen.getByRole('button', { name: /^BetterTTV/ })).toBeInTheDocument();
  });

  it('collapsible section toggles expanded/collapsed', () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ['kick', [makeEmote({ id: 'k1', name: 'kickHype', provider: 'kick' })]],
    ]);
    renderDialog({ scope: 'native', platform: 'kick' });
    expect(screen.getByLabelText('kickHype')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Kick/ }));
    expect(screen.queryByLabelText('kickHype')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Kick/ }));
    expect(screen.getByLabelText('kickHype')).toBeInTheDocument();
  });

  it('infinite scroll: 50 emotes shows 20 initially, +20 after sentinel intersect', () => {
    const fifty = Array.from({ length: 50 }, (_, i) =>
      makeEmote({ id: `k${i}`, name: `emote${i}`, provider: 'kick' })
    );
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([['kick', fifty]]);
    renderDialog({ scope: 'native', platform: 'kick' });
    // Initial 20 rendered.
    expect(screen.getByLabelText('emote0')).toBeInTheDocument();
    expect(screen.getByLabelText('emote19')).toBeInTheDocument();
    expect(screen.queryByLabelText('emote20')).not.toBeInTheDocument();
    // Trigger intersect.
    act(() => {
      triggerAllIntersect();
    });
    expect(screen.getByLabelText('emote20')).toBeInTheDocument();
    expect(screen.getByLabelText('emote39')).toBeInTheDocument();
    expect(screen.queryByLabelText('emote40')).not.toBeInTheDocument();
  });

  it('renders lock overlay when Kick-native + viewerIsSubscribed=false + subscribersOnly=true; click is no-op', () => {
    const locked = makeEmote({
      id: 'k-sub',
      name: 'subOnly',
      provider: 'kick',
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([['kick', [locked]]]);
    const { onSelect } = renderDialog({
      scope: 'native',
      platform: 'kick',
      viewerIsSubscribed: false,
    });
    const btn = screen.getByLabelText('subOnly — subscriber-only emote');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('emote-lock-overlay')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onSelect).not.toHaveBeenCalled();
    expect(mockState.addRecentEmote).not.toHaveBeenCalled();
  });

  it('no lock overlay when Kick-native + viewerIsSubscribed=true; click selects', () => {
    const emote = makeEmote({
      id: 'k-sub',
      name: 'subOnly',
      provider: 'kick',
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([['kick', [emote]]]);
    const { onSelect } = renderDialog({
      scope: 'native',
      platform: 'kick',
      viewerIsSubscribed: true,
    });
    expect(screen.queryByTestId('emote-lock-overlay')).not.toBeInTheDocument();
    const btn = screen.getByLabelText('subOnly');
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith(emote);
    expect(mockState.addRecentEmote).toHaveBeenCalledWith(emote);
  });

  it('no lock overlay when Kick-native + viewerIsSubscribed=undefined', () => {
    const emote = makeEmote({
      id: 'k-sub',
      name: 'subOnly',
      provider: 'kick',
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([['kick', [emote]]]);
    renderDialog({ scope: 'native', platform: 'kick' /* viewerIsSubscribed omitted */ });
    expect(screen.queryByTestId('emote-lock-overlay')).not.toBeInTheDocument();
    expect(screen.getByLabelText('subOnly')).toBeInTheDocument();
  });

  it('no lock overlay on Twitch-native even with subscribersOnly=true (defensive)', () => {
    const emote = makeEmote({
      id: 't-sub',
      name: 'twitchSubOnly',
      provider: 'twitch',
      subscribersOnly: true,
    });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([['twitch', [emote]]]);
    renderDialog({ scope: 'native', platform: 'twitch', viewerIsSubscribed: false });
    expect(screen.queryByTestId('emote-lock-overlay')).not.toBeInTheDocument();
  });

  it('outside click closes the dialog', () => {
    const { onClose } = renderDialog({ scope: 'native', platform: 'kick' });
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key closes the dialog', () => {
    const { onClose } = renderDialog({ scope: 'native', platform: 'kick' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('favorite toggle: hover then click star fires useEmoteStore.toggleFavorite', () => {
    const emote = makeEmote({ id: 'k1', name: 'kickHype', provider: 'kick' });
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([['kick', [emote]]]);
    renderDialog({ scope: 'native', platform: 'kick' });
    const emoteBtn = screen.getByLabelText('kickHype');
    // The hover wrapper is the button's parent <div>.
    const wrapper = emoteBtn.parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    const star = within(wrapper).getByLabelText(/^Favorite kickHype$/);
    fireEvent.click(star);
    expect(mockState.toggleFavorite).toHaveBeenCalledWith(emote);
  });
});
