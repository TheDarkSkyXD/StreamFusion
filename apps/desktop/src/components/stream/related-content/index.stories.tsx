import type { Meta, StoryObj } from "@storybook/react-vite";

import { RelatedContent } from "./index";
import { relatedChannel, relatedClips, relatedVideos } from "./related-content-story-fixtures";
import { RelatedContentStoryRouter } from "./related-content-story-router";

function installRelatedContentMocks(mode: "success" | "empty" | "error") {
  window.electronAPI.store.get = async <T,>() => null as T | null;
  window.electronAPI.store.set = async () => undefined;
  window.electronAPI.videos.getByChannel = async () =>
    mode === "error"
      ? { success: false, error: "The video archive is temporarily unavailable." }
      : { success: true, data: mode === "empty" ? [] : relatedVideos };
  window.electronAPI.clips.getByChannel = async () =>
    mode === "error"
      ? { success: false, error: "The clip archive is temporarily unavailable." }
      : { success: true, data: mode === "empty" ? [] : relatedClips };
  window.electronAPI.clips.getPlaybackUrl = async () => ({
    success: true,
    data: { url: "https://example.com/clip.mp4", format: "mp4" },
  });
}

function RelatedContentFixture({
  tab,
  mode,
}: {
  tab: "home" | "videos" | "clips";
  mode: "success" | "empty" | "error";
}) {
  installRelatedContentMocks(mode);
  return (
    <RelatedContentStoryRouter initialPath={`/stream/twitch/novaarcade?tab=${tab}`}>
      <div className="mx-auto max-w-6xl">
        <RelatedContent platform="twitch" channelName="novaarcade" channelData={relatedChannel} />
      </div>
    </RelatedContentStoryRouter>
  );
}

const meta = {
  title: "Components/Stream/Related Content/Browser",
  component: RelatedContent,
  parameters: { layout: "padded" },
  args: {
    platform: "twitch",
    channelName: "novaarcade",
    channelData: relatedChannel,
  },
} satisfies Meta<typeof RelatedContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {
  render: () => <RelatedContentFixture tab="home" mode="success" />,
};

export const Videos: Story = {
  render: () => <RelatedContentFixture tab="videos" mode="success" />,
};

export const Clips: Story = {
  render: () => <RelatedContentFixture tab="clips" mode="success" />,
};

export const EmptyVideos: Story = {
  render: () => <RelatedContentFixture tab="videos" mode="empty" />,
};

export const Error: Story = {
  render: () => <RelatedContentFixture tab="videos" mode="error" />,
};
