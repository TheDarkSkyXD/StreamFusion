// Guards: the Report-a-bug card's contract with the preload bridge — the
// form renders, Submit blocks empty / too-short descriptions, a valid submit
// calls `bugReports.write` with the description and the two include flags,
// success surfaces the saved path inline, failure surfaces an error toast,
// and Open Folder routes through the preload helper.
// Guards: mounting below the log viewer does not steal focus and scroll Logs & Reports downward.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BugReportSection } from "@/features/settings/components/settings/BugReportSection";

import { fireEvent, renderWithProviders, screen, waitFor } from "../../test-utils";

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

type BugReportsApi = {
  write: ReturnType<typeof vi.fn>;
  openFolder: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  getDir: ReturnType<typeof vi.fn>;
};

type LogsApi = {
  getNoisePath: ReturnType<typeof vi.fn>;
};

function installBugReportsApi(
  overrides: Partial<BugReportsApi> = {},
  logsOverrides: Partial<LogsApi> = {}
): { bugReports: BugReportsApi; logs: LogsApi } {
  const bugReports: BugReportsApi = {
    write: vi.fn().mockResolvedValue({ ok: true, filePath: "/tmp/bug-reports/report-1.md" }),
    openFolder: vi.fn().mockResolvedValue({ ok: true }),
    list: vi.fn().mockResolvedValue([]),
    getDir: vi.fn().mockResolvedValue("/tmp/bug-reports"),
    ...overrides,
  };
  const logs: LogsApi = {
    getNoisePath: vi.fn().mockResolvedValue("/tmp/streamfusion-noise.log"),
    ...logsOverrides,
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    writable: true,
    value: { bugReports, logs },
  });
  return { bugReports, logs };
}

describe("BugReportSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastErrorMock.mockClear();
    toastSuccessMock.mockClear();
  });

  it("does not autofocus the description when mounted", async () => {
    installBugReportsApi();
    renderWithProviders(<BugReportSection />);

    const textarea = await waitFor(() => screen.getByPlaceholderText(/describe what happened/i));

    expect(textarea).not.toHaveFocus();
  });

  it("renders the form (description, include switches, submit + open-folder buttons)", async () => {
    installBugReportsApi();
    renderWithProviders(<BugReportSection />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/describe what happened/i)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /generate bug report/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open bug reports folder/i })).toBeInTheDocument();
    // Two switches, default ON.
    expect(screen.getByRole("switch", { name: /include current log file/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /include noise log/i })).toBeInTheDocument();
  });

  it("submit is disabled when the description is empty", async () => {
    installBugReportsApi();
    renderWithProviders(<BugReportSection />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/describe what happened/i)).toBeInTheDocument()
    );
    const submit = screen.getByRole("button", { name: /generate bug report/i });
    expect(submit).toBeDisabled();
  });

  it("submit is disabled when the description is shorter than 10 chars", async () => {
    installBugReportsApi();
    renderWithProviders(<BugReportSection />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/describe what happened/i)).toBeInTheDocument()
    );
    const textarea = screen.getByPlaceholderText(/describe what happened/i);
    fireEvent.change(textarea, { target: { value: "too short" } });
    expect(screen.getByRole("button", { name: /generate bug report/i })).toBeDisabled();
  });

  it("submit calls write with the description and both include flags ON by default", async () => {
    const { bugReports } = installBugReportsApi();
    renderWithProviders(<BugReportSection />);

    const textarea = await waitFor(() => screen.getByPlaceholderText(/describe what happened/i));
    fireEvent.change(textarea, {
      target: { value: "playback froze on a Kick stream and never recovered" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate bug report/i }));

    await waitFor(() =>
      expect(bugReports.write).toHaveBeenCalledWith({
        description: "playback froze on a Kick stream and never recovered",
        includeMainLog: true,
        includeNoiseLog: true,
      })
    );
  });

  it("forwards toggled-off include flags", async () => {
    const { bugReports } = installBugReportsApi();
    renderWithProviders(<BugReportSection />);

    const textarea = await waitFor(() => screen.getByPlaceholderText(/describe what happened/i));
    fireEvent.change(textarea, {
      target: { value: "chat reconnects every couple of minutes during a long stream" },
    });
    // Flip both switches off.
    fireEvent.click(screen.getByRole("switch", { name: /include current log file/i }));
    fireEvent.click(screen.getByRole("switch", { name: /include noise log/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate bug report/i }));

    await waitFor(() =>
      expect(bugReports.write).toHaveBeenCalledWith(
        expect.objectContaining({ includeMainLog: false, includeNoiseLog: false })
      )
    );
  });

  it("on success, displays the saved path inline", async () => {
    installBugReportsApi({
      write: vi
        .fn()
        .mockResolvedValue({ ok: true, filePath: "/tmp/bug-reports/2026-06-07-1234.md" }),
    });
    renderWithProviders(<BugReportSection />);

    const textarea = await waitFor(() => screen.getByPlaceholderText(/describe what happened/i));
    fireEvent.change(textarea, {
      target: { value: "Something went very wrong, please help" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate bug report/i }));

    await waitFor(() => {
      expect(screen.getByText(/2026-06-07-1234\.md/)).toBeInTheDocument();
    });
  });

  it("on {ok: false}, shows an error toast", async () => {
    installBugReportsApi({
      write: vi.fn().mockResolvedValue({ ok: false, error: "disk full" }),
    });
    renderWithProviders(<BugReportSection />);

    const textarea = await waitFor(() => screen.getByPlaceholderText(/describe what happened/i));
    fireEvent.change(textarea, {
      target: { value: "Something went very wrong, please help" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate bug report/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
  });

  it("Open Folder button calls bugReports.openFolder", async () => {
    const { bugReports } = installBugReportsApi();
    renderWithProviders(<BugReportSection />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open bug reports folder/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /open bug reports folder/i }));

    await waitFor(() => expect(bugReports.openFolder).toHaveBeenCalledTimes(1));
  });

  it("disables the noise-log switch (and forces it off) when no noise path is available", async () => {
    const { bugReports } = installBugReportsApi(
      {},
      { getNoisePath: vi.fn().mockResolvedValue(null) }
    );
    renderWithProviders(<BugReportSection />);

    const noiseSwitch = await waitFor(() =>
      screen.getByRole("switch", { name: /include noise log/i })
    );
    await waitFor(() => expect(noiseSwitch).toBeDisabled());

    const textarea = screen.getByPlaceholderText(/describe what happened/i);
    fireEvent.change(textarea, { target: { value: "the description is long enough now" } });
    fireEvent.click(screen.getByRole("button", { name: /generate bug report/i }));

    await waitFor(() =>
      expect(bugReports.write).toHaveBeenCalledWith(
        expect.objectContaining({ includeNoiseLog: false })
      )
    );
  });
});
