import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("ExpoHlsPlayerSurface", () => {
  it("pins Android VideoView to TextureView to avoid green/purple SurfaceView wash", () => {
    const source = readFileSync(
      join(here, "../adapters/expo/expo-hls-player-surface.tsx"),
      "utf8",
    );
    expect(source).toContain('surfaceType={Platform.OS === "android" ? "textureView" : undefined}');
    expect(source).toContain("useExoShutter={false}");
    expect(source).toContain('nativeControls={false}');
    expect(source).toContain('contentFit="contain"');
    expect(source).toContain('backgroundColor: "#000000"');
  });
});