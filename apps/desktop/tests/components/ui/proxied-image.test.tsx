import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../../test-utils';
import { ProxiedImage } from '@/components/ui/proxied-image';

describe('ProxiedImage', () => {
  beforeEach(() => {
    installElectronAPIMock();
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

  it('rewrites Kick CDN URLs to the kick-image:// protocol', async () => {
    render(<ProxiedImage src="https://files.kick.com/foo.png" alt="hello" />);
    const img = await screen.findByRole('img', { name: 'hello' });
    const src = img.getAttribute('src') ?? '';
    expect(src.startsWith('kick-image://image?u=')).toBe(true);
    // base64url-decode the u param and verify it round-trips to the original URL
    const u = new URL(src).searchParams.get('u') ?? '';
    const b64 = u.replace(/-/g, '+').replace(/_/g, '/');
    expect(atob(b64)).toBe('https://files.kick.com/foo.png');
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

  it('calls onProxyError when the underlying <img> errors on a proxied URL', async () => {
    const onProxyError = vi.fn();
    render(
      <ProxiedImage src="https://files.kick.com/foo.png" alt="x" onProxyError={onProxyError} />
    );
    const img = await screen.findByRole('img', { name: 'x' });
    fireEvent.error(img);
    await waitFor(() => expect(onProxyError).toHaveBeenCalled());
  });
});
