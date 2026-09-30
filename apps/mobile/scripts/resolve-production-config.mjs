import { createRequire } from "node:module";

// app.config.js is CommonJS because Expo requires it, so a default import is
// the only form that works from an ES module. Named ESM imports of its
// module.exports fail on Node.
const resolveAppConfig = createRequire(import.meta.url)("../app.config.js");

const resolved = resolveAppConfig();

console.log(
  JSON.stringify(
    {
      name: resolved.name,
      slug: resolved.slug,
      scheme: resolved.scheme,
      version: resolved.version,
      owner: resolved.owner,
      package: resolved.android.package,
      versionCode: resolved.android.versionCode,
      projectId: resolved.extra.eas.projectId,
    },
    null,
    2,
  ),
);
