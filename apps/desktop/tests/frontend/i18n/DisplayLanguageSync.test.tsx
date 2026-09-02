import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import { DisplayLanguageSync } from "@/i18n/DisplayLanguageSync";
import { i18n, resolveDisplayLanguage } from "@/i18n";
import { useAuthStore } from "@/store/auth-store";

// Guards: the renderer waits for auth initialization, then applies the persisted or fallback locale and document language.
describe("DisplayLanguageSync", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    useAuthStore.setState({ initialized: false, preferences: null });
  });

  it("waits for preferences before switching then applies Spanish", async () => {
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

  it("normalizes renderer locale tags and falls back to English", () => {
    expect(resolveDisplayLanguage("ES-mx")).toBe("es");
    expect(resolveDisplayLanguage("unsupported")).toBe("en");
    expect(resolveDisplayLanguage(null)).toBe("en");
  });
});
