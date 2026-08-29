import type { Meta, StoryObj } from "@storybook/react-vite";

import { Switch } from "./switch";

const meta = {
  title: "Components/UI/Switch",
  component: Switch,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    "aria-label": "Show timestamps",
    defaultChecked: true,
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const SettingsRows: Story = {
  render: () => (
    <div className="w-96 max-w-[calc(100vw-2rem)] divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-4">
      <label className="flex cursor-pointer items-center justify-between gap-6 py-4">
        <span>
          <span className="block text-sm font-semibold">Show timestamps</span>
          <span className="block text-xs text-[var(--color-foreground-secondary)]">
            Display a timestamp beside each chat message.
          </span>
        </span>
        <Switch defaultChecked aria-label="Show timestamps" />
      </label>
      <label className="flex cursor-pointer items-center justify-between gap-6 py-4">
        <span>
          <span className="block text-sm font-semibold">Animated emotes</span>
          <span className="block text-xs text-[var(--color-foreground-secondary)]">
            Play animated emotes when motion is allowed.
          </span>
        </span>
        <Switch aria-label="Animated emotes" />
      </label>
      <label className="flex items-center justify-between gap-6 py-4 opacity-60">
        <span>
          <span className="block text-sm font-semibold">Moderator actions</span>
          <span className="block text-xs text-[var(--color-foreground-secondary)]">
            Connect an account to change this setting.
          </span>
        </span>
        <Switch disabled aria-label="Moderator actions" />
      </label>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="grid grid-cols-[auto_auto] items-center gap-x-6 gap-y-4">
      <span className="text-sm">Off</span>
      <Switch aria-label="Off" />
      <span className="text-sm">On</span>
      <Switch defaultChecked aria-label="On" />
      <span className="text-sm text-[var(--color-foreground-muted)]">Disabled</span>
      <Switch disabled aria-label="Disabled" />
    </div>
  ),
};
