import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from "@shared/display-language";

import { DISPLAY_LANGUAGE_CATALOG_LOADERS } from "./catalog-loaders.generated";
import { en } from "./locales/en";

const catalogLoads = new Map<DisplayLanguage, Promise<void>>();
let languageActivation = Promise.resolve();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: DEFAULT_DISPLAY_LANGUAGE,
  fallbackLng: DEFAULT_DISPLAY_LANGUAGE,
  interpolation: { escapeValue: false },
});

export async function prepareDisplayLanguage(language: DisplayLanguage): Promise<void> {
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

export { en, i18n };
