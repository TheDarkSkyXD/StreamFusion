import { resolveAppConfig } from "../app.config.js";

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
