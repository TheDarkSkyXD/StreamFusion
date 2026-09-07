const ACTIVITY_ROUTES = new Set([
  "following",
  "categories",
  "search",
  "stream",
  "video",
  "settings",
  "multistream",
  "history",
  "downloads",
  "mod",
]);

export function normalizedRoute(hash: string, pathname: string): string {
  const rawPath = hash.startsWith("#") ? hash.slice(1).split("?", 1)[0] : pathname;
  const root = rawPath.split("/").filter(Boolean)[0];
  return root && ACTIVITY_ROUTES.has(root) ? `/${root}` : "/";
}
