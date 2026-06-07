import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryFilterBar } from "@/components/discovery/category-filter-bar";
import { fireEvent, installElectronAPIMock, renderWithProviders, screen } from "../../test-utils";

describe("CategoryFilterBar", () => {
  const defaults = {
    language: "",
    onLanguageChange: vi.fn(),
    tagQuery: "",
    onTagQueryChange: vi.fn(),
    sortOrder: "desc" as const,
    onSortOrderChange: vi.fn(),
  };

  beforeEach(() => {
    installElectronAPIMock();
    vi.clearAllMocks();
  });

  it("renders the tag search input", () => {
    renderWithProviders(<CategoryFilterBar {...defaults} />);
    expect(screen.getByPlaceholderText("Search tags…")).toBeInTheDocument();
  });

  it("fires onTagQueryChange when the user types in the search input", () => {
    renderWithProviders(<CategoryFilterBar {...defaults} />);
    const input = screen.getByPlaceholderText("Search tags…");
    fireEvent.change(input, { target: { value: "fps" } });
    expect(defaults.onTagQueryChange).toHaveBeenCalledWith("fps");
  });

  it("renders with the provided tagQuery value", () => {
    renderWithProviders(<CategoryFilterBar {...defaults} tagQuery="moba" />);
    expect(screen.getByDisplayValue("moba")).toBeInTheDocument();
  });

  it("renders the language and sort select triggers", () => {
    renderWithProviders(<CategoryFilterBar {...defaults} />);
    const triggers = screen.getAllByRole("combobox");
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });
});
