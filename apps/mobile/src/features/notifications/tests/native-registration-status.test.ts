import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_CREDENTIAL_ROTATION_FAILURE,
  NOTIFICATION_RATE_LIMIT_FAILURE,
  nativeRegistrationSnapshot,
} from "../domain/native-registration-status";

// Guards: rate-limit and credential-rotation failures stay in copy without tokens
describe("native registration status", () => {
  it("appends rate-limit and credential-rotation failures to reconciled copy", () => {
    const rateLimited = nativeRegistrationSnapshot({
      fingerprint: "abcd",
      lastFailure: NOTIFICATION_RATE_LIMIT_FAILURE,
      state: "registered",
      topicSubscriptions: 1,
    });
    expect(rateLimited.copy).toMatch(/Retry-After/);
    expect(rateLimited.copy).not.toContain("abcd");
    const rotated = nativeRegistrationSnapshot({
      fingerprint: "abcd",
      lastFailure: NOTIFICATION_CREDENTIAL_ROTATION_FAILURE,
      state: "registered",
      topicSubscriptions: 1,
    });
    expect(rotated.copy).toMatch(/credentials rotated/);
    expect(rotated.copy).toMatch(/without dropping Activity/);
  });
});
