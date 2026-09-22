/* eslint-disable import/no-named-as-default-member -- i18next default instance API */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import {
  DEFAULT_DISPLAY_LANGUAGE,
  type DisplayLanguage,
} from "@streamfusion/core/display-language";

import { DISPLAY_LANGUAGE_CATALOG_LOADERS } from "./catalog-loaders";

const catalogLoads = new Map<DisplayLanguage, Promise<void>>();
let languageActivation = Promise.resolve();

async function loadEnglishCatalog(): Promise<Record<string, unknown>> {
  const { en } = await import("@desktop-i18n/locales/en");
  return en as Record<string, unknown>;
}

let bootstrapped = false;

export async function bootstrapMobileI18n(): Promise<typeof i18n> {
  if (bootstrapped) return i18n;
  const en = await loadEnglishCatalog();
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: { en: { translation: en } },
      lng: DEFAULT_DISPLAY_LANGUAGE,
      fallbackLng: DEFAULT_DISPLAY_LANGUAGE,
      interpolation: { escapeValue: false },
      compatibilityJSON: "v4",
    });
  } else if (!i18n.hasResourceBundle(DEFAULT_DISPLAY_LANGUAGE, "translation")) {
    i18n.addResourceBundle(DEFAULT_DISPLAY_LANGUAGE, "translation", en, true, true);
  }
  bootstrapped = true;
  return i18n;
}

void bootstrapMobileI18n();

export async function prepareDisplayLanguage(language: DisplayLanguage): Promise<void> {
  await bootstrapMobileI18n();
  if (i18n.hasResourceBundle(language, "translation")) return;

  const existingLoad = catalogLoads.get(language);
  if (existingLoad) return existingLoad;

  if (language === "en") return;
  const load = DISPLAY_LANGUAGE_CATALOG_LOADERS[language]()
    .then(({ default: catalog }) => {
      i18n.addResourceBundle(language, "translation", catalog, true, true);
    })
    .finally(() => {
      catalogLoads.delete(language);
    });
  catalogLoads.set(language, load);
  return load;
}

export function activateDisplayLanguage(language: DisplayLanguage): Promise<void> {
  const activation = languageActivation.then(async () => {
    await prepareDisplayLanguage(language);
    if (i18n.resolvedLanguage !== language) await i18n.changeLanguage(language);
  });
  languageActivation = activation.catch(() => undefined);
  return activation;
}

export { i18n };
