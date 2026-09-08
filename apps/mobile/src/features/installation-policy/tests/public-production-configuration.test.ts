import { describe, expect, it } from "vitest";

import { publicProductionConfigurationFromEnvironment } from "../composition/installation-policy-runtime";

describe("public production policy configuration", () => {
  it("passes only declared public relay data to composition", () => {
    expect(
      publicProductionConfigurationFromEnvironment({
        relayUrl: "https://relay.example/",
        trustedKeysJson: JSON.stringify({
          "production-policy-1": "A".repeat(43),
        }),
      }),
    ).toEqual({
      baseUrl: "https://relay.example/",
      trustedKeys: { "production-policy-1": "A".repeat(43) },
    });
  });

  it("fails closed for absent or malformed public configuration", () => {
    expect(
      publicProductionConfigurationFromEnvironment({
        relayUrl: undefined,
        trustedKeysJson: undefined,
      }),
    ).toBeUndefined();
    expect(
      publicProductionConfigurationFromEnvironment({
        relayUrl: "https://relay.example/",
        trustedKeysJson: "[]",
      }),
    ).toBeUndefined();
  });
});
