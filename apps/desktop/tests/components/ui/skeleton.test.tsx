import { describe, expect, it } from "vitest";

import { Skeleton } from "@/components/ui/skeleton";
import { renderWithProviders, screen } from "../../test-utils";

describe("Skeleton", () => {
  it("stops pulsing when reduced motion is requested", () => {
    renderWithProviders(<Skeleton data-testid="skeleton" />);

    expect(screen.getByTestId("skeleton")).toHaveClass(
      "animate-pulse",
      "motion-reduce:animate-none"
    );
  });
});
