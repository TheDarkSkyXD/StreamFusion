import { KICK_APP_SCOPES } from "../../shared/auth-types";

export function getMissingKickScopes(scopes: readonly string[] | undefined): string[] {
  const granted = new Set(scopes ?? []);
  return KICK_APP_SCOPES.filter((scope) => !granted.has(scope));
}

export function hasCanonicalKickScopes(scopes: readonly string[] | undefined): boolean {
  return getMissingKickScopes(scopes).length === 0;
}
