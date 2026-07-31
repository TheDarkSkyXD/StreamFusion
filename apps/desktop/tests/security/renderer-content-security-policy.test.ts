import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OFFICIAL_7TV_IMAGE_SOURCES = ["https://cdn.7tv.app", "https://*.cdn.7tv.app"] as const;

function getImageSources(entryPoint: "index.html" | "browser.html"): string[] {
  const html = readFileSync(resolve(__dirname, `../../${entryPoint}`), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];

  expect(csp, `${entryPoint} must declare a Content Security Policy`).toBeDefined();

  const imageDirective = csp
    ?.split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("img-src "));

  expect(imageDirective, `${entryPoint} must declare img-src`).toBeDefined();
  return imageDirective?.split(/\s+/).slice(1) ?? [];
}

// Guards: Electron and browser development entry points must allow canonical 7TV images and only official 7TV CDN edges
describe("renderer Content Security Policy", () => {
  it.each([
    "index.html",
    "browser.html",
  ] as const)("%s permits the official 7TV CDN fallback without broadening image access", (entryPoint) => {
    const sevenTvSources = getImageSources(entryPoint).filter((source) => source.includes("7tv"));

    expect(sevenTvSources).toEqual(OFFICIAL_7TV_IMAGE_SOURCES);
  });
});
