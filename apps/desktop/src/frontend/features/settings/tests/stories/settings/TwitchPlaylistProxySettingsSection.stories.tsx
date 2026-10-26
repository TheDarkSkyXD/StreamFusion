import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect, type ReactNode } from "react";
import { expect, userEvent, within } from "storybook/test";

import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { TwitchPlaylistProxySettingsSection } from "../../../components/settings/TwitchPlaylistProxySettingsSection";

function LocalProxyPreferences({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const previous = useAuthStore.getState();
    const previousFetch = window.fetch;
    window.fetch = async () => {
      throw new Error("Offline Storybook probe");
    };
    useAuthStore.setState({
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        twitchPlaylistProxy: {
          enabled: true,
          sources: [
            {
              id: "storybook-proxy",
              url: "https://story.invalid/live/$channel",
              enabled: true,
              addQueryParams: true,
            },
          ],
        },
      },
      updatePreferences: async (updates) => {
        const preferences = useAuthStore.getState().preferences ?? DEFAULT_USER_PREFERENCES;
        useAuthStore.setState({ preferences: { ...preferences, ...updates } });
      },
    });
    return () => {
      useAuthStore.setState({
        preferences: previous.preferences,
        updatePreferences: previous.updatePreferences,
      });
      window.fetch = previousFetch;
    };
  }, []);
  return children;
}

const meta = {
  title: "Components/Settings/TwitchPlaylistProxySettingsSection",
  component: TwitchPlaylistProxySettingsSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <LocalProxyPreferences>
        <div className="mx-auto max-w-4xl">
          <Story />
        </div>
      </LocalProxyPreferences>
    ),
  ],
} satisfies Meta<typeof TwitchPlaylistProxySettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ManageSources: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByText("https://story.invalid/live/$channel")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Add source" }));
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add source" }));
    expect(within(dialog).getByText(/includes \$channel/i)).toBeVisible();
  },
};
