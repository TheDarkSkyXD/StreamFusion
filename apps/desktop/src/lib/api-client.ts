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
      (request, _options, response) => {
        if (!response.ok) {
          // Centralized error logging can go here
          logger.warn("Lib:ApiClient", "request failed", {
            method: request.method,
            url: request.url,
            status: response.status,
          });
        }
      },
    ],
  },
});

/**
 * Typed generic fetcher wrapper
 * Usage: const data = await api.get('https://...').json<MyType>();
 */
export const api = {
  get: (url: string, options?: any) => apiClient.get(url, options),
  post: (url: string, options?: any) => apiClient.post(url, options),
  put: (url: string, options?: any) => apiClient.put(url, options),
  delete: (url: string, options?: any) => apiClient.delete(url, options),
  patch: (url: string, options?: any) => apiClient.patch(url, options),
  raw: apiClient, // Access raw Ky instance if needed
};
