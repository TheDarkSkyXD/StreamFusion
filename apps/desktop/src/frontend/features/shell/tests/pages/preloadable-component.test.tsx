import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

import { createPreloadableComponent } from "@/routes/preloadable-component";

describe("preloadable component", () => {
  it("renders synchronously without reloading after an external preload", async () => {
    const LoadedComponent = ({ label }: { label: string }) => <div>{label}</div>;
    const load = vi.fn(async () => ({ default: LoadedComponent }));
    const component = createPreloadableComponent(load);

    await component.preload();
    render(
      <Suspense fallback={<div>loading</div>}>
        <component.Component label="ready" />
      </Suspense>
    );

    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
