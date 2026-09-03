import { describe, expect, it } from "vitest";

import { isUntranslatedEnglishProse } from "../../scripts/i18n-catalog-quality.mjs";

// Guards: complete catalogs cannot pass while non-English entries still contain unchanged English prose.
describe("i18n catalog quality", () => {
  it("finds unchanged English prose after removing placeholders and product names", () => {
    expect(
      isUntranslatedEnglishProse(
        "Reconnect Twitch to use {{command}}",
        "Reconnect Twitch to use {{command}}"
      )
    ).toBe(true);
  });

  it("accepts translated prose and language-neutral short values", () => {
    expect(isUntranslatedEnglishProse("Open logs folder", "Abrir carpeta de registros")).toBe(
      false
    );
    expect(isUntranslatedEnglishProse("N/A", "N/A")).toBe(false);
    expect(isUntranslatedEnglishProse("1440p / 2K", "1440p / 2K")).toBe(false);
  });
});
