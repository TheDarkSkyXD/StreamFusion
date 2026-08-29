import type { Meta, StoryObj } from "@storybook/react-vite";

import { ContentTabs } from "./ContentTabs";
import { RelatedContentStoryRouter } from "./related-content-story-router";

const meta = {
  title: "Components/Stream/Related Content/Content Tabs",
  component: ContentTabs,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <RelatedContentStoryRouter>
        <div className="mx-auto max-w-5xl">
          <Story />
        </div>
      </RelatedContentStoryRouter>
    ),
  ],
  args: {
    activeTab: "home",
  },
  argTypes: {
    activeTab: { control: "inline-radio", options: ["home", "videos", "clips"] },
  },
} satisfies Meta<typeof ContentTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {};
export const Videos: Story = { args: { activeTab: "videos" } };
export const Clips: Story = { args: { activeTab: "clips" } };
