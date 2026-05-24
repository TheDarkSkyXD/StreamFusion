import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChatEmote } from '@/components/chat/ChatEmote';
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
} from '@/shared/auth-types';
import { useAuthStore } from '@/store/auth-store';

// Seed the chatDisplay prefs ChatEmote reads. Mirrors the ChatMessage test
// helper — leaving the store untouched falls back to DEFAULT_CHAT_DISPLAY_PREFERENCES.
function setChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides },
    } as typeof s.preferences,
  }));
}

beforeEach(() => {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
    } as typeof s.preferences,
  }));
});

describe('ChatEmote', () => {
  it('renders the emote image with the name as alt text', () => {
    render(<ChatEmote id="e1" name="Kappa" url="https://x.test/kappa.png" platform="twitch" />);
    expect(screen.getByAltText('Kappa')).toBeInTheDocument();
  });

  it('shows tooltip on mouse enter', () => {
    render(<ChatEmote id="e1" name="PogChamp" url="https://x.test/pog.png" platform="twitch" />);
    fireEvent.mouseEnter(screen.getByAltText('PogChamp'));
    // Tooltip portal renders another image with the same alt.
    expect(screen.getAllByAltText('PogChamp').length).toBeGreaterThan(1);
  });
});

describe('ChatEmote emote size (U2/U3)', () => {
  it('renders a normal emote at the configured emoteSizePx', () => {
    setChatDisplay({ emoteSizePx: 32 });
    render(<ChatEmote id="e1" name="Kappa" url="https://x.test/kappa.png" platform="twitch" />);
    const img = screen.getByAltText('Kappa') as HTMLImageElement;
    expect(img.style.height).toBe('32px');
  });
});

describe('ChatEmote overlay / zero-width (U3)', () => {
  it('stacks a zero-width emote as an overlay when overlayEmotes is true', () => {
    setChatDisplay({ overlayEmotes: true, emoteSizePx: 28 });
    render(
      <ChatEmote
        id="zw"
        name="OverlayEmote"
        url="https://7tv.app/emote/zw/2x.webp"
        platform="twitch"
        isZeroWidth
      />
    );
    const img = screen.getByAltText('OverlayEmote') as HTMLImageElement;
    // Overlay: absolutely positioned and pulled back over the previous emote.
    expect(img.dataset.zeroWidth).toBe('true');
    expect(img.style.position).toBe('absolute');
    expect(img.style.marginLeft).toBe('-28px');
  });

  it('renders a zero-width emote inline (no overlay) when overlayEmotes is false', () => {
    setChatDisplay({ overlayEmotes: false });
    render(
      <ChatEmote
        id="zw"
        name="OverlayEmote"
        url="https://7tv.app/emote/zw/2x.webp"
        platform="twitch"
        isZeroWidth
      />
    );
    const img = screen.getByAltText('OverlayEmote') as HTMLImageElement;
    expect(img.dataset.zeroWidth).toBeUndefined();
    expect(img.style.position).toBe('');
    expect(img.style.marginLeft).toBe('');
  });

  it('never treats a non-zero-width emote as an overlay even with overlayEmotes on', () => {
    setChatDisplay({ overlayEmotes: true });
    render(
      <ChatEmote id="e1" name="Kappa" url="https://x.test/kappa.png" platform="twitch" />
    );
    const img = screen.getByAltText('Kappa') as HTMLImageElement;
    expect(img.dataset.zeroWidth).toBeUndefined();
    expect(img.style.position).toBe('');
  });
});

describe('ChatEmote animated toggle (U3)', () => {
  const TWITCH_DEFAULT_URL =
    'https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/3.0';

  it('freezes a native Twitch animated emote to a static frame when animatedEmotes is false', () => {
    setChatDisplay({ animatedEmotes: false });
    render(
      <ChatEmote id="123" name="AnimKappa" url={TWITCH_DEFAULT_URL} platform="twitch" isAnimated />
    );
    const img = screen.getByAltText('AnimKappa') as HTMLImageElement;
    // /default/ swapped to /static/ — the CDN serves a non-animated frame there.
    expect(img.getAttribute('src')).toBe(
      'https://static-cdn.jtvnw.net/emoticons/v2/123/static/dark/3.0'
    );
  });

  it('keeps the animated URL when animatedEmotes is true', () => {
    setChatDisplay({ animatedEmotes: true });
    render(
      <ChatEmote id="123" name="AnimKappa" url={TWITCH_DEFAULT_URL} platform="twitch" isAnimated />
    );
    const img = screen.getByAltText('AnimKappa') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(TWITCH_DEFAULT_URL);
  });

  it('falls back to the original URL when no static variant can be derived (7TV/BTTV)', () => {
    // 7TV/BTTV serve animated + static from the same file/URL — there is no
    // clean static transform, so the renderer keeps the original rather than
    // faking a freeze (see freezeEmoteUrl TODO).
    setChatDisplay({ animatedEmotes: false });
    const url = 'https://cdn.7tv.app/emote/abc/2x.webp';
    render(<ChatEmote id="abc" name="SevenTV" url={url} platform="twitch" isAnimated />);
    const img = screen.getByAltText('SevenTV') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(url);
  });

  it('does not transform a non-animated emote regardless of the toggle', () => {
    setChatDisplay({ animatedEmotes: false });
    render(
      <ChatEmote id="123" name="StaticKappa" url={TWITCH_DEFAULT_URL} platform="twitch" />
    );
    const img = screen.getByAltText('StaticKappa') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(TWITCH_DEFAULT_URL);
  });
});
