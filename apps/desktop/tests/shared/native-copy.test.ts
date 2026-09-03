import { describe, expect, it } from "vitest";

import { DISPLAY_LANGUAGE_REGISTRY } from "@shared/display-language";
import { NATIVE_COPY, NATIVE_COPY_KEYS, nativeText } from "@shared/i18n/native-copy.generated";

// Guards: every supported display language has complete synchronous copy for Electron-owned UI.
// Guards: native copy interpolation resolves the selected language without importing renderer code.
describe("native Electron copy", () => {
  it("covers all 50 registered display languages with the same keys", () => {
    expect(DISPLAY_LANGUAGE_REGISTRY).toHaveLength(50);
    expect(Object.keys(NATIVE_COPY)).toEqual(
      DISPLAY_LANGUAGE_REGISTRY.map((language) => language.code)
    );
    for (const language of DISPLAY_LANGUAGE_REGISTRY) {
      expect(Object.keys(NATIVE_COPY[language.code]).sort()).toEqual([...NATIVE_COPY_KEYS].sort());
      expect(Object.values(NATIVE_COPY[language.code]).every((value) => value.trim())).toBe(true);
    }
  });

  it("selects and interpolates Spanish native copy", () => {
    expect(nativeText("es", "fileMenu")).toBe("Archivo");
    expect(nativeText("es", "channelIsLive", { channel: "Luna" })).toBe("Luna está en directo");
  });
});
