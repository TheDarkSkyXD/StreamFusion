import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import {
  DISPLAY_LANGUAGE_REGISTRY,
  type DisplayLanguage,
  type DisplayLanguageDefinition,
} from "@shared/display-language";

import { en } from "./locales/en";
import { es } from "./locales/es";

export function resolveDisplayLanguage(value: unknown): DisplayLanguage {
  if (typeof value !== "string") return "en";
  const normalized = value.trim().toLowerCase().split("-")[0];
  return DISPLAY_LANGUAGE_REGISTRY.find(({ code }) => code === normalized)?.code ?? "en";
}

export function getDisplayLanguage(value: DisplayLanguage): DisplayLanguageDefinition {
  return (
    DISPLAY_LANGUAGE_REGISTRY.find(({ code }) => code === value) ?? DISPLAY_LANGUAGE_REGISTRY[0]
  );
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export { en, es, i18n };
