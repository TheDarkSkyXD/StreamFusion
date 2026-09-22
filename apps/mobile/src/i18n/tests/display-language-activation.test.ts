import { beforeAll, describe, expect, it } from "vitest";

import { activateDisplayLanguage, bootstrapMobileI18n, i18n } from "@mobile/i18n";

describe("mobile display language activation", () => {
  beforeAll(async () => {
    await bootstrapMobileI18n();
  });

  it("switches navigation.settings copy when French is activated", async () => {
    await activateDisplayLanguage("en");
    expect(i18n.t("navigation.settings")).toBe("Settings");
    await activateDisplayLanguage("fr");
    expect(i18n.resolvedLanguage ?? i18n.language).toBe("fr");
    expect(i18n.t("navigation.settings")).toBe("Paramètres");
    expect(i18n.t("settings.displayLanguage")).toBe("Langue d'affichage");
  });

  it("loads Spanish from the shared hand-authored catalog", async () => {
    await activateDisplayLanguage("es");
    expect(i18n.t("navigation.settings")).toBe("Configuración");
  });
});
