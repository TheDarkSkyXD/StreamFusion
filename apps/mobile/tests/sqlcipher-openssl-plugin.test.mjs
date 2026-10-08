import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { applySqlcipherOpenSsl, OPENSSL_COORDINATE } =
  require("../plugins/with-sqlcipher-openssl.js");

const appGradle = `android {
  defaultConfig {}
}
dependencies {
    implementation("com.facebook.react:react-android")
}
`;

test("SQLCipher OpenSSL Prefab libraries become app JNI inputs", () => {
  const app = JSON.parse(readFileSync("app.json", "utf8")).expo;
  assert.ok(app.plugins.includes("./plugins/with-sqlcipher-openssl"));
  assert.ok(app.plugins.some((plugin) =>
    Array.isArray(plugin) && plugin[0] === "expo-sqlite" &&
    plugin[1]?.android?.useSQLCipher === true));

  const patched = applySqlcipherOpenSsl(appGradle);
  assert.match(patched, new RegExp(`sqlcipherOpenSsl "${OPENSSL_COORDINATE.replaceAll(".", "\\.")}@aar"`, "u"));
  assert.equal(patched.split(OPENSSL_COORDINATE).length - 1, 1);
  assert.equal(applySqlcipherOpenSsl(patched), patched);
});

test("SQLCipher OpenSSL plugin rejects an unknown app Gradle layout or version", () => {
  assert.throws(() => applySqlcipherOpenSsl("android {}\n"), /Android and dependencies blocks/u);
  assert.throws(
    () => applySqlcipherOpenSsl(`${appGradle}\nimplementation 'io.github.ronickg:openssl:1.0'\n`),
    /different version/u,
  );
  assert.throws(
    () => applySqlcipherOpenSsl(`${appGradle}\nimplementation '${OPENSSL_COORDINATE}'\n`),
    /outside its JNI packaging block/u,
  );
});
