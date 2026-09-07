import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { withSuspense } from "@/routes/router";

const neverResolves = new Promise<never>(() => undefined);

function SuspendedPage(): never {
  throw neverResolves;
}

// Guards: lazy sidebar pages show a visible spinner instead of a blank page or an uncolored ring.
describe("route page loading", () => {
  it("renders the shared spinner with a visible active segment", () => {
    const Page = withSuspense(SuspendedPage);

    render(<Page />);

    const loader = screen.getByRole("status", { name: "Loading page" });
    const spinner = loader.firstElementChild;

    expect(spinner).toHaveStyle({ borderTopColor: "#ffffff" });
    expect(spinner).toHaveClass("animate-spin", "motion-reduce:animate-none");
  });
});
