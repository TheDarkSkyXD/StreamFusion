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
  "[2026-06-07T15:00:03.000Z] [warn] [Chromium] turn_port allocate error",
];

const NETWORK_REQUEST_LINE =
  '[2026-06-09T00:49:49.624Z] [error] [Network:Request] stream request failed {"host":"fa723fc1b171.use21.playlist.live-video.net","initiator":"xhr-loader.ts:166","initiatorUrl":"file:///repo/node_modules/hls.js/dist/src/utils/xhr-loader.ts","generatedInitiator":"hls__js.js:27827","generatedInitiatorUrl":"http://localhost:5173/node_modules/.vite/deps/hls__js.js?v=808c741b","sourceMappedInitiator":true,"name":"[REDACTED].m3u8","method":"GET","requestHeaders":{"Referer":"http://localhost:5173/","User-Agent":"StreamFusion/1.0.0-beta.1"},"resourceType":"xhr","kind":"playlist","type":"playlist/xhr","url":"https://fa723fc1b171.use21.playlist.live-video.net/v1/playlist/[REDACTED].m3u8","urlFingerprint":"abc123","error":"net::ERR_ABORTED","fromCache":false,"status":"net::ERR_ABORTED","durationMs":55}';

type LogsApi = {
  tail: ReturnType<typeof vi.fn>;
  openFolder: ReturnType<typeof vi.fn>;
  getCurrentPath: ReturnType<typeof vi.fn>;
  getNoisePath: ReturnType<typeof vi.fn>;
  getNetworkPath: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

function installLogsApi(overrides: Partial<LogsApi> = {}): LogsApi {
  const api: LogsApi = {
    tail: vi.fn().mockResolvedValue(SAMPLE_LINES),
    openFolder: vi.fn().mockResolvedValue({ ok: true }),
    getCurrentPath: vi.fn().mockResolvedValue("/tmp/streamfusion-x.log"),
    getNoisePath: vi.fn().mockResolvedValue("/tmp/streamfusion-noise-x.log"),
    getNetworkPath: vi.fn().mockResolvedValue("/tmp/streamfusion-network-x.log"),
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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
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

  it("switching to the network file calls tail with file: 'network'", async () => {
    const api = installLogsApi();
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(api.tail).toHaveBeenCalled());

    const fileSelect = screen.getByLabelText("Log file") as HTMLSelectElement;
    fireEvent.change(fileSelect, { target: { value: "network" } });

    await waitFor(() => {
      expect(api.tail).toHaveBeenCalledWith(expect.objectContaining({ file: "network" }));
    });
  });

  it("replaces focus with the table view switcher for the network log file", async () => {
    installLogsApi();
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(screen.getByText(/App started/)).toBeInTheDocument());

    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(screen.queryByText("View")).toBeNull();
    expect(screen.queryByRole("button", { name: "Table" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Log file"), { target: { value: "network" } });

    await waitFor(() => {
      expect(screen.queryByText("Focus")).toBeNull();
      expect(screen.getByText("View")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Table" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Log file"), { target: { value: "noise" } });

    await waitFor(() => {
      expect(screen.getByText("Focus")).toBeInTheDocument();
      expect(screen.queryByText("View")).toBeNull();
      expect(screen.queryByRole("button", { name: "Table" })).toBeNull();
    });
  });

  it("clicking the Network focus sends full-line network query terms", async () => {
    const api = installLogsApi();
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(api.tail).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Network" }));

    await waitFor(() => {
      expect(api.tail).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.arrayContaining(["network:request", "chromium", "turn_port", "m3u8"]),
        })
      );
    });
  });

  it("shows network request rows in table view with DevTools-style columns", async () => {
    installLogsApi({ tail: vi.fn().mockResolvedValue([NETWORK_REQUEST_LINE]) });
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(screen.getByText(/stream request failed/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Log file"), { target: { value: "network" } });

    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Initiator" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Size" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Time" })).toBeInTheDocument();
      expect(screen.getByText("[REDACTED].m3u8")).toBeInTheDocument();
      expect(screen.getByText("playlist/xhr")).toBeInTheDocument();
      expect(screen.getByText("net::ERR_ABORTED")).toBeInTheDocument();
      expect(screen.getByText("xhr-loader.ts:166")).toBeInTheDocument();
      expect(screen.getByText("55 ms")).toBeInTheDocument();
    });
  });

  it("can switch network logs back to raw text view", async () => {
    installLogsApi({ tail: vi.fn().mockResolvedValue([NETWORK_REQUEST_LINE]) });
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(screen.getByText(/stream request failed/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Log file"), { target: { value: "network" } });
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Text" }));

    await waitFor(() => {
      expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
      expect(screen.getByText(/Network:Request/)).toBeInTheDocument();
    });
  });

  it("copies a cURL command from a network request row", async () => {
    installLogsApi({ tail: vi.fn().mockResolvedValue([NETWORK_REQUEST_LINE]) });
    renderWithProviders(<LogsSection />);

    await waitFor(() => expect(screen.getByText(/stream request failed/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Log file"), { target: { value: "network" } });
    await waitFor(() => expect(screen.getByText("[REDACTED].m3u8")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Copy cURL for [REDACTED].m3u8" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          'curl "https://fa723fc1b171.use21.playlist.live-video.net/v1/playlist/[REDACTED].m3u8"'
        )
      );
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('-H "User-Agent: StreamFusion/1.0.0-beta.1"')
      );
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
