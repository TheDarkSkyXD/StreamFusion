import { describe, expect, it } from "vitest";

import { createTwitchAdFrameProofConfig } from "@/dev-relay/twitch-ad-frame-proof-config";

// Guards: the Twitch ad-frame proof proxy is available only through its explicit, run-scoped development route.
describe("Twitch ad-frame proof Vite config", () => {
  it("creates a fixed loopback proxy for an explicitly enabled development run", () => {
    const config = createTwitchAdFrameProofConfig({
      command: "serve",
      mode: "development",
      env: { STREAMFUSION_TWITCH_AD_FRAME_PROOF: "adframe-20260803-r3" },
    });

    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error("Expected proof config to be enabled");
    expect(config.prefix).toBe("/__streamfusion-proof/twitch-ad-frame/adframe-20260803-r3/");
    expect(config.proxy).toMatchObject({
      target: "http://127.0.0.1:18765",
      changeOrigin: false,
    });
  });

  it("rejects an invalid explicit run ID", () => {
    expect(() =>
      createTwitchAdFrameProofConfig({
        command: "serve",
        mode: "development",
        env: { STREAMFUSION_TWITCH_AD_FRAME_PROOF: "../../../shared-proof" },
      })
    ).toThrow("Twitch ad-frame proof requires a valid run ID");
  });

  it("rewrites only the exact run-scoped route", () => {
    const config = createTwitchAdFrameProofConfig({
      command: "serve",
      mode: "development",
      env: { STREAMFUSION_TWITCH_AD_FRAME_PROOF: "proof_run-3" },
    });

    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error("Expected proof config to be enabled");

    const rewrite = config.proxy.rewrite;
    const prefix = "/__streamfusion-proof/twitch-ad-frame/proof_run-3/";
    expect(rewrite(prefix)).toBe("/");
    expect(rewrite(`${prefix}usher.ttvnw.net/master.m3u8?token=redacted`)).toBe(
      "/usher.ttvnw.net/master.m3u8?token=redacted"
    );
    expect(rewrite(`${prefix}master.m3u8`)).toBe("/master.m3u8");
  });

  it("does not let Vite prefix matching claim a sibling run ID", () => {
    const config = createTwitchAdFrameProofConfig({
      command: "serve",
      mode: "development",
      env: { STREAMFUSION_TWITCH_AD_FRAME_PROOF: "proof_run-3" },
    });

    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error("Expected proof config to be enabled");

    const siblingRunPath = "/__streamfusion-proof/twitch-ad-frame/proof_run-3-other/master.m3u8";
    expect(siblingRunPath.startsWith(config.prefix)).toBe(false);
  });

  it("stays disabled without an explicit proof run ID", () => {
    expect(
      createTwitchAdFrameProofConfig({
        command: "serve",
        mode: "development",
        env: {},
      })
    ).toEqual({ enabled: false });
  });

  it("stays disabled outside development serve even when the flag leaks in", () => {
    const env = { STREAMFUSION_TWITCH_AD_FRAME_PROOF: "leaked-proof-run" };

    expect(createTwitchAdFrameProofConfig({ command: "build", mode: "production", env })).toEqual({
      enabled: false,
    });
    expect(
      createTwitchAdFrameProofConfig({
        command: "build",
        mode: "development",
        env,
      })
    ).toEqual({ enabled: false });
    expect(createTwitchAdFrameProofConfig({ command: "serve", mode: "production", env })).toEqual({
      enabled: false,
    });
  });
});
