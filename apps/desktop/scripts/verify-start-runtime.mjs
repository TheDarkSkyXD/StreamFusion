import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const runFile = resolve(process.argv[2]);
const run = JSON.parse(await readFile(runFile, "utf8"));
assert.equal(run.launcher?.mode, "preview:start", "Use a compiled Start candidate run");
const expectedDocument = pathToFileURL(
  resolve(import.meta.dirname, "../.cache/start/app/out/renderer/index.html")
).href;
const documentUrl = (url) => {
  const document = new URL(url);
  document.hash = "";
  return document.href;
};
assert.equal(
  documentUrl(run.rendererUrl),
  expectedDocument,
  "Run must own the Start file document"
);
const doctor = JSON.parse(
  execFileSync(
    process.execPath,
    [
      resolve(
        import.meta.dirname,
        "../../../.agents/skills/verify-streamfusion/scripts/control.mjs"
      ),
      "doctor",
      "--run",
      runFile,
    ],
    { encoding: "utf8", windowsHide: true }
  )
);
assert(doctor.healthy, "The maintained controller must verify process and profile ownership");
const targets = await fetch(`http://127.0.0.1:${run.port}/json/list`).then((response) =>
  response.json()
);
const target = targets.find(
  (page) =>
    page.type === "page" &&
    page.title === "StreamFusion" &&
    documentUrl(page.url) === expectedDocument
);
assert(target, "The owned StreamFusion window must be open");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ready, reject) => {
  socket.addEventListener("open", ready, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const diagnostics = [];
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } else if (
    message.method === "Runtime.exceptionThrown" ||
    (message.method === "Runtime.consoleAPICalled" &&
      ["error", "warning"].includes(message.params.type)) ||
    (message.method === "Log.entryAdded" && message.params.entry.level === "error")
  ) {
    diagnostics.push(message);
  }
});
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 20_000);
    pending.set(id, { resolve: resolveResult, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  diagnostics.length = 0;
  const loaded = new Promise((ready, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onLoad);
      reject(new Error("Reload did not finish"));
    }, 30_000);
    function onLoad({ data }) {
      if (JSON.parse(data).method !== "Page.loadEventFired") return;
      clearTimeout(timer);
      socket.removeEventListener("message", onLoad);
      ready();
    }
    socket.addEventListener("message", onLoad);
  });
  await send("Page.reload", { ignoreCache: true });
  await loaded;
  const deadline = Date.now() + 90_000;
  let page;
  while (Date.now() < deadline) {
    page = await evaluate(
      `({ url: location.href, title: document.title, bridge: !!window.electronAPI, sidebar: [...document.querySelectorAll('a')].some(link => link.textContent.trim() === 'Settings'), text: document.body.innerText, csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content, inlineScripts: [...document.scripts].filter(script => !script.src && (!script.type || script.type === 'module' || script.type === 'text/javascript')).length })`
    );
    if (page.sidebar) break;
    await delay(250);
  }
  await delay(1000);
  const expectedDevelopmentWarnings = new Set([
    "%cElectron Security Warning (Disabled webSecurity)",
    "%cElectron Security Warning (allowRunningInsecureContent)",
  ]);
  const failures = diagnostics.filter(
    (event) =>
      !(
        event.params.type === "warning" &&
        expectedDevelopmentWarnings.has(event.params.args?.[0]?.value)
      )
  );
  const report = { capturedAt: new Date().toISOString(), page, diagnostics, failures };
  await writeFile(resolve(run.evidenceDir, "start-reload.json"), JSON.stringify(report, null, 2));
  assert(page.sidebar && page.bridge, "Reload must restore the desktop and preload bridge");
  assert.equal(
    documentUrl(page.url),
    expectedDocument,
    "Reload must retain the Start file document"
  );
  assert(page.csp?.includes("script-src 'self';"), "The production script CSP must remain intact");
  assert.equal(
    page.inlineScripts,
    0,
    "The local-file shell must not require executable inline scripts"
  );
  assert.equal(failures.length, 0, "Reload must not produce console, CSP or hydration errors");
  console.log(
    JSON.stringify({
      passed: true,
      url: page.url,
      errors: failures.length,
      developmentWarnings: diagnostics.length,
    })
  );
} finally {
  socket.close();
}
