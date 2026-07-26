import type { Meta, StoryObj } from "@storybook/react-vite";

import { seedChatSubsystemStoryStores } from "../chat/chat-subsystem-story-fixtures";
import { DebugPanel } from "./DebugPanel";

const meta = {
  title: "Components/Developer Tools/Debug Panel",
  component: DebugPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Development-only floating console. The production Storybook build intentionally renders it as null because the component honors import.meta.env.DEV.",
      },
    },
  },
} satisfies Meta<typeof DebugPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  render: () => {
    seedChatSubsystemStoryStores();
    window.localStorage.removeItem("streamfusion-debug-panel");
    return (
      <div className="min-h-[720px] bg-[#0f0f0f]">
        <DebugPanel />
      </div>
    );
  },
};
