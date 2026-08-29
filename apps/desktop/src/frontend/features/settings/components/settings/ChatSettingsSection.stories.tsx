import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LuMessageCircle } from "react-icons/lu";

import {
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_CHAT_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
} from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { ChatSettingsSection, RangeRow, SettingRow, SwitchRow } from "./ChatSettingsSection";

function resetChatPreferences() {
  useAuthStore.setState({
    preferences: {
      ...DEFAULT_USER_PREFERENCES,
      chat: { ...DEFAULT_CHAT_PREFERENCES },
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
    },
    updatePreferences: async (updates) => {
      const current = useAuthStore.getState().preferences ?? DEFAULT_USER_PREFERENCES;
      useAuthStore.setState({
        preferences: {
          ...current,
          ...updates,
        },
      });
    },
  });
}

function RowPrimitivesExample() {
  const [enabled, setEnabled] = useState(true);
  const [size, setSize] = useState(16);

  return (
    <div className="w-[42rem] divide-y divide-[#27272a] rounded-xl border border-[#27272a] bg-[#121214] px-6">
      <SettingRow
        icon={<LuMessageCircle className="size-4" />}
        label="Chat preview"
        description="A composed row can host any control."
        control={<span className="text-sm text-zinc-300">Connected</span>}
      />
      <SwitchRow
        label="Show timestamps"
        description="Display a timestamp beside each message."
        checked={enabled}
        onChange={setEnabled}
      />
      <RangeRow
        label="Font size"
        description="Controls the text size inside chat."
        value={size}
        defaultValue={14}
        min={10}
        max={20}
        unit="px"
        onChange={setSize}
        onReset={() => setSize(14)}
      />
    </div>
  );
}

const meta = {
  title: "Components/Settings/Chat Settings",
  component: ChatSettingsSection,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Grouped chat display preferences plus reusable setting-row primitives for compact settings surfaces.",
      },
    },
  },
  decorators: [
    (Story) => {
      resetChatPreferences();
      return (
        <div className="mx-auto max-w-4xl">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof ChatSettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllGroups: Story = {};

export const AppearanceOnly: Story = {
  args: { only: ["appearance"] },
};

export const EventsOnlyWithCustomPreferences: Story = {
  args: { only: ["events"] },
  decorators: [
    (Story) => {
      resetChatPreferences();
      useAuthStore.setState((state) => ({
        preferences: state.preferences
          ? {
              ...state.preferences,
              chatDisplay: {
                ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
                recentMessagesOnJoin: false,
                messageLimit: 900,
                deletedMessageDisplay: "audit",
                moderationHighlightStyle: "cozy",
              },
            }
          : state.preferences,
      }));
      return <Story />;
    },
  ],
};

export const RowPrimitives: Story = {
  render: () => <RowPrimitivesExample />,
};
