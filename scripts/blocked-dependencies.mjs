export const BLOCKED_DEPENDENCIES = new Map([
  ["braces", "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"],
  ["node-forge", "https://github.com/advisories/GHSA-86w9-cpqp-85rv"],
  ["http-cache-semantics", "https://github.com/advisories/GHSA-ch52-4w7c-c8xp"],
]);

export function blockedDependency(dependency, specifier) {
  const alias =
    typeof specifier === "string"
      ? specifier.match(/^npm:((?:@[^/]+\/)?[^@]+)(?:@.*)?$/u)?.[1]
      : undefined;
  return [dependency, alias].find((name) => BLOCKED_DEPENDENCIES.has(name));
}

export function findBlockedRuntimeDependencies({ direct, bundled }) {
  const packages = new Set(direct);
  for (const node of bundled) {
    const name = node.match(
      /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u,
    )?.[1];
    if (name) packages.add(name);
  }
  return [...BLOCKED_DEPENDENCIES.keys()].filter((name) => packages.has(name));
}
