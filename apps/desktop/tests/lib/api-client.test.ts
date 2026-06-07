import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("ky", () => {
  const methods = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  };
  return {
    default: {
      create: () => methods,
    },
  };
});

import { api } from "@/lib/api-client";

describe("api-client", () => {
  it("exports get, post, put, delete, patch, and raw", () => {
    expect(api.get).toBeTypeOf("function");
    expect(api.post).toBeTypeOf("function");
    expect(api.put).toBeTypeOf("function");
    expect(api.delete).toBeTypeOf("function");
    expect(api.patch).toBeTypeOf("function");
    expect(api.raw).toBeDefined();
  });

  it("delegates get to the underlying ky instance", () => {
    api.get("https://example.com/api");
    expect(api.raw.get).toHaveBeenCalledWith("https://example.com/api", undefined);
  });

  it("delegates post with options", () => {
    const opts = { json: { foo: "bar" } };
    api.post("https://example.com/api", opts);
    expect(api.raw.post).toHaveBeenCalledWith("https://example.com/api", opts);
  });

  it("delegates put with options", () => {
    const opts = { json: { id: 1 } };
    api.put("https://example.com/api/1", opts);
    expect(api.raw.put).toHaveBeenCalledWith("https://example.com/api/1", opts);
  });

  it("delegates delete", () => {
    api.delete("https://example.com/api/1");
    expect(api.raw.delete).toHaveBeenCalledWith("https://example.com/api/1", undefined);
  });

  it("delegates patch with options", () => {
    const opts = { json: { name: "updated" } };
    api.patch("https://example.com/api/1", opts);
    expect(api.raw.patch).toHaveBeenCalledWith("https://example.com/api/1", opts);
  });
});
