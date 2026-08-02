import type { ConnectivityCheckResult } from "@shared/ipc-channels";

export const CONNECTIVITY_ENDPOINTS = [
  "https://www.gstatic.com/generate_204",
  "https://cp.cloudflare.com/generate_204",
] as const;

export const CONNECTIVITY_TIMEOUT_MS = 3_000;

type ReachabilityRequest = (url: string, init: RequestInit) => Promise<Response>;

interface CheckInternetReachabilityOptions {
  request: ReachabilityRequest;
  endpoints?: readonly string[];
  timeoutMs?: number;
}

export async function checkInternetReachability({
  request,
  endpoints = CONNECTIVITY_ENDPOINTS,
  timeoutMs = CONNECTIVITY_TIMEOUT_MS,
}: CheckInternetReachabilityOptions): Promise<ConnectivityCheckResult> {
  for (const endpoint of endpoints) {
    try {
      const response = await request(endpoint, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 204) return { reachable: true };
    } catch {
      // Try the fallback. Network failures and captive-portal redirects both
      // mean this endpoint did not prove end-to-end internet reachability.
    }
  }

  return { reachable: false };
}
