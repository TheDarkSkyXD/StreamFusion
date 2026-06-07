import { logger } from "@/lib/cross-logger";
import type { KickUser } from "../../../../../shared/auth-types";
import { kickAuthService } from "../../../../auth/kick-auth";
import type { KickRequestor } from "../kick-requestor";
import type { KickApiResponse, KickApiUser } from "../kick-types";

/**
 * Get the currently authenticated user
 */
export async function getUser(): Promise<KickUser | null> {
  return kickAuthService.fetchCurrentUser();
}

/**
 * Get users by IDs
 * https://docs.kick.com/apis/users - GET /public/v1/users?id[]=:id
 */
export async function getUsersById(client: KickRequestor, ids: number[]): Promise<KickApiUser[]> {
  if (!client.isAuthenticated() || ids.length === 0) {
    return [];
  }

  try {
    const uniqueIds = Array.from(new Set(ids));
    // Manually construct query to ensure id[] is not encoded as id%5B%5D
    // Kick API can be picky about parameter encoding
    const queryParts = uniqueIds.map((id) => `id[]=${id}`);
    const queryString = queryParts.join("&");

    const response = await client.request<KickApiResponse<KickApiUser[]>>(`/users?${queryString}`);

    return response.data || [];
  } catch (error) {
    logger.error("Kick:Endpoints:User", "Failed to fetch Kick users", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return [];
  }
}
