import { beforeEach, describe, expect, it } from "vitest";

import {
  CATEGORY_LANGUAGE_PREFERENCE_STORAGE_KEY,
  CATEGORY_LANGUAGE_PREFERENCE_STORE_VERSION,
  DEFAULT_CATEGORY_LANGUAGE,
  useCategoryLanguagePreferenceStore,
} from "@/features/discovery/data/category-language-preference-store";

beforeEach(() => {
  localStorage.clear();
  useCategoryLanguagePreferenceStore.setState({
    preferredLanguage: DEFAULT_CATEGORY_LANGUAGE,
  });
});

// Guards: a renderer restart keeps the last valid Category language selection.
// Guards: malformed current-version persisted Category language state cannot escape as a filter value.
describe("category-language-preference-store", () => {
  it("persists a valid language across rehydration", async () => {
    useCategoryLanguagePreferenceStore.getState().setPreferredLanguage("es");
    const saved = localStorage.getItem(CATEGORY_LANGUAGE_PREFERENCE_STORAGE_KEY);

    useCategoryLanguagePreferenceStore.setState({
      preferredLanguage: DEFAULT_CATEGORY_LANGUAGE,
    });
    if (saved === null) throw new Error("Expected the language preference to be persisted");
    localStorage.setItem(CATEGORY_LANGUAGE_PREFERENCE_STORAGE_KEY, saved);
    await useCategoryLanguagePreferenceStore.persist.rehydrate();

    expect(useCategoryLanguagePreferenceStore.getState().preferredLanguage).toBe("es");
  });

  it("defaults malformed current-version storage to All languages", async () => {
    localStorage.setItem(
      CATEGORY_LANGUAGE_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        state: { preferredLanguage: "not-a-language" },
        version: CATEGORY_LANGUAGE_PREFERENCE_STORE_VERSION,
      })
    );

    await useCategoryLanguagePreferenceStore.persist.rehydrate();

    expect(useCategoryLanguagePreferenceStore.getState().preferredLanguage).toBe(
      DEFAULT_CATEGORY_LANGUAGE
    );
  });
});
