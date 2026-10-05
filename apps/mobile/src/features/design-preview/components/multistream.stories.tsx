import type { Meta, StoryObj } from "@storybook/react-native-web-vite";

import { MultistreamMockup } from "./multistream-mockups";

const meta = {
  title: "Android/Proposed/Multistream",
  component: MultistreamMockup,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Mobile has no multistream route or admission workflow. These proposals demonstrate local slot management and one audio owner. They do not prove concurrent playback capacity.",
      },
    },
  },
} satisfies Meta<typeof MultistreamMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const StreamGrid: Story = { args: { kind: "grid" } };
export const AddStreamSheet: Story = { args: { kind: "add" } };
export const AudioOwnerSheet: Story = { args: { kind: "audio" } };
export const ConstrainedDevice: Story = { args: { kind: "constrained" } };
export const MergedChat: Story = { args: { kind: "chat" } };
