import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

import {
  assembleStartRenderer,
  transformStartHtml,
} from "../../scripts/assemble-start-renderer.mjs";

const policy =
  "<meta http-equiv=\"Content-Security-Policy\"\n content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'\" />";
const productionHtml = `<html><head>${policy}</head><body></body></html>`;
const temporaryRoots: string[] = [];

function elements(node: DefaultTreeAdapterMap["node"]): DefaultTreeAdapterMap["element"][] {
  return [
    ...("tagName" in node ? [node] : []),
    ...("childNodes" in node ? node.childNodes.flatMap(elements) : []),
  ];
}

function fixture(html: string) {
  const root = mkdtempSync(path.join(tmpdir(), "streamfusion-start-assets-"));
  temporaryRoots.push(root);
  const clientDir = path.join(root, "client");
  const rendererDir = path.join(root, "renderer");
  const productionHtmlPath = path.join(root, "production.html");
  mkdirSync(clientDir);
  writeFileSync(path.join(clientDir, "index.html"), html);
  writeFileSync(productionHtmlPath, productionHtml);
  return { clientDir, rendererDir, productionHtmlPath };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Guards: packaged Start bootstraps retain execution order, script attributes, data blocks, and the production CSP.
// Guards: assets resolve beside the packaged document and assembling Start never deletes the independent player.
// Guards: unsupported absolute paths and incomplete build output fail before a candidate is assembled.
describe("Start local-file assembly", () => {
  it("externalizes executable scripts without losing module, classic, or data-script semantics", () => {
    const result = transformStartHtml({
      productionHtml,
      html: `<html><head><script data-kind="first">globalThis.events = ["first"]</script>
        <script src="/./assets/existing.js" type="module" crossorigin="anonymous"></script>
        <script type="module" nonce="build-nonce" data-value="a > b">import "./assets/module.js"</script>
        <script type="application/ld+json">{"name":"data stays inline"}</script>
        <script type="text/javascript" nomodule>events.push("last")</script></head><body></body></html>`,
    });
    const nodes = elements(parse(result.html));
    const scripts = nodes.filter((node) => node.tagName === "script");
    const scriptAttributes = scripts.map((script) =>
      Object.fromEntries(script.attrs.map(({ name, value }) => [name, value]))
    );
    expect(scriptAttributes).toEqual([
      { "data-kind": "first", src: `./${result.scripts[0].filename}` },
      { src: "./assets/existing.js", type: "module", crossorigin: "anonymous" },
      {
        type: "module",
        nonce: "build-nonce",
        "data-value": "a > b",
        src: `./${result.scripts[1].filename}`,
      },
      { type: "application/ld+json" },
      { type: "text/javascript", nomodule: "", src: `./${result.scripts[2].filename}` },
    ]);
    expect(result.scripts.map((script) => script.content)).toEqual([
      'globalThis.events = ["first"]',
      'import "./assets/module.js"',
      'events.push("last")',
    ]);
    expect(result.html).toContain(
      '<script type="application/ld+json">{"name":"data stays inline"}</script>'
    );
    const context = { events: [] };
    runInNewContext(result.scripts[0].content, context);
    runInNewContext(result.scripts[2].content, context);
    expect(context.events).toEqual(["first", "last"]);
    expect(result.html.startsWith(`<html><head>${policy}<script`)).toBe(true);
  });

  it("replaces emitted policy with the exact production tag before resource elements", () => {
    const result = transformStartHtml({
      productionHtml,
      html: '<html><head><meta http-equiv="Content-Security-Policy" content="script-src * \'unsafe-inline\'"><link rel="stylesheet" href="/./assets/app.css"></head><body></body></html>',
    });
    expect(result.html).toBe(
      `<html><head>${policy}<link rel="stylesheet" href="./assets/app.css"></head><body></body></html>`
    );
    expect(result.assetPaths).toEqual(["./assets/app.css"]);
  });

  it("preserves remote asset paths while converting local bootstrap paths", () => {
    const result = transformStartHtml({
      productionHtml,
      html: '<html><head><script src="https://cdn.example/./assets/remote.js"></script><script>globalThis.paths=["https://cdn.example/./assets/remote.js","/./assets/local.js"]</script></head><body></body></html>',
    });
    expect(result.html).toContain('src="https://cdn.example/./assets/remote.js"');
    expect(result.scripts.map((script) => script.content)).toEqual([
      'globalThis.paths=["https://cdn.example/./assets/remote.js","./assets/local.js"]',
    ]);
    expect(result.assetPaths).toEqual(["./assets/local.js"]);
  });

  it("assembles relative assets and bootstrap references while preserving the existing slot output", () => {
    const options = fixture(
      '<html><head><link rel="stylesheet" href="/./assets/app.css"><script>globalThis.entry = "/./assets/app.js"</script><script type="module" src="/./assets/app.js"></script></head><body></body></html>'
    );
    mkdirSync(path.join(options.clientDir, "assets"));
    writeFileSync(path.join(options.clientDir, "assets/app.css"), "body{color:white}");
    writeFileSync(path.join(options.clientDir, "assets/app.js"), "globalThis.booted=true");
    const slot = path.join(options.rendererDir, "src/frontend/slot-renderer/index.html");
    mkdirSync(path.dirname(slot), { recursive: true });
    writeFileSync(slot, "<video id=player></video>");
    const result = assembleStartRenderer(options);
    expect(readFileSync(result.indexPath, "utf8")).toContain(
      '<script type="module" src="./assets/app.js"></script>'
    );
    expect(result.bootstrapFiles.map((file) => readFileSync(file, "utf8"))).toEqual([
      'globalThis.entry = "./assets/app.js"',
    ]);
    expect(readFileSync(path.join(options.rendererDir, "assets/app.css"), "utf8")).toBe(
      "body{color:white}"
    );
    expect(readFileSync(slot, "utf8")).toBe("<video id=player></video>");
  });

  it.each([
    '<script src="/assets/app.js"></script>',
    '<link href="/styles/app.css" rel="stylesheet">',
    '<script>globalThis.entry = "/assets/app.js"</script>',
    '<img srcset="./assets/small.png 1x, /assets/large.png 2x">',
    "<style>body{background:url(/assets/background.png)}</style>",
  ])("rejects an unresolved root-absolute resource in %s", (resource) => {
    expect(() =>
      transformStartHtml({
        productionHtml,
        html: `<html><head>${resource}</head><body></body></html>`,
      })
    ).toThrow(/Root-absolute local asset/);
  });

  it("rejects inline import maps that cannot use external files under the production policy", () => {
    expect(() =>
      transformStartHtml({
        productionHtml,
        html: '<html><head><script type="importmap">{"imports":{}}</script></head><body></body></html>',
      })
    ).toThrow("Inline importmap cannot be externalized");
  });

  it("rejects missing documents, missing assets, and missing CSP", () => {
    const options = fixture(
      '<html><head><script src="./assets/missing.js"></script></head><body></body></html>'
    );
    expect(() => assembleStartRenderer(options)).toThrow("Start client asset is missing");
    rmSync(path.join(options.clientDir, "index.html"));
    expect(() => assembleStartRenderer(options)).toThrow("Start client index.html is missing");
    expect(() =>
      transformStartHtml({
        productionHtml: "<html><head></head></html>",
        html: "<html><head></head></html>",
      })
    ).toThrow("Expected exactly one production Content-Security-Policy");
  });
});
