import { vi } from "vitest";

export function createIpcReplyMock() {
  const mock = vi.fn();
  const resolveOnce = mock.mockResolvedValueOnce.bind(mock);
  const resolve = mock.mockResolvedValue.bind(mock);
  mock.mockResolvedValueOnce = (value: unknown) => resolveOnce({ kind: "ok", value });
  mock.mockResolvedValue = (value: unknown) => resolve({ kind: "ok", value });
  return mock;
}
