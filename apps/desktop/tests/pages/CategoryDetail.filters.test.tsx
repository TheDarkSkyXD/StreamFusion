import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fireEvent,
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  userEvent,
} from "../test-utils";

const routeState = vi.hoisted(() => ({ platform: "twitch", categoryId: "cat-1" }));
const searchState = vi.hoisted(() => ({
  tab: "live" as const,
  platform: "all" as const,
  language: "",
  tag: "",
  sort: "desc" as const,
  otherId: "15" as string | undefined,
}));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  ...routerMock({ params: routeState, search: searchState }),
  useLocation: () => ({ pathname: "/categories/twitch/cat-1", search: { tab: "live" } }),
  useNavigate: () => navigateMock,
}));

vi.mock("@/features/discovery/data/queries/useCategories", () => ({
  useCategoryById: vi.fn((id: string, platform: "twitch" | "kick") => ({
    data: fixtures.category({ id, platform, name: "Just Chatting" }),
    isLoading: false,
    error: null,
  })),
  useTopCategories: vi.fn(() => ({ data: [] })),
  useInfiniteTopCategories: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("@/features/discovery/data/queries/useInfiniteStreams", () => ({
  useInfiniteStreamsByCategory: vi.fn(() => ({
    data: { pages: [] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock("@/features/discovery/components/stream/stream-grid", () => ({
  StreamGrid: () => <div data-testid="stream-grid" />,
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { CategoryDetailPage } from "@/pages/CategoryDetail";

describe("CategoryDetailPage filter interactions", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    installElectronAPIMock();
  });

  it.each([
    ["Language", "English", "language", "en"],
    ["Viewer sort", "Fewest viewers", "sort", "asc"],
  ] as const)("writes %s changes with otherId preservation and scroll reset", async (controlName, optionName, field, value) => {
    const scrollArea = document.createElement("main");
    scrollArea.id = "main-content-scroll-area";
    scrollArea.scrollTop = 640;
    document.body.append(scrollArea);
    const user = userEvent.setup();

    renderWithProviders(<CategoryDetailPage />);
    await user.click(screen.getByRole("combobox", { name: controlName }));
    await user.click(screen.getByRole("option", { name: optionName }));

    expect(scrollArea.scrollTop).toBe(0);
    expect(navigateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ [field]: value, otherId: "15" }),
      })
    );
    scrollArea.remove();
  });

  it("preserves native modified-click semantics before resetting Category content scroll", () => {
    const scrollArea = document.createElement("main");
    scrollArea.id = "main-content-scroll-area";
    scrollArea.scrollTop = 640;
    document.body.append(scrollArea);
    const preventDocumentNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", preventDocumentNavigation);

    renderWithProviders(<CategoryDetailPage />);
    const clipsLink = screen.getByRole("link", { name: "Clips" });
    fireEvent.click(clipsLink, { ctrlKey: true });
    expect(scrollArea.scrollTop).toBe(640);

    fireEvent.click(clipsLink);
    expect(scrollArea.scrollTop).toBe(0);
    document.removeEventListener("click", preventDocumentNavigation);
    scrollArea.remove();
  });
});
