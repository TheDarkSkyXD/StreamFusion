import type { settingsEn } from "../en/settings";
import type { TranslationShape } from "../schema";

export const settingsEs = {
  settings: {
    general: "General",
    generalDescription: "Preferencias de idioma y de la aplicación.",
    displayLanguage: "Idioma de visualización",
    languageDescription: "Elige el idioma usado por la interfaz de StreamFusion.",
  },
} satisfies TranslationShape<typeof settingsEn>;
