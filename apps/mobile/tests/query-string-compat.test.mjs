import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const mobileDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const config = require("../metro.config.js");
const queryString = require("../vendor/query-string-compat.cjs");

test("Expo Router receives the query-string CommonJS API", () => {
  const parsed = queryString.parse(
    "term=a+b&unicode=st%C3%A5le&tag=one&tag=two&empty",
  );

  assert.equal(parsed.term, "a b");
  assert.equal(parsed.unicode, "ståle");
  assert.deepEqual(parsed.tag, ["one", "two"]);
  assert.equal(parsed.empty, null);
  assert.equal(
    queryString.stringify(
      { term: "a b", tag: ["one", "two"], empty: null, omitted: undefined },
      { sort: false },
    ),
    "term=a%20b&tag=one&tag=two&empty",
  );
});

test("Metro redirects only Expo Router query-string imports", () => {
  const context = {
    originModulePath: "",
    resolveRequest: (_context, moduleName, platform) => ({
      filePath: `${moduleName}.${platform}`,
      type: "sourceFile",
    }),
  };

  for (const originModulePath of [
    path.join(
      mobileDirectory,
      "node_modules",
      "expo-router",
      "build",
      "fork",
      "getPathFromState.js",
    ),
    "/repo/node_modules/expo-router/build/fork/getPathFromState.js",
  ]) {
    assert.deepEqual(
      config.resolver.resolveRequest(
        { ...context, originModulePath },
        "query-string",
        "android",
      ),
      {
        filePath: path.join(
          mobileDirectory,
          "vendor",
          "query-string-compat.cjs",
        ),
        type: "sourceFile",
      },
    );
  }

  assert.deepEqual(
    config.resolver.resolveRequest(context, "react-native", "android"),
    {
      filePath: "react-native.android",
      type: "sourceFile",
    },
  );
});
