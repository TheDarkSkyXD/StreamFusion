import { describe, expect, it } from "vitest";

import { createHmacInstallationCredentialAuthority } from "../adapters/hmac-installation-credential-authority";

describe("HMAC installation credential authority", () => {
  it("keeps independently issued installations distinct and rejects altered bearers", async () => {
    const authority = createHmacInstallationCredentialAuthority({
      secret: "development-local-proof-secret-2026-09-07"
    });
    const first = await authority.issue({
      environment: "development",
      expiresAtEpochMs: 9_000,
      generation: 1,
      installationId: "installation-one"
    });
    const second = await authority.issue({
      environment: "development",
      expiresAtEpochMs: 9_000,
      generation: 1,
      installationId: "installation-two"
    });

    expect(first).not.toBe(second);
    await expect(
      authority.verify({ credential: first })
    ).resolves.toMatchObject({ installationId: "installation-one" });
    await expect(
      authority.verify({ credential: second })
    ).resolves.toMatchObject({ installationId: "installation-two" });
    await expect(
      authority.verify({ credential: `${first}x` })
    ).resolves.toBeNull();
  });
});
