import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREDICTION_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  type PredictionPreferences,
  type UserPreferences,
} from "@/shared/auth-types";

describe("PredictionPreferences defaults (U1)", () => {
  it("defaults predictions.style to 'native'", () => {
    expect(DEFAULT_USER_PREFERENCES.predictions.style).toBe("native");
    expect(DEFAULT_PREDICTION_PREFERENCES.style).toBe("native");
  });

  it("includes predictions on the top-level UserPreferences shape", () => {
    const prefs: UserPreferences = DEFAULT_USER_PREFERENCES;
    // Type-level check: predictions is a required field. If U1 forgot to wire
    // predictions into UserPreferences, this assignment would fail to compile.
    const style: PredictionPreferences["style"] = prefs.predictions.style;
    expect(style).toBe("native");
  });

  it("accepts 'unified' as a valid style", () => {
    const unifiedPrefs: PredictionPreferences = { style: "unified" };
    expect(unifiedPrefs.style).toBe("unified");
  });
});
