import type { Meta, StoryObj } from "@storybook/react-native-web-vite";

import { LibraryMockup } from "./library-mockups";

const meta = {
  title: "Android/Screens/Accounts",
  component: LibraryMockup,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LibraryMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ConnectedAndGuest: Story = { args: { kind: "accounts" } };
export const PendingAuthorization: Story = { args: { kind: "authorization" } };
export const SessionExpired: Story = { args: { kind: "expired" } };
