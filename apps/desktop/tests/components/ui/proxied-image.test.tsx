import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../../test-utils';
import { ProxiedImage, _resetProxiedImageBrokenUrls } from '@/components/ui/proxied-image';

describe('ProxiedImage', () => {
  beforeEach(() => {
    installElectronAPIMock();
    _resetProxiedImageBrokenUrls();
  });

  it('renders the image directly for non-proxied http URLs', async () => {
    render(<ProxiedImage src="https://cdn.example.com/img.jpg" alt="hello" />);
    const img = await screen.findByRole('img', { name: 'hello' });
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/img.jpg');
  });

  it('uses a data: URL directly without proxying', async () => {
    render(<ProxiedImage src="data:image/png;base64,iVBORw0K" alt="hi" />);
    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,iVBORw0K');
  });

  it('routes Kick CDN URLs through the kick-image protocol immediately', async () => {
    render(<ProxiedImage src="https://files.kick.com/foo.png" alt="hello" />);
    const img = await screen.findByRole('img', { name: 'hello' });
    const src = img.getAttribute('src') ?? '';
    expect(src.startsWith('kick-image://image?u=')).toBe(true);
    const u = new URL(src).searchParams.get('u') ?? '';
    const b64 = u.replace(/-/g, '+').replace(/_/g, '/');
    expect(atob(b64)).toBe('https://files.kick.com/foo.png');
  });

  it('routes Kick video thumbnails through the kick-image protocol without first requesting the raw 720.webp URL', async () => {
    const upstream =
      'https://images.kick.com/video_thumbnails/z7oMLoDcD3va/iBP8BzqJxpzh/720.webp';
    render(<ProxiedImage src={upstream} alt="Kick VOD" />);
    const img = await screen.findByRole('img', { name: 'Kick VOD' });
    const src = img.getAttribute('src') ?? '';
    expect(src.startsWith('kick-image://image?u=')).toBe(true);
    const u = new URL(src).searchParams.get('u') ?? '';
    const b64 = u.replace(/-/g, '+').replace(/_/g, '/');
    expect(atob(b64)).toBe(upstream);
  });

  it('tries Twitch profile_image URLs directly first', async () => {
    const upstream =
      'https://static-cdn.jtvnw.net/jtv_user_pictures/rescueqt-profile_image-971ff387d62d4a54-300x300.jpeg';
    render(<ProxiedImage src={upstream} alt="rescueqt" />);
    const img = await screen.findByRole('img', { name: 'rescueqt' });
    expect(img).toHaveAttribute('src', upstream);
  });

  it('falls back to the twitch-image:// protocol when direct Twitch profile images fail', async () => {
    const upstream =
      'https://static-cdn.jtvnw.net/jtv_user_pictures/rescueqt-profile_image-971ff387d62d4a54-300x300.jpeg';
    render(<ProxiedImage src={upstream} alt="rescueqt" />);
    const img = await screen.findByRole('img', { name: 'rescueqt' });

    fireEvent.error(img);

    await waitFor(() => {
      const nextSrc = img.getAttribute('src') ?? '';
      expect(nextSrc.startsWith('twitch-image://image?u=')).toBe(true);
    });
    const src = img.getAttribute('src') ?? '';
    const u = new URL(src).searchParams.get('u') ?? '';
    const b64 = u.replace(/-/g, '+').replace(/_/g, '/');
    expect(atob(b64)).toBe(upstream);
  });

  it('leaves non-profile Twitch CDN URLs (emotes, thumbnails) alone', async () => {
    const emote =
      'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0';
    render(<ProxiedImage src={emote} alt="kappa" />);
    const img = await screen.findByRole('img', { name: 'kappa' });
    expect(img.getAttribute('src')).toBe(emote);
  });

  it('renders the default fallback initial on empty src', async () => {
    render(<ProxiedImage src="" alt="Alice" />);
    await waitFor(() => {
      expect(screen.getByText('A')).toBeInTheDocument();
    });
  });

  it('renders a custom fallback when provided and src is missing', async () => {
    render(<ProxiedImage src="" alt="x" fallback={<span>FALLBACK</span>} />);
    await waitFor(() => {
      expect(screen.getByText('FALLBACK')).toBeInTheDocument();
    });
  });

  it('calls onProxyError when the proxied Kick image errors', async () => {
    const onProxyError = vi.fn();
    render(
      <ProxiedImage src="https://files.kick.com/foo.png" alt="x" onProxyError={onProxyError} />
    );
    const img = await screen.findByRole('img', { name: 'x' });
    expect(img.getAttribute('src')?.startsWith('kick-image://image?u=')).toBe(true);

    fireEvent.error(img);
    await waitFor(() => expect(onProxyError).toHaveBeenCalled());
  });

  it('treats a 1x1 response on the twitch-image:// protocol as upstream failure → fallback', async () => {
    const upstream =
      'https://static-cdn.jtvnw.net/jtv_user_pictures/broken-profile_image-abcdef0123456789-300x300.jpeg';
    render(<ProxiedImage src={upstream} alt="Dana" />);
    const img = await screen.findByRole('img', { name: 'Dana' });
    fireEvent.error(img);
    await waitFor(() => {
      expect((img.getAttribute('src') ?? '').startsWith('twitch-image://image?u=')).toBe(true);
    });
    // Simulate the protocol handler's 1×1 placeholder by stamping the natural
    // dimensions before firing onLoad. The component uses these to detect
    // "upstream failed, paint the fallback initial."
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 1 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1 });
    fireEvent.load(img);
    await waitFor(() => expect(screen.getByText('D')).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: 'Dana' })).toBeNull();
  });

  it('treats a 1x1 response on the kick-image:// protocol as upstream failure and falls back', async () => {
    const upstream =
      'https://images.kick.com/video_thumbnails/z7oMLoDcD3va/iBP8BzqJxpzh/720.webp';
    const onProxyError = vi.fn();
    render(<ProxiedImage src={upstream} alt="Kick VOD" onProxyError={onProxyError} />);
    const img = await screen.findByRole('img', { name: 'Kick VOD' });
    expect(img.getAttribute('src')?.startsWith('kick-image://image?u=')).toBe(true);

    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 1 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1 });
    fireEvent.load(img);

    await waitFor(() => expect(screen.getByText('K')).toBeInTheDocument());
    expect(onProxyError).toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: 'Kick VOD' })).toBeNull();
  });

  it('skips the network request and shows the fallback when a URL has already 403d this session', async () => {
    // First render: image errors, URL gets added to the session-level broken-URL set.
    const { unmount } = render(
      <ProxiedImage src="https://cdn.example.com/broken.jpg" alt="Bob" />
    );
    const img = await screen.findByRole('img', { name: 'Bob' });
    fireEvent.error(img);
    await waitFor(() => expect(screen.getByText('B')).toBeInTheDocument());
    unmount();

    // Re-mount with the same URL — should jump straight to fallback initial,
    // not issue a new <img> request that would log another 403 to the console.
    render(<ProxiedImage src="https://cdn.example.com/broken.jpg" alt="Bob" />);
    await waitFor(() => expect(screen.getByText('B')).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: 'Bob' })).toBeNull();
  });
});
