import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VisuallyHidden } from '@/components/ui/visually-hidden';

describe('VisuallyHidden', () => {
  it('renders children in the DOM (accessible to screen readers)', () => {
    render(<VisuallyHidden>secret label</VisuallyHidden>);
    expect(screen.getByText('secret label')).toBeInTheDocument();
  });
});
