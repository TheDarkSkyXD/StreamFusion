import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

function Setup() {
  return (
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>This will delete things.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('is closed by default and shows trigger', () => {
    render(<Setup />);
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens content when the trigger is clicked', () => {
    render(<Setup />);
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByText('This will delete things.')).toBeInTheDocument();
  });

  it('renders a close button inside the content', () => {
    render(<Setup />);
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByText('Close')).toBeInTheDocument();
  });
});
