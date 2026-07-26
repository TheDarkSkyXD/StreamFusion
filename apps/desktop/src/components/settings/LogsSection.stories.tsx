import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { LogsSection } from "./LogsSection";

const mainLines = [
  '[2026-07-26T19:42:10.021Z] [info] [App] Renderer ready {"version":"1.0.0-beta.1"}',
  '[2026-07-26T19:42:11.408Z] [debug] [Twitch:Auth] Session restored {"account":"NovaArcade"}',
  '[2026-07-26T19:42:13.914Z] [warn] [Player:HLS] Buffer recovering {"channel":"MiraMakes"}',
  '[2026-07-26T19:42:15.002Z] [error] [Kick:Stream] Playback request failed {"statusCode":503}',
];

const networkLines = [
  '[2026-07-26T19:42:20.021Z] [info] [Network:Request] complete {"name":"streams/followed","url":"https://api.twitch.tv/helix/streams/followed","type":"fetch","statusCode":200,"initiator":"Following","sizeBytes":2840,"durationMs":126,"method":"GET"}',
  '[2026-07-26T19:42:21.318Z] [warn] [Network:Request] retry {"name":"kick/channel","url":"https://kick.com/api/v2/channels/mira","type":"fetch","statusCode":429,"initiator":"StreamInfo","sizeBytes":912,"durationMs":804,"method":"GET"}',
];

function installLogMocks(mode: "populated" | "empty" | "error") {
  window.electronAPI.logs.getCurrentPath = async () => "C:\\Logs\\streamfusion.log";
  window.electronAPI.logs.getNoisePath = async () => "C:\\Logs\\streamfusion-noise.log";
  window.electronAPI.logs.getNetworkPath = async () => "C:\\Logs\\streamfusion-network.log";
  window.electronAPI.logs.openFolder = async () => ({ ok: true });
  window.electronAPI.logs.tail = async ({ file }) => {
    if (mode === "error") throw new Error("The log file is temporarily locked.");
    if (mode === "empty") return [];
    return file === "network" ? networkLines : mainLines;
  };
}

const meta = {
  title: "Components/Settings/Logs",
  component: LogsSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-6xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LogsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  render: () => {
    installLogMocks("populated");
    return <LogsSection />;
  },
};

export const NetworkTable: Story = {
  render: () => {
    installLogMocks("populated");
    return <LogsSection />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(await canvas.findByLabelText("Log file"), "network");
  },
};

export const Empty: Story = {
  render: () => {
    installLogMocks("empty");
    return <LogsSection />;
  },
};

export const ReadError: Story = {
  render: () => {
    installLogMocks("error");
    return <LogsSection />;
  },
};
