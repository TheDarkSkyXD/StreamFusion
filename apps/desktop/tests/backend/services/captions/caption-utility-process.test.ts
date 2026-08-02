import { describe, expect, it } from "vitest";

import { captionUtilityEnvironment } from "@/backend/services/captions/caption-utility-process";

describe("captionUtilityEnvironment", () => {
  it("passes only runtime paths and temporary-directory variables to the utility", () => {
    expect(
      captionUtilityEnvironment({
        PATH: "C:/runtime",
        SystemRoot: "C:/Windows",
        TEMP: "C:/Temp",
        HOME: "C:/Users/viewer",
        STREAMFUSION_TOKEN: "must-not-cross-process",
        NODE_OPTIONS: "--inspect",
      })
    ).toEqual({
      PATH: "C:/runtime",
      SystemRoot: "C:/Windows",
      TEMP: "C:/Temp",
      HOME: "C:/Users/viewer",
    });
  });
});
