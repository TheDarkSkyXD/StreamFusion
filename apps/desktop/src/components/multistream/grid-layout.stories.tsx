import type { Meta, StoryObj } from "@storybook/react-vite";

import { MultiStreamGrid } from "./grid-layout";
import {
  installMultistreamMocks,
  multistreamFixtures,
  resetMultistreamStore,
} from "./multistream-story-fixtures";

const meta = {
  title: "Components/Multistream/Grid",
  component: MultiStreamGrid,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => {
      installMultistreamMocks();
      return (
        <div className="h-[44rem] min-w-[48rem] bg-black p-1">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof MultiStreamGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: () => {
    resetMultistreamStore({ streams: [] });
    return <MultiStreamGrid />;
  },
};

export const ThreeStreamMainPlusTwo: Story = {
  render: () => {
    resetMultistreamStore({
      streams: multistreamFixtures.slice(0, 3),
    });
    return <MultiStreamGrid />;
  },
};

export const FourStreamQuad: Story = {
  render: () => {
    resetMultistreamStore({
      streams: multistreamFixtures,
    });
    return <MultiStreamGrid />;
  },
};

export const FocusMode: Story = {
  render: () => {
    resetMultistreamStore({
      streams: multistreamFixtures,
      layout: "focus",
      focusedStreamId: multistreamFixtures[0].id,
    });
    return <MultiStreamGrid />;
  },
};
