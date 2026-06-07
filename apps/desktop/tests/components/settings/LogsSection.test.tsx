// Guards: the in-app log viewer's contract with the preload bridge —
// initial tail rendered, level + tag filtering narrows to the right lines,
// file switcher round-trips to `tail({ file: 'noise' })`, and the open-folder
// button invokes the preload. Renderer-only; window.electronAPI is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LogsSection } from "@/components/settings/LogsSection";

import { fireEvent, renderWithProviders, screen, waitFor } from "../../test-utils";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const SAMPLE_LINES = [
  "[2026-06-07T15:00:00.000Z] [info] [Main] App started",
  "[2026-06-07T15:00:01.000Z] [warn] [Twitch:GQL] rate-limited",
  "[2026-06-07T15:00:02.000Z] [error] [Auth:Kick] auth failed",
];

type LogsApi = {
  tail: ReturnType<typeof vi.fn>;
  openFolder: ReturnType<typeof vi.fn>;
  getCurrentPath: ReturnType<typeof vi.fn>;
  getNoisePath: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

function installLogsApi(overrides: Partial<LogsApi> = {}): LogsApi {
  const api: LogsApi = {
    tail: vi.fn().mockResolvedValue(SAMPLE_LINES),
    openFolder: vi.fn().mockResolvedValue({ ok: true }),
    getCurrentPath: vi.fn().mockResolvedValue("/tmp/streamfusion-x.log"),
    getNoisePath: vi.fn().mockResolvedValue("/tmp/streamfusion-noise-x.log"),
    write: vi.fn(),
    ...overrides,
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    writable: true,
    value: { logs: api },
  });
  return api;
}

describe("LogsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the initial tail lines from the preload bridge", async () => {
    installLogsApi();
    renderWithProviders(<LogsSection />);

    await waitFor(() => {
      expect(screen.getByText(/App started/)).toBeInTheDocument();
      expect(screen.getByText(/rate-limited/)).toBeInTheDocument();
      expect(screen.getByText(/auth failed/)).toBeInTheDocument();
    });
  });

  it("filtering by level 'error' shows only the error line", async () => {
    installLogsApi();
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(screen.getByText(/App started/)).toBeInTheDocument());

    const levelSelect = screen.getByLabelText("Filter by level") as HTMLSelectElement;
    fireEvent.change(levelSelect, { target: { value: "error" } });

    await waitFor(() => {
      expect(screen.queryByText(/App started/)).toBeNull();
      expect(screen.queryByText(/rate-limited/)).toBeNull();
      expect(screen.getByText(/auth failed/)).toBeInTheDocument();
    });
  });

  it("filtering by tag 'Twitch' shows only the Twitch:GQL line", async () => {
    installLogsApi();
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(screen.getByText(/App started/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Filter by tag"), { target: { value: "Twitch" } });

    await waitFor(() => {
      expect(screen.queryByText(/App started/)).toBeNull();
      expect(screen.getByText(/rate-limited/)).toBeInTheDocument();
      expect(screen.queryByText(/auth failed/)).toBeNull();
    });
  });

  it("clicking 'Open Logs Folder' invokes the preload bridge", async () => {
    const api = installLogsApi();
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(screen.getByText(/App started/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Open Logs Folder/i }));

    await waitFor(() => expect(api.openFolder).toHaveBeenCalledTimes(1));
  });

  it("switching to the noise file calls tail with file: 'noise'", async () => {
    const api = installLogsApi();
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(api.tail).toHaveBeenCalled());

    const fileSelect = screen.getByLabelText("Log file") as HTMLSelectElement;
    fireEvent.change(fileSelect, { target: { value: "noise" } });

    await waitFor(() => {
      expect(api.tail).toHaveBeenCalledWith(expect.objectContaining({ file: "noise" }));
    });
  });

  it("shows an empty-state message when filters rule out every line", async () => {
    installLogsApi();
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(screen.getByText(/App started/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Filter by tag"), {
      target: { value: "no-such-tag-anywhere" },
    });

    await waitFor(() => {
      expect(screen.getByText(/No log lines match/i)).toBeInTheDocument();
    });
  });
});
