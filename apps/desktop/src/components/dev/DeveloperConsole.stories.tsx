import type { Meta, StoryObj } from "@storybook/react-vite";

import { seedChatSubsystemStoryStores } from "../chat/chat-subsystem-story-fixtures";
import { DeveloperConsole } from "./DeveloperConsole";

const meta = {
  title: "Components/Developer Tools/Debug Panel",
  component: DeveloperConsole,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Development-only floating console. The production Storybook build intentionally renders it as null because the component honors import.meta.env.DEV.",
      },
    },
  },
} satisfies Meta<typeof DeveloperConsole>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  render: () => {
    seedChatSubsystemStoryStores();
    window.localStorage.removeItem("streamfusion-debug-panel");
    return (
      <div className="min-h-[720px] bg-[#0f0f0f]">
        <DeveloperConsole />
      </div>
    );
  },
};
