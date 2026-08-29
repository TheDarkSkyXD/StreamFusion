import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
} from "../../test-utils";

const proxiedImageState = vi.hoisted(() => ({
  loading: undefined as "lazy" | "eager" | undefined,
}));

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt, loading }: { alt: string; loading?: "lazy" | "eager" }) => {
    proxiedImageState.loading = loading;
    return <div data-testid="boxart">{alt}</div>;
  },
}));

import { CategoryCard } from "@/features/discovery/components/discovery/category-card";

// Guards: every category renders a viewer count; missing provider data falls back to "0 viewers" instead of leaving an unexplained blank.
// Guards: every card reserves one non-wrapping tag row so category windows cannot change virtual row height while scrolling.
// Guards: name + box art render together and the caller's image-loading policy is forwarded; missing either degrades to a slow or unclear category-card UX
// Guards: duplicate category tags render once, preserving the first label and order, so API duplicates cannot produce repeated pills or React key warnings.
// Note: image-onError fallback is delegated to ProxiedImage; covered in its own tests (proxied-image mocks here keep the test fast)
describe("CategoryCard", () => {
  beforeEach(() => {
    installElectronAPIMock();
    proxiedImageState.loading = undefined;
  });

  it("renders the category name and box art", () => {
    renderWithProviders(<CategoryCard category={fixtures.category({ name: "Just Chatting" })} />);
    // Box-art alt + heading both contain "Just Chatting".
    expect(screen.getAllByText("Just Chatting").length).toBeGreaterThan(0);
    expect(screen.getByTestId("boxart")).toHaveTextContent("Just Chatting");
  });

  it("shows viewer count when > 0", () => {
    renderWithProviders(<CategoryCard category={fixtures.category({ viewerCount: 25_000 })} />);
    expect(screen.getByText(/25K viewers/i)).toBeInTheDocument();
  });

  it.each([0, undefined])("shows 0 viewers when viewer count is %s", (viewerCount) => {
    renderWithProviders(<CategoryCard category={fixtures.category({ viewerCount })} />);
    expect(screen.getByText("0 viewers")).toBeInTheDocument();
  });

  it("forwards eager image loading for warmed category tabs", () => {
    renderWithProviders(
      <CategoryCard category={fixtures.category({ name: "Just Chatting" })} imageLoading="eager" />
    );
    expect(proxiedImageState.loading).toBe("eager");
  });

  it("renders duplicate tag labels once while preserving first-seen order", () => {
    renderWithProviders(
      <CategoryCard
        category={fixtures.category({ tags: ["Tactical", "tactical", "RTS", "rts"] })}
      />
    );

    expect(screen.getAllByTitle(/^(tactical|rts)$/i).map((tag) => tag.textContent)).toEqual([
      "Tactical",
      "RTS",
    ]);
  });

  it("reserves one compact tag row when no tags are available", () => {
    renderWithProviders(<CategoryCard category={fixtures.category({ tags: [] })} />);

    expect(screen.getByTestId("category-tags")).toHaveClass(
      "h-5",
      "flex-nowrap",
      "overflow-hidden"
    );
  });
});
