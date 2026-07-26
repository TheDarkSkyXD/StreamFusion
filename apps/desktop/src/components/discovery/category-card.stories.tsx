import type { Meta, StoryObj } from "@storybook/react-vite";

import { makeCategory } from "../../../.storybook/catalog-fixtures";
import { withAppRouter } from "../../../.storybook/story-router";
import { CategoryCard } from "./category-card";

const meta = {
  title: "Components/Discovery/CategoryCard",
  component: CategoryCard,
  decorators: [
    withAppRouter,
    (Story) => (
      <div className="w-[220px]">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A platform-agnostic category tile with cover art, audience size, and up to three discovery tags.",
      },
    },
  },
  args: {
    category: makeCategory(0),
  },
} satisfies Meta<typeof CategoryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const KickCategory: Story = {
  args: {
    category: makeCategory(1, {
      platform: "kick",
      name: "Grand Theft Auto V",
      viewerCount: 82_400,
      tags: ["Action", "Open World", "Roleplay"],
    }),
  },
};

export const WithoutMetadata: Story = {
  args: {
    category: makeCategory(2, {
      viewerCount: undefined,
      tags: [],
    }),
  },
};

export const ImageFallback: Story = {
  args: {
    category: makeCategory(3, {
      name: "Unreleased Adventure",
      boxArtUrl: "",
    }),
  },
};
