import { describe, expect, it } from 'vitest';

import { renderWithProviders, screen } from '../test-utils';
import { DownloadsPage } from '@/pages/Downloads';

describe('DownloadsPage', () => {
  it('renders the Downloads heading', () => {
    renderWithProviders(<DownloadsPage />);
    expect(screen.getByRole('heading', { name: /downloads/i, level: 1 })).toBeInTheDocument();
  });

  it('renders Active Downloads and Completed sections', () => {
    renderWithProviders(<DownloadsPage />);
    expect(screen.getByText(/active downloads/i)).toBeInTheDocument();
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
  });

  it('renders mock download items (placeholder data)', () => {
    renderWithProviders(<DownloadsPage />);
    expect(screen.getByText(/full stream vod - 2024-03-15/i)).toBeInTheDocument();
    expect(screen.getByText(/funny fail compilation/i)).toBeInTheDocument();
    expect(screen.getByText(/epic win moment #32/i)).toBeInTheDocument();
  });

  it('shows download speed for active downloads', () => {
    renderWithProviders(<DownloadsPage />);
    expect(screen.getByText('12.5 MB/s')).toBeInTheDocument();
  });
});
