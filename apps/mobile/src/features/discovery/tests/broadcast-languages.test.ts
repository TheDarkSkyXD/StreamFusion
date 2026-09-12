import { describe, expect, it } from "vitest";

import {
  BROADCAST_LANGUAGES,
  languageLabel,
} from "../domain/broadcast-languages";

describe("languageLabel", () => {
  it("uses a static table so Hermes can boot without Intl.DisplayNames", () => {
    expect(languageLabel("all")).toBe("All languages");
    expect(languageLabel("en")).toBe("English");
    expect(BROADCAST_LANGUAGES.every((code) => languageLabel(code).length > 0)).toBe(
      true,
    );
  });
});
