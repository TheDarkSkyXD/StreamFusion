import { create } from "zustand";
import { persist } from "zustand/middleware";

import { BROADCAST_LANGUAGES } from "@/lib/languages";

export type CategoryLanguage = "" | (typeof BROADCAST_LANGUAGES)[number];

export const DEFAULT_CATEGORY_LANGUAGE: CategoryLanguage = "";
export const CATEGORY_LANGUAGE_PREFERENCE_STORAGE_KEY = "streamfusion-category-language";
export const CATEGORY_LANGUAGE_PREFERENCE_STORE_VERSION = 1;

interface CategoryLanguagePreferenceState {
  preferredLanguage: CategoryLanguage;
  setPreferredLanguage: (language: CategoryLanguage) => void;
}

export function parseCategoryLanguage(value: unknown): CategoryLanguage | undefined {
  if (value === "") return DEFAULT_CATEGORY_LANGUAGE;
  if (typeof value !== "string") return undefined;
  return BROADCAST_LANGUAGES.find((language) => language === value);
}

export function migrateCategoryLanguagePreferenceState(
  persisted: unknown
): Pick<CategoryLanguagePreferenceState, "preferredLanguage"> {
  const state = typeof persisted === "object" && persisted !== null ? persisted : {};
  const preferredLanguage =
    "preferredLanguage" in state ? parseCategoryLanguage(state.preferredLanguage) : undefined;

  return { preferredLanguage: preferredLanguage ?? DEFAULT_CATEGORY_LANGUAGE };
}

export const useCategoryLanguagePreferenceStore = create<CategoryLanguagePreferenceState>()(
  persist(
    (set) => ({
      preferredLanguage: DEFAULT_CATEGORY_LANGUAGE,
      setPreferredLanguage: (preferredLanguage) => set({ preferredLanguage }),
    }),
    {
      name: CATEGORY_LANGUAGE_PREFERENCE_STORAGE_KEY,
      version: CATEGORY_LANGUAGE_PREFERENCE_STORE_VERSION,
      migrate: migrateCategoryLanguagePreferenceState,
      merge: (persisted, current) => ({
        ...current,
        ...migrateCategoryLanguagePreferenceState(persisted),
      }),
      partialize: ({ preferredLanguage }) => ({ preferredLanguage }),
    }
  )
);
