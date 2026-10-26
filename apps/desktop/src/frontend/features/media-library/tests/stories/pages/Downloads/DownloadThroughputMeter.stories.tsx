import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, type ReactNode } from "react";
import { expect, within } from "storybook/test";

import type { DownloadJob } from "@shared/download-types";
import { DownloadThroughputMeter } from "../../../../components/screens/Downloads/DownloadThroughputMeter";
import {
  useDownloadThroughputStore,
  type ThroughputSeries,
} from "../../../../components/state/download-throughput-store";

const MIB = 1_048_576;
const job = {
  id: "download-story",
  kind: "video",
  platform: "twitch",
  sourceId: "2147483647",
  title: "Road to radiant with calm comms",
  channelName: "NovaArcade",
  status: "downloading",
  progress: { percent: 64, transferredBytes: 64 * MIB, totalBytes: 100 * MIB },
  destinationPath: "D:\\StreamFusion\\Road to radiant.mp4",
  thumbnailUrl: null,
  createdAt: "2026-08-10T14:00:00.000Z",
  updatedAt: "2026-08-10T14:08:00.000Z",
} satisfies DownloadJob;

const active = {
  jobId: job.id,
  phase: "active",
  samples: [2, 3, 5, 4, 6, 8].map((rate, index) => ({
    atMs: 1_000 + index * 500,
    bytesPerSecond: rate * MIB,
  })),
  smoothedBytesPerSecond: 8 * MIB,
  peakBytesPerSecond: 8 * MIB,
  averageBytesPerSecond: 4 * MIB,
  estimatedSecondsRemaining: 12,
} satisfies ThroughputSeries;

function SeedSeries({ children, series }: { children: ReactNode; series: ThroughputSeries }) {
  useEffect(() => {
    const previous = useDownloadThroughputStore.getState().seriesByJobId;
    useDownloadThroughputStore.setState({ seriesByJobId: { ...previous, [job.id]: series } });
    return () => useDownloadThroughputStore.setState({ seriesByJobId: previous });
  }, [series]);
  return children;
}

const meta = {
  title: "Pages/Downloads/DownloadThroughputMeter",
  component: DownloadThroughputMeter,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="rounded-lg bg-[#252525] p-5 text-white">
        <Story />
      </div>
    ),
  ],
  args: { job, sharedMaximum: 10 * MIB, statusTextClassName: "text-emerald-300" },
} satisfies Meta<typeof DownloadThroughputMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveTransfer: Story = {
  render: (args) => (
    <SeedSeries series={active}>
      <DownloadThroughputMeter {...args} />
    </SeedSeries>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByTitle("Download rate")).toHaveTextContent(/8\.0.*MiB/);
  },
};

export const CompletedTransfer: Story = {
  args: { job: { ...job, status: "completed" } },
  render: (args) => (
    <SeedSeries series={{ ...active, phase: "complete", estimatedSecondsRemaining: null }}>
      <DownloadThroughputMeter {...args} />
    </SeedSeries>
  ),
  play: async ({ canvasElement }) => {
    expect(await within(canvasElement).findByTitle("Download rate")).toHaveTextContent(/average/i);
  },
};
