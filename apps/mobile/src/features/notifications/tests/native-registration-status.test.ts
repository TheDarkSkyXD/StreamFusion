import { describe, expect, it } from "vitest";

import { nativeRegistrationSnapshot } from "../domain/native-registration-status";

describe("native registration status", () => {
  it("appends registration failures without exposing the token fingerprint", () => {
    const failed = nativeRegistrationSnapshot({
      fingerprint: "abcd",
      lastFailure: "Registration failed. Try again later.",
      state: "registered",
    });
    expect(failed.copy).toContain("Registration failed. Try again later.");
    expect(failed.copy).not.toContain("abcd");
  });
});
