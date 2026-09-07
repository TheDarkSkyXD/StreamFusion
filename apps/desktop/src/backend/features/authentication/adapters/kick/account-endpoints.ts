import type { KickUser } from "../../../../../shared/auth-types";
import { kickAuthService } from "../../../authentication/adapters/kick/kick-auth";
export async function getUser(): Promise<KickUser | null> {
  return kickAuthService.fetchCurrentUser();
}
