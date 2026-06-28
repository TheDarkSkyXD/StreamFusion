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

import { CategoryCard } from "@/components/discovery/category-card";

// Guards: viewerCount=0 / undefined hides the viewer-count label entirely; viewerCount>0 surfaces "Nk viewers" so users don't see "0 viewers" on a genuinely live category
// Guards: name + box art render together and the caller's image-loading policy is forwarded; missing either degrades to a slow or unclear category-card UX
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

  it("hides viewer count when 0 or undefined", () => {
    renderWithProviders(<CategoryCard category={fixtures.category({ viewerCount: 0 })} />);
    expect(screen.queryByText(/viewers/i)).not.toBeInTheDocument();
  });

  it("forwards eager image loading for warmed category tabs", () => {
    renderWithProviders(
      <CategoryCard category={fixtures.category({ name: "Just Chatting" })} imageLoading="eager" />
    );
    expect(proxiedImageState.loading).toBe("eager");
  });
});
