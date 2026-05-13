import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SeekPreview } from '@/components/player/seek-preview';

describe('SeekPreview', () => {
  it('renders formatted time at the position', () => {
    render(<SeekPreview time={125} position={0.5} />);
    // formatDuration(125) gives 2:05
    expect(screen.getByText(/2:05/)).toBeInTheDocument();
  });

  it('renders a preview image when previewImage is set', () => {
    render(<SeekPreview time={10} position={0.5} previewImage="https://x.test/p.jpg" />);
    expect(screen.getByAltText(/preview at/i)).toBeInTheDocument();
  });

  it('falls back to "Preview unavailable" when image errors', async () => {
    const { findByText } = render(
      <SeekPreview time={10} position={0.5} previewImage="https://x.test/p.jpg" />
    );
    fireEvent.error(screen.getByAltText(/preview at/i));
    expect(await findByText(/preview unavailable/i)).toBeInTheDocument();
  });
});
