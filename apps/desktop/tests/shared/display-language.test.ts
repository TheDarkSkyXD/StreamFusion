import { describe, expect, it } from "vitest";

import {
  DISPLAY_LANGUAGE_REGISTRY,
  getDisplayLanguage,
  resolveDisplayLanguage,
} from "@shared/display-language";

// Guards: the display-language registry remains exactly the supported 50 unique canonical locales.
// Guards: regional tags and safe aliases preserve their intended locale and stream-language mapping.
describe("display languages", () => {
  it("contains exactly 50 unique language codes", () => {
    const codes = DISPLAY_LANGUAGE_REGISTRY.map(({ code }) => code);

    expect(codes).toHaveLength(50);
    expect(new Set(codes).size).toBe(50);
  });

  it.each([
    ["pt", "pt-BR"],
    ["PT-pt", "pt-PT"],
    ["zh", "zh-CN"],
    ["zh-Hans", "zh-CN"],
    ["zh-Hant", "zh-TW"],
    ["zh-Hant-HK", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["no", "nb"],
  ] as const)("resolves %s to %s", (input, expected) => {
    expect(resolveDisplayLanguage(input)).toBe(expected);
  });

  it("does not erase an unsupported regional distinction", () => {
    expect(resolveDisplayLanguage("pt-AO")).toBe("en");
  });

  it("maps regional display locales to provider stream languages", () => {
    expect(getDisplayLanguage("pt-BR").streamLanguage).toBe("pt");
    expect(getDisplayLanguage("pt-PT").streamLanguage).toBe("pt");
    expect(getDisplayLanguage("zh-CN").streamLanguage).toBe("zh");
    expect(getDisplayLanguage("zh-TW").streamLanguage).toBe("zh");
    expect(getDisplayLanguage("nb").streamLanguage).toBe("no");
  });
});
