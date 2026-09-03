import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import { DisplayLanguageSync } from "@/i18n/DisplayLanguageSync";
import { en, i18n, prepareDisplayLanguage } from "@/i18n";
import { DISPLAY_LANGUAGE_CATALOG_LOADERS } from "@/i18n/catalog-loaders.generated";
import { useAuthStore } from "@/store/auth-store";

// Guards: the renderer waits for a complete locale catalog before exposing the application or changing document metadata.
// Guards: right-to-left display languages update both i18next and the document direction.
// Guards: concurrent requests for one lazy locale share one catalog import.
describe("DisplayLanguageSync", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    i18n.removeResourceBundle("ar", "translation");
    i18n.removeResourceBundle("es", "translation");
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    useAuthStore.setState({ initialized: false, preferences: null });
  });

  it("waits for preferences before switching then applies Spanish", async () => {
    expect(i18n.hasResourceBundle("es", "translation")).toBe(false);
    const { queryByText, getByText } = render(
      <DisplayLanguageSync>
        <div>localized application</div>
      </DisplayLanguageSync>
    );
    expect(i18n.resolvedLanguage).toBe("en");
    expect(queryByText("localized application")).not.toBeInTheDocument();
    useAuthStore.setState({
      initialized: true,
      preferences: { ...DEFAULT_USER_PREFERENCES, language: "es" },
    });
    await waitFor(() => expect(i18n.resolvedLanguage).toBe("es"));
    expect(getByText("localized application")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("renders in English when initialization finishes without preferences", async () => {
    const { getByText } = render(
      <DisplayLanguageSync>
        <div>fallback application</div>
      </DisplayLanguageSync>
    );

    useAuthStore.setState({ initialized: true, preferences: null });

    await waitFor(() => expect(getByText("fallback application")).toBeInTheDocument());
    expect(i18n.resolvedLanguage).toBe("en");
  });

  it("loads an added RTL catalog before revealing children", async () => {
    useAuthStore.setState({
      initialized: true,
      preferences: { ...DEFAULT_USER_PREFERENCES, language: "en" },
    });
    const { getByText, queryByText } = render(
      <DisplayLanguageSync>
        <div>localized application</div>
      </DisplayLanguageSync>
    );
    await waitFor(() => expect(getByText("localized application")).toBeInTheDocument());

    act(() => {
      useAuthStore.setState({
        preferences: { ...DEFAULT_USER_PREFERENCES, language: "ar" },
      });
    });

    expect(queryByText("localized application")).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    await waitFor(() => expect(i18n.resolvedLanguage).toBe("ar"));
    expect(getByText("localized application")).toBeInTheDocument();
    expect(i18n.hasResourceBundle("ar", "translation")).toBe(true);
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("coalesces concurrent loads for the same locale", async () => {
    i18n.removeResourceBundle("fr", "translation");
    const originalLoader = DISPLAY_LANGUAGE_CATALOG_LOADERS.fr;
    const loader = vi.fn(async () => ({ default: en }));
    DISPLAY_LANGUAGE_CATALOG_LOADERS.fr = loader;

    try {
      await Promise.all([prepareDisplayLanguage("fr"), prepareDisplayLanguage("fr")]);
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      DISPLAY_LANGUAGE_CATALOG_LOADERS.fr = originalLoader;
      i18n.removeResourceBundle("fr", "translation");
    }
  });
});
