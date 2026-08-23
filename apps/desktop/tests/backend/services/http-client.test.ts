import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { httpClient } from "@/backend/services/http-client";

function okResponse(body = "ok"): Response {
  return new Response(body, { status: 200 });
}

function errorResponse(status: number): Response {
  return new Response("error", { status });
}

function networkError(code: string, message = "fetch failed"): Error {
  return Object.assign(new Error(message), { cause: { code } });
}

describe("RobustHttpClient", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    httpClient.clear();
  });

  afterEach(() => {
    httpClient.clear();
  });

  describe("basic fetch", () => {
    it("makes a successful request", async () => {
      fetchMock.mockResolvedValueOnce(okResponse("hello"));

      const response = await httpClient.fetch("https://example.com/api", {}, { skipQueue: true });
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("adds Keep-Alive header", async () => {
      fetchMock.mockResolvedValueOnce(okResponse());

      await httpClient.fetch("https://example.com/api", {}, { skipQueue: true });

      const callOptions = fetchMock.mock.calls[0][1];
      expect(callOptions.headers).toHaveProperty("Connection", "keep-alive");
    });

    it("adds AbortSignal timeout", async () => {
      fetchMock.mockResolvedValueOnce(okResponse());

      await httpClient.fetch(
        "https://example.com/api",
        {},
        { skipQueue: true, timeoutMs: 5000 }
      );

      const callOptions = fetchMock.mock.calls[0][1];
      expect(callOptions.signal).toBeDefined();
    });

    it("merges user headers with Keep-Alive", async () => {
      fetchMock.mockResolvedValueOnce(okResponse());

      await httpClient.fetch(
        "https://example.com/api",
        { headers: { "Content-Type": "application/json" } },
        { skipQueue: true }
      );

      const callOptions = fetchMock.mock.calls[0][1];
      expect(callOptions.headers).toHaveProperty("Connection", "keep-alive");
      expect(callOptions.headers).toHaveProperty(
        "Content-Type",
        "application/json"
      );
    });
  });

  describe("retry logic", () => {
    it("retries on network error and succeeds", async () => {
      fetchMock
        .mockRejectedValueOnce(networkError("ECONNRESET"))
        .mockResolvedValueOnce(okResponse());

      const response = await httpClient.fetch(
        "https://example.com/api",
        {},
        { skipQueue: true, maxRetries: 2 }
      );
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries on 502/503/504 server errors", async () => {
      fetchMock
        .mockResolvedValueOnce(errorResponse(502))
        .mockResolvedValueOnce(okResponse());

      const response = await httpClient.fetch(
        "https://example.com/api",
        {},
        { skipQueue: true, maxRetries: 2 }
      );
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 500 (only 502-504)", async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500));

      const response = await httpClient.fetch(
        "https://example.com/api",
        {},
        { skipQueue: true, maxRetries: 2 }
      );
      expect(response.status).toBe(500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 400-level errors", async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(401));

      const response = await httpClient.fetch(
        "https://example.com/api",
        {},
        { skipQueue: true, maxRetries: 2 }
      );
      expect(response.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws after exhausting retries", async () => {
      fetchMock
        .mockRejectedValueOnce(networkError("ECONNRESET"))
        .mockRejectedValueOnce(networkError("ECONNRESET"))
        .mockRejectedValueOnce(networkError("ECONNRESET"));

      await expect(
        httpClient.fetch(
          "https://example.com/api",
          {},
          { skipQueue: true, maxRetries: 2 }
        )
      ).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("retries on AbortError (timeout)", async () => {
      const abortErr = new Error("timeout");
      abortErr.name = "AbortError";
      fetchMock
        .mockRejectedValueOnce(abortErr)
        .mockResolvedValueOnce(okResponse());

      const response = await httpClient.fetch(
        "https://example.com/api",
        {},
        { skipQueue: true, maxRetries: 1 }
      );
      expect(response.status).toBe(200);
    });

    it("retries on message-pattern matching errors", async () => {
      fetchMock
        .mockRejectedValueOnce(new Error("fetch failed: connection reset"))
        .mockResolvedValueOnce(okResponse());

      const response = await httpClient.fetch(
        "https://example.com/api",
        {},
        { skipQueue: true, maxRetries: 1 }
      );
      expect(response.status).toBe(200);
    });

    it("retries on undici-specific error codes", async () => {
      fetchMock
        .mockRejectedValueOnce(networkError("UND_ERR_CONNECT_TIMEOUT"))
        .mockResolvedValueOnce(okResponse());

      const response = await httpClient.fetch(
        "https://example.com/api",
        {},
        { skipQueue: true, maxRetries: 1 }
      );
      expect(response.status).toBe(200);
    });

    it("does not retry on non-retryable errors", async () => {
      const err = new Error("syntax error");
      Object.assign(err, { code: "ERR_INVALID_URL" });

      fetchMock.mockRejectedValueOnce(err);

      await expect(
        httpClient.fetch(
          "https://example.com/api",
          {},
          { skipQueue: true, maxRetries: 2 }
        )
      ).rejects.toThrow("syntax error");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws 503 after all retries exhausted for server errors", async () => {
      fetchMock
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(errorResponse(503));

      await expect(
        httpClient.fetch(
          "https://example.com/api",
          {},
          { skipQueue: true, maxRetries: 1 }
        )
      ).rejects.toThrow(/Server error/);
    });
  });

  describe("circuit breaker", () => {
    it("opens after threshold failures", async () => {
      const origin = "https://circuit-test.com";
      httpClient.clear();

      for (let i = 0; i < 5; i++) {
        fetchMock.mockRejectedValueOnce(new Error("fail"));
        try {
          await httpClient.fetch(
            `${origin}/api`,
            {},
            { skipQueue: true, maxRetries: 0 }
          );
        } catch {
          // expected
        }
      }

      await expect(
        httpClient.fetch(
          `${origin}/api`,
          {},
          { skipQueue: true, maxRetries: 0 }
        )
      ).rejects.toThrow(/Circuit breaker open/);
    });

    it("resets on successful request", async () => {
      const origin = "https://circuit-reset.com";
      httpClient.clear();

      for (let i = 0; i < 3; i++) {
        fetchMock.mockRejectedValueOnce(new Error("fail"));
        try {
          await httpClient.fetch(
            `${origin}/api`,
            {},
            { skipQueue: true, maxRetries: 0 }
          );
        } catch {
          // expected
        }
      }

      fetchMock.mockResolvedValueOnce(okResponse());
      await httpClient.fetch(
        `${origin}/api`,
        {},
        { skipQueue: true, maxRetries: 0 }
      );

      fetchMock.mockResolvedValueOnce(okResponse());
      const response = await httpClient.fetch(
        `${origin}/api`,
        {},
        { skipQueue: true, maxRetries: 0 }
      );
      expect(response.status).toBe(200);
    });

    it("can be manually reset", async () => {
      const origin = "https://manual-reset.com";
      httpClient.clear();

      for (let i = 0; i < 5; i++) {
        fetchMock.mockRejectedValueOnce(new Error("fail"));
        try {
          await httpClient.fetch(
            `${origin}/api`,
            {},
            { skipQueue: true, maxRetries: 0 }
          );
        } catch {
          // expected
        }
      }

      httpClient.resetCircuitBreaker(origin);

      fetchMock.mockResolvedValueOnce(okResponse());
      const response = await httpClient.fetch(
        `${origin}/api`,
        {},
        { skipQueue: true, maxRetries: 0 }
      );
      expect(response.status).toBe(200);
    });
  });

  describe("getStats", () => {
    it("returns statistics about the client", () => {
      const stats = httpClient.getStats();
      expect(stats).toHaveProperty("circuitBreakers");
      expect(stats).toHaveProperty("queueSizes");
      expect(stats).toHaveProperty("activeRequests");
    });
  });

  describe("clear", () => {
    it("resets all internal state", () => {
      httpClient.clear();
      const stats = httpClient.getStats();
      expect(Object.keys(stats.circuitBreakers)).toHaveLength(0);
      expect(Object.keys(stats.queueSizes)).toHaveLength(0);
      expect(Object.keys(stats.activeRequests)).toHaveLength(0);
    });
  });
});
