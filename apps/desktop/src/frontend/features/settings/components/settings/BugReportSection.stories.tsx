import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { BugReportSection } from "./BugReportSection";

const recentReports = [
  "C:\\Users\\Streamer\\StreamFusion\\bug-reports\\2026-07-26-player-freeze.md",
  "C:\\Users\\Streamer\\StreamFusion\\bug-reports\\2026-07-24-chat-reconnect.md",
];

function installBugReportMocks(noisePath: string | null = "C:\\Logs\\streamfusion-noise.log") {
  window.electronAPI.logs.getNoisePath = async () => noisePath;
  window.electronAPI.bugReports.list = async () => recentReports;
  window.electronAPI.bugReports.openFolder = async () => ({ ok: true });
  window.electronAPI.bugReports.write = async () => ({
    ok: true,
    filePath: "C:\\Users\\Streamer\\StreamFusion\\bug-reports\\storybook-report.md",
  });
}

const meta = {
  title: "Components/Settings/Bug Report",
  component: BugReportSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-4xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BugReportSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  render: () => {
    installBugReportMocks();
    return <BugReportSection />;
  },
};

export const NoiseLogUnavailable: Story = {
  render: () => {
    installBugReportMocks(null);
    return <BugReportSection />;
  },
};

export const GeneratedReport: Story = {
  render: () => {
    installBugReportMocks();
    return <BugReportSection />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByLabelText("Description"),
      "The player froze after switching quality twice."
    );
    await userEvent.click(canvas.getByRole("button", { name: "Generate Bug Report" }));
    await expect(await canvas.findByText("Saved report")).toBeInTheDocument();
  },
};
