import type { Meta, StoryObj } from "@storybook/react-native-web-vite";

import { LibraryMockup } from "./library-mockups";

const meta = {
  title: "Android/Proposed/Media workflows",
  component: LibraryMockup,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Local visual proposals for recovery, duplicate downloads, and model installation. Native work and model execution are not started.",
      },
    },
  },
} satisfies Meta<typeof LibraryMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RecordingRecovery: Story = {
  args: { kind: "recording-recovery" },
};
export const DuplicateDownloadDialog: Story = {
  args: { kind: "download-duplicate" },
};
export const CaptionModelManagement: Story = {
  args: { kind: "caption-model" },
};
