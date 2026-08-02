import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const OFFICIAL_7TV_IMAGE_SOURCES = ["https://cdn.7tv.app", "https://*.cdn.7tv.app"] as const;

function getDirectiveSources(
  entryPoint: "index.html" | "browser.html",
  directiveName: "connect-src" | "img-src"
): string[] {
  const html = readFileSync(resolve(__dirname, `../../${entryPoint}`), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];

  expect(csp, `${entryPoint} must declare a Content Security Policy`).toBeDefined();

  const directive = csp
    ?.split(";")
    .map((directive) => directive.trim())
    .find((candidate) => candidate.startsWith(`${directiveName} `));

  expect(directive, `${entryPoint} must declare ${directiveName}`).toBeDefined();
  return directive?.split(/\s+/).slice(1) ?? [];
}

// Guards: Electron and browser development entry points must allow canonical 7TV images and only official 7TV CDN edges
// Guards: the app renderer must connect to the exact 7TV Event API WebSocket origin without wildcard WebSocket access
describe("renderer Content Security Policy", () => {
  it.each([
    "index.html",
    "browser.html",
  ] as const)("%s permits the official 7TV CDN fallback without broadening image access", (entryPoint) => {
    const sevenTvSources = getDirectiveSources(entryPoint, "img-src").filter((source) =>
      source.includes("7tv")
    );

    expect(sevenTvSources).toEqual(OFFICIAL_7TV_IMAGE_SOURCES);
  });

  it("permits the exact 7TV Event API WebSocket origin without wildcard WebSocket access", () => {
    const sevenTvWebSocketSources = getDirectiveSources("index.html", "connect-src").filter(
      (source) => source.startsWith("wss://") && source.includes("7tv.io")
    );

    expect(sevenTvWebSocketSources).toEqual(["wss://events.7tv.io"]);
  });
});
