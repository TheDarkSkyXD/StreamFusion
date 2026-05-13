import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

describe('Select', () => {
  it('renders trigger with placeholder when no value', () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
        </SelectContent>
      </Select>
    );
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });

  it('opens the listbox when the trigger is clicked', () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
          <SelectItem value="b">Beta</SelectItem>
        </SelectContent>
      </Select>
    );
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('calls onValueChange when an item is selected', () => {
    const onValueChange = vi.fn();
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
        </SelectContent>
      </Select>
    );
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Alpha'));
    expect(onValueChange).toHaveBeenCalledWith('a');
  });
});
