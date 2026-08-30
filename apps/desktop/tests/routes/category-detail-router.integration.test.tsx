import {
  createHashHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from "../test-utils";

vi.mock("@/features/discovery/data/queries/useCategories", () => ({
  useCategoryById: vi.fn((id: string, platform: "twitch" | "kick") => ({
    data: fixtures.category({
      id,
      platform,
      name: "Just Chatting",
    }),
    isLoading: false,
  })),
  useTopCategories: vi.fn(() => ({ data: [] })),
  useInfiniteTopCategories: vi.fn(() => ({ data: [] })),
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

import { CategoryDetailPage } from "@/pages/CategoryDetail";
import {
  DEFAULT_CATEGORY_LANGUAGE,
  useCategoryLanguagePreferenceStore,
} from "@/features/discovery/data/category-language-preference-store";
import { validateCategoryDetailSearch } from "@/features/discovery/routes/category-detail-search";

const nativePushState = window.history.pushState.bind(window.history);
const nativeReplaceState = window.history.replaceState.bind(window.history);

function createCategoryRouter(history = createHashHistory()) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: () => <Outlet />,
  });
  const categoryRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/categories/$platform/$categoryId",
    validateSearch: validateCategoryDetailSearch,
    component: CategoryDetailPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([categoryRoute])]),
    history,
  });
  return { history, router };
}

// Guards: Category hash URLs serialize every Live filter and native links preserve both Platform identities
// Guards: Category language URLs override the saved preference, while omitted language restores it without adding history
// Guards: valid media tabs survive URL validation while genuinely invalid tabs canonicalize to rendered Live content
describe("Category detail hash-history routing", () => {
  beforeAll(() => {
    vi.spyOn(window.history, "pushState").mockImplementation(nativePushState);
    vi.spyOn(window.history, "replaceState").mockImplementation(nativeReplaceState);
  });

  beforeEach(() => {
    localStorage.clear();
    useCategoryLanguagePreferenceStore.setState({
      preferredLanguage: DEFAULT_CATEGORY_LANGUAGE,
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["tab", "invalid", "live"],
    ["platform", "invalid", "all"],
    ["language", "invalid", ""],
    ["tag", "123", ""],
    ["sort", "invalid", "desc"],
  ] as const)("replace-canonicalizes invalid raw %s search state", async (field, invalidValue, expectedValue) => {
    installElectronAPIMock();
    if (field === "language") {
      useCategoryLanguagePreferenceStore.getState().setPreferredLanguage("es");
    }
    const rawSearch = new URLSearchParams({
      tab: "live",
      platform: "twitch",
      language: "es",
      tag: "ranked",
      sort: "asc",
      otherId: "15",
    });
    rawSearch.set(field, invalidValue);
    window.location.hash = `#/categories/twitch/509658?${rawSearch.toString()}`;
    const { history, router } = createCategoryRouter();
    await act(async () => {
      await router.load();
    });
    const view = renderWithProviders(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(new URLSearchParams(window.location.hash.split("?")[1]).get(field)).toBe(
        field === "language" ? "es" : expectedValue
      );
    });

    if (field === "tab") {
      expect(screen.getByRole("link", { name: "Live Streams" })).toHaveAttribute(
        "aria-current",
        "page"
      );
    } else if (field === "platform") {
      expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
    } else if (field === "language") {
      expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("Spanish");
      expect(useCategoryLanguagePreferenceStore.getState().preferredLanguage).toBe("es");
    } else if (field === "tag") {
      expect(screen.getByRole("textbox", { name: "Tag" })).toHaveValue("");
    } else {
      expect(screen.getByRole("combobox", { name: "Viewer sort" })).toHaveTextContent(
        "Most viewers"
      );
    }

    view.unmount();
    history.destroy();
  });

  it("uses a saved language for an omitted query and replaces the URL", async () => {
    installElectronAPIMock();
    useCategoryLanguagePreferenceStore.getState().setPreferredLanguage("es");
    window.location.hash = "#/categories/twitch/509658?tab=live&platform=all&tag=&sort=desc";
    const { history, router } = createCategoryRouter();
    await act(async () => {
      await router.load();
    });
    const view = renderWithProviders(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("Spanish");
      expect(new URLSearchParams(window.location.hash.split("?")[1]).get("language")).toBe("es");
    });

    view.unmount();
    history.destroy();
  });

  it.each([
    "clips",
    "videos",
  ] as const)("preserves a valid %s deep link as the active Category tab", async (tab) => {
    installElectronAPIMock();
    useCategoryLanguagePreferenceStore.getState().setPreferredLanguage("es");
    window.location.hash = `#/categories/twitch/509658?tab=${tab}&platform=all&language=&tag=&sort=desc&otherId=15`;
    const { history, router } = createCategoryRouter();
    await act(async () => {
      await router.load();
    });
    const view = renderWithProviders(<RouterProvider router={router} />);

    expect(
      screen.getByRole("link", { name: tab === "clips" ? "Clips" : "Videos" })
    ).toHaveAttribute("aria-current", "page");
    expect(new URLSearchParams(window.location.hash.split("?")[1]).get("tab")).toBe(tab);
    await waitFor(() => {
      expect(useCategoryLanguagePreferenceStore.getState().preferredLanguage).toBe("");
    });

    view.unmount();
    history.destroy();
  });

  it("serializes actual tab hrefs with every Live filter and canonical otherId", async () => {
    installElectronAPIMock();
    window.location.hash =
      "#/categories/twitch/509658?tab=live&platform=kick&language=es&tag=ranked&sort=asc&otherId=15";
    const { history, router } = createCategoryRouter();
    await act(async () => {
      await router.load();
    });
    const view = renderWithProviders(<RouterProvider router={router} />);

    expect(screen.getByRole("textbox", { name: "Tag" })).toHaveValue("ranked");
    expect(screen.getByRole("link", { name: "Kick" })).toHaveAttribute("aria-current", "page");

    const clipsHref = screen.getByRole("link", { name: "Clips" }).getAttribute("href") ?? "";
    expect(clipsHref).toContain("/categories/twitch/509658");
    expect(clipsHref).toContain("tab=clips");
    expect(clipsHref).toContain("platform=kick");
    expect(decodeURIComponent(clipsHref)).toContain('otherId="15"');

    view.unmount();
    history.destroy();
  });

  it("restores URL-backed filters through real push, Back, and Forward history", async () => {
    installElectronAPIMock();
    const history = createMemoryHistory({
      initialEntries: [
        "/categories/twitch/509658?tab=live&platform=kick&language=es&tag=ranked&sort=asc&otherId=15",
      ],
    });
    const { router } = createCategoryRouter(history);
    await act(async () => {
      await router.load();
    });
    const view = renderWithProviders(<RouterProvider router={router} />);

    await act(async () => {
      await router.navigate({
        to: "/categories/$platform/$categoryId",
        params: { platform: "twitch", categoryId: "509658" },
        search: {
          tab: "live",
          platform: "twitch",
          language: "en",
          tag: "speedrun",
          sort: "desc",
          otherId: "15",
        },
      });
    });
    expect(screen.getByRole("textbox", { name: "Tag" })).toHaveValue("speedrun");

    await act(async () => {
      history.back();
      await router.load();
    });
    expect(screen.getByRole("textbox", { name: "Tag" })).toHaveValue("ranked");
    await act(async () => {
      history.forward();
      await router.load();
    });
    expect(screen.getByRole("textbox", { name: "Tag" })).toHaveValue("speedrun");

    view.unmount();
    history.destroy();
  });

  it("recreates the same rendered filters from a copied hash URL", async () => {
    installElectronAPIMock();
    window.location.hash =
      "#/categories/twitch/509658?tab=live&platform=twitch&language=en&tag=speedrun&sort=desc&otherId=15";
    const first = createCategoryRouter();
    await act(async () => {
      await first.router.load();
    });
    const firstView = renderWithProviders(<RouterProvider router={first.router} />);

    await waitFor(() => {
      expect(useCategoryLanguagePreferenceStore.getState().preferredLanguage).toBe("en");
    });

    const refreshHash = window.location.hash;
    firstView.unmount();
    first.history.destroy();
    window.location.hash = refreshHash;
    const refreshed = createCategoryRouter();
    await act(async () => {
      await refreshed.router.load();
    });
    const refreshedView = renderWithProviders(<RouterProvider router={refreshed.router} />);
    expect(screen.getByRole("textbox", { name: "Tag" })).toHaveValue("speedrun");
    expect(screen.getByRole("link", { name: "Twitch" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("English");
    expect(screen.getByRole("combobox", { name: "Viewer sort" })).toHaveTextContent("Most viewers");
    refreshedView.unmount();
    refreshed.history.destroy();
  });
});
