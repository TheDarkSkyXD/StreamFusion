import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "parse5";

const javascriptTypes = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
  "application/x-javascript",
  "text/jscript",
  "text/livescript",
  "text/x-javascript",
  "text/x-ecmascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
]);

function elements(node) {
  return [
    node,
    ...(node.childNodes ?? []).flatMap(elements),
    ...(node.content ? elements(node.content) : []),
  ].filter((item) => item.tagName);
}

function attribute(node, name) {
  return node.attrs.find((item) => item.name === name)?.value;
}

function isCsp(node) {
  return (
    node.tagName === "meta" &&
    attribute(node, "http-equiv")?.toLowerCase() === "content-security-policy"
  );
}

export function transformStartHtml({ html, productionHtml }) {
  const policies = elements(parse(productionHtml, { sourceCodeLocationInfo: true })).filter(isCsp);
  if (policies.length !== 1 || !attribute(policies[0], "content")) {
    throw new Error("Expected exactly one production Content-Security-Policy meta tag");
  }
  const policyLocation = policies[0].sourceCodeLocation;
  const policy = productionHtml.slice(policyLocation.startOffset, policyLocation.endOffset);
  const normalized = html.replace(/(?<=["'`=\s(])\/\.\/assets\//g, "./assets/");
  const nodes = elements(parse(normalized, { sourceCodeLocationInfo: true }));
  const head = nodes.find((node) => node.tagName === "head");
  if (!head?.sourceCodeLocation?.startTag)
    throw new Error("Start client index.html must contain an explicit head element");
  const edits = [
    {
      start: head.sourceCodeLocation.startTag.endOffset,
      end: head.sourceCodeLocation.startTag.endOffset,
      value: policy,
    },
  ];
  const scripts = [];
  const assetPaths = new Set();

  function recordAsset(value) {
    if (!value || value.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(value)) return;
    if (value.startsWith("/"))
      throw new Error(`Root-absolute local asset remains in Start HTML: ${value}`);
    assetPaths.add(value.split(/[?#]/, 1)[0]);
  }

  for (const node of nodes) {
    if (isCsp(node)) {
      const location = node.sourceCodeLocation;
      edits.push({ start: location.startOffset, end: location.endOffset, value: "" });
      continue;
    }
    if (node.tagName === "base")
      throw new Error("Start local-file HTML cannot contain a base element");
    for (const name of [
      "src",
      "poster",
      ...(node.tagName === "link" ? ["href"] : []),
      ...(node.tagName === "object" ? ["data"] : []),
    ]) {
      recordAsset(attribute(node, name));
    }
    const srcset = attribute(node, "srcset");
    for (const candidate of (srcset ?? "").matchAll(
      /(?:^|,)\s*(data:[^\s]+|[^\s,]+)(?:\s+[^,]*)?/g
    ))
      recordAsset(candidate[1]);
    const styles =
      node.tagName === "style"
        ? (node.childNodes ?? []).map((child) => child.value ?? "").join("")
        : (attribute(node, "style") ?? "");
    for (const match of styles.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g))
      recordAsset(match[1]);
    if (node.tagName !== "script" || attribute(node, "src") !== undefined) continue;
    const type = (attribute(node, "type") ?? "").trim().toLowerCase();
    if (type === "importmap" || type === "speculationrules") {
      throw new Error(`Inline ${type} cannot be externalized under the desktop CSP`);
    }
    if (!javascriptTypes.has(type)) continue;
    const location = node.sourceCodeLocation;
    if (!location?.startTag || !location.endTag)
      throw new Error("Start inline script must have a closing tag");
    const body = normalized.slice(location.startTag.endOffset, location.endTag.startOffset);
    if (/["'`]\/[^"'`\s]*(?:assets\/|\.(?:js|mjs|css|wasm)(?:[?#"'`]))/.test(body)) {
      throw new Error("Root-absolute local asset remains in Start bootstrap script");
    }
    for (const match of body.matchAll(/["'`](\.\/assets\/[^"'`]+)["'`]/g)) recordAsset(match[1]);
    const filename = `start-bootstrap-${createHash("sha256").update(body).digest("hex")}.js`;
    scripts.push({ filename, content: body });
    const startTag = normalized.slice(location.startTag.startOffset, location.startTag.endOffset);
    edits.push({
      start: location.startOffset,
      end: location.endOffset,
      value: `${startTag.slice(0, -1)} src="./${filename}"></script>`,
    });
  }
  let result = normalized;
  for (const edit of edits.sort(
    (left, right) => right.start - left.start || right.end - left.end
  )) {
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  }
  return { html: result, scripts, assetPaths: [...assetPaths] };
}

export function assembleStartRenderer({ clientDir, rendererDir, productionHtmlPath }) {
  const clientRoot = path.resolve(clientDir);
  const rendererRoot = path.resolve(rendererDir);
  const indexPath = path.join(clientRoot, "index.html");
  if (!existsSync(indexPath)) throw new Error(`Start client index.html is missing: ${indexPath}`);
  if (!existsSync(productionHtmlPath))
    throw new Error(`Production CSP document is missing: ${productionHtmlPath}`);
  if (
    clientRoot === rendererRoot ||
    rendererRoot.startsWith(clientRoot + path.sep) ||
    clientRoot.startsWith(rendererRoot + path.sep)
  ) {
    throw new Error("Start client and renderer output directories must be separate");
  }
  const result = transformStartHtml({
    html: readFileSync(indexPath, "utf8"),
    productionHtml: readFileSync(productionHtmlPath, "utf8"),
  });
  for (const asset of result.assetPaths) {
    const assetPath = path.resolve(clientRoot, decodeURIComponent(asset));
    if (
      !assetPath.startsWith(clientRoot + path.sep) ||
      !existsSync(assetPath) ||
      !statSync(assetPath).isFile()
    ) {
      throw new Error(`Start client asset is missing or outside its output directory: ${asset}`);
    }
  }
  if (existsSync(path.join(clientRoot, "src/frontend/slot-renderer"))) {
    throw new Error("Start client output overlaps the independent slot renderer");
  }
  for (const script of result.scripts) {
    if (existsSync(path.join(clientRoot, script.filename)))
      throw new Error(`Start bootstrap filename collision: ${script.filename}`);
  }
  cpSync(clientRoot, rendererRoot, { recursive: true });
  for (const script of result.scripts)
    writeFileSync(path.join(rendererRoot, script.filename), script.content);
  writeFileSync(path.join(rendererRoot, "index.html"), result.html);
  return {
    indexPath: path.join(rendererRoot, "index.html"),
    bootstrapFiles: result.scripts.map((script) => path.join(rendererRoot, script.filename)),
  };
}
