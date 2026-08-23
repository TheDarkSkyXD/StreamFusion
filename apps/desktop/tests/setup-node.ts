import { vi } from "vitest";

// Backend modules can log before initLogger() runs. Keep that boundary quiet by
// default, while allowing individual tests to replace either mock with spies.
vi.mock("@/backend/logging/logger", async () => {
  const actual = await vi.importActual<typeof import("../src/backend/logging/logger")>(
    "@/backend/logging/logger"
  );
  return {
    ...actual,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock("@/backend/logging/noise-logger", async () => {
  const actual = await vi.importActual<typeof import("../src/backend/logging/noise-logger")>(
    "@/backend/logging/noise-logger"
  );
  return {
    ...actual,
    noiseLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});
