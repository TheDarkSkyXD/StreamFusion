import { beforeEach, describe, expect, it, vi } from "vitest";

type SinkEntry = {
  level: "debug" | "info" | "warn" | "error";
  tag: string;
  message: string;
  meta?: Record<string, unknown>;
  line: string;
};

let capturedSink: ((entry: SinkEntry) => void) | null = null;

vi.mock("@backend/logging/logger", () => ({
  addLogSink: vi.fn((sink: (entry: SinkEntry) => void) => {
    capturedSink = sink;
    return vi.fn();
  }),
}));

vi.mock("@backend/logging/network-logger", () => ({
  networkLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { installNetworkLogRouter } from "@backend/logging/network-log-router";
import { networkLogger } from "@backend/logging/network-logger";

const networkLoggerMock = vi.mocked(networkLogger);

function emit(entry: SinkEntry) {
  if (capturedSink == null) throw new Error("sink not installed");
  capturedSink(entry);
}

describe("installNetworkLogRouter", () => {
  beforeEach(() => {
    capturedSink = null;
    vi.clearAllMocks();
  });

  it("tees Chromium network diagnostics into the network log", () => {
    installNetworkLogRouter();

    emit({
      level: "warn",
      tag: "Chromium",
      message: "turn_port allocate error",
      line: "[2026-06-08T20:00:00.000Z] [warn] [Chromium] turn_port allocate error",
    });

    expect(networkLoggerMock.warn).toHaveBeenCalledWith(
      "Chromium",
      "turn_port allocate error",
      undefined
    );
  });

  it("does not tee unrelated app logs", () => {
    installNetworkLogRouter();

    emit({
      level: "info",
      tag: "Main",
      message: "settings loaded",
      line: "[2026-06-08T20:00:00.000Z] [info] [Main] settings loaded",
    });

    expect(networkLoggerMock.info).not.toHaveBeenCalled();
  });

  it("tees request lifecycle diagnostics into the network log", () => {
    installNetworkLogRouter();

    emit({
      level: "error",
      tag: "Network:Request",
      message: "stream request failed",
      line: "[2026-06-08T20:00:00.000Z] [error] [Network:Request] stream request failed",
      meta: { error: "net::ERR_TIMED_OUT" },
    });

    expect(networkLoggerMock.error).toHaveBeenCalledWith(
      "Network:Request",
      "stream request failed",
      { error: "net::ERR_TIMED_OUT" }
    );
  });
});
