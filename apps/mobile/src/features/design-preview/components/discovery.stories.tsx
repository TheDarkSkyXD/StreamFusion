import type { Meta, StoryObj } from "@storybook/react-native-web-vite";

import { DiscoveryLoadingMockup, DiscoveryMockup } from "./discovery-mockups";

const meta = {
  title: "Android/Screens/Discovery",
  component: DiscoveryMockup,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DiscoveryMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Home: Story = { args: { kind: "home" } };
export const Search: Story = { args: { kind: "search" } };
export const SearchResultPreview: Story = { args: { kind: "search-result" } };
export const Categories: Story = { args: { kind: "categories" } };
export const CategoryDetail: Story = { args: { kind: "category" } };
export const ChannelDetail: Story = { args: { kind: "channel" } };
export const Following: Story = { args: { kind: "following" } };
export const FollowingChannelPreview: Story = {
  args: { kind: "following-preview" },
};
export const ManageGuestFollows: Story = { args: { kind: "manage-follows" } };
export const Loading: Story = { render: () => <DiscoveryLoadingMockup /> };
