import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select";

const meta = {
  title: "Components/UI/Select",
  component: Select,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A compact choice control with portalled content. Use labels and grouped options when choices need context.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

function QualitySelect({ defaultOpen = false, disabled = false }) {
  return (
    <Select defaultValue="auto" defaultOpen={defaultOpen} disabled={disabled}>
      <SelectTrigger aria-label="Stream quality">
        <SelectValue placeholder="Select quality" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Adaptive</SelectLabel>
          <SelectItem value="auto">Auto (recommended)</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Resolution</SelectLabel>
          <SelectItem value="1080p">1080p60</SelectItem>
          <SelectItem value="720p">720p60</SelectItem>
          <SelectItem value="480p">480p</SelectItem>
          <SelectItem value="audio">Audio only</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export const Default: Story = {
  render: () => <QualitySelect />,
};

export const Open: Story = {
  render: () => <QualitySelect defaultOpen />,
};

export const Disabled: Story = {
  render: () => <QualitySelect disabled />,
};

export const WithUnavailableOption: Story = {
  render: () => (
    <Select defaultValue="all">
      <SelectTrigger aria-label="Platform filter">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All platforms</SelectItem>
        <SelectItem value="twitch">Twitch</SelectItem>
        <SelectItem value="kick">Kick</SelectItem>
        <SelectItem value="youtube" disabled>
          YouTube (coming later)
        </SelectItem>
      </SelectContent>
    </Select>
  ),
};
