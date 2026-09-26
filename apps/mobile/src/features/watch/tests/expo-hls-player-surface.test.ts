import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ExpoHlsPlayerSurface", () => {
  it("pins Android VideoView to TextureView to avoid green/purple SurfaceView wash", () => {
    const source = readFileSync(
      new URL("../adapters/expo/expo-hls-player-surface.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('surfaceType: "textureView"');
    expect(source).toContain('Platform.OS === "android"');
    expect(source).toContain("useExoShutter={false}");
    expect(source).toContain('nativeControls={false}');
    expect(source).toContain('contentFit="contain"');
    expect(source).toContain('backgroundColor: "#000000"');
  });
});
