import type { Meta, StoryObj } from "@storybook/react-vite";

import { LogsSection } from "./LogsSection";

const mainLines = [
  '[2026-07-26T19:42:10.021Z] [info] [App] Renderer ready {"version":"1.0.0-beta.1"}',
  '[2026-07-26T19:42:11.408Z] [debug] [Twitch:Auth] Session restored {"account":"NovaArcade"}',
  '[2026-07-26T19:42:13.914Z] [warn] [Player:HLS] Buffer recovering {"channel":"MiraMakes"}',
  '[2026-07-26T19:42:15.002Z] [error] [Kick:Stream] Playback request failed {"statusCode":503}',
];

function installLogMocks(mode: "populated" | "empty" | "error") {
  window.electronAPI.logs.getCurrentPath = async () => "C:\\Logs\\streamfusion.log";
  window.electronAPI.logs.getNoisePath = async () => "C:\\Logs\\streamfusion-noise.log";
  window.electronAPI.logs.openFolder = async () => ({ ok: true });
  window.electronAPI.logs.tail = async () => {
    if (mode === "error") throw new Error("The log file is temporarily locked.");
    if (mode === "empty") return [];
    return mainLines;
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
