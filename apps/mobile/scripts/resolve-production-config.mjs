import { createRequire } from "node:module";

const resolveAppConfig = createRequire(import.meta.url)("../native-config.cjs");

const resolved = resolveAppConfig();

console.log(
  JSON.stringify(
    {
      name: resolved.name,
      slug: resolved.slug,
      scheme: resolved.scheme,
      version: resolved.version,
      package: resolved.android.package,
      versionCode: resolved.android.versionCode,
    },
    null,
    2,
  ),
);
