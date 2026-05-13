import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

describe('Card', () => {
  it('renders all subparts and applies passed className', () => {
    const { container } = render(
      <Card className="custom">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );

    expect(container.firstChild).toHaveClass('custom');
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Desc')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('CardTitle renders as h3', () => {
    render(<CardTitle>Hi</CardTitle>);
    expect(screen.getByRole('heading', { level: 3, name: 'Hi' })).toBeInTheDocument();
  });
});
