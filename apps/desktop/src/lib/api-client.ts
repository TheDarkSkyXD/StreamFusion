import ky from "ky";

import { logger } from "@/renderer/logging/logger";

/**
 * Generic API client based on Ky.
 *
 * Features pre-configured:
 * - Retry logic for network errors (2 retries)
 * - 30s timeout
 * - Hooks for logging or auth injection
 */
const apiClient = ky.create({
  timeout: 30000, // 30 seconds
  retry: {
    limit: 2,
    methods: ["get", "put", "head", "delete", "options", "trace"],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
  hooks: {
    beforeRequest: [
      (_request) => {
        // You can add global auth headers here if needed
        // request.headers.set('Authorization', `Bearer ${token}`);
      },
    ],
    afterResponse: [
      ({ request, response }) => {
        if (response.ok) return;
        // Any non-2xx is logged at error so it surfaces in the Logs viewer's
        // Error filter — matches what DevTools shows (red text for every
        // failed request). Some 4xx are expected (e.g. BTTV 404 for a channel
        // with no emotes); callers that know a specific status is benign
        // should suppress their own line rather than asking the client to
        // silently downgrade.
        logger.error("Lib:ApiClient", "request failed", {
          method: request.method,
          url: request.url,
          status: response.status,
        });
      },
    ],
  },
});

/**
 * Typed generic fetcher wrapper
 * Usage: const data = await api.get('https://...').json<MyType>();
 */
export const api = {
  get: (...args: Parameters<typeof apiClient.get>) => apiClient.get(...args),
  post: (...args: Parameters<typeof apiClient.post>) => apiClient.post(...args),
  put: (...args: Parameters<typeof apiClient.put>) => apiClient.put(...args),
  delete: (...args: Parameters<typeof apiClient.delete>) => apiClient.delete(...args),
  patch: (...args: Parameters<typeof apiClient.patch>) => apiClient.patch(...args),
  raw: apiClient, // Access raw Ky instance if needed
};
