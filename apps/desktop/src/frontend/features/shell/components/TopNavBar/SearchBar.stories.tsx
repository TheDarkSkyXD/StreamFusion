import type { Meta, StoryObj } from "@storybook/react-vite";

import { withAppRouter } from "../../../../../../.storybook/story-router";
import { SearchBar } from "./SearchBar";

const meta = {
  title: "Components/Top Navigation/SearchBar",
  component: SearchBar,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The top-navigation search surface. Submitting a term routes to the unified search results page.",
      },
    },
  },
  decorators: [
    withAppRouter,
    (Story) => (
      <div className="w-[420px] max-w-[calc(100vw-2rem)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
};
