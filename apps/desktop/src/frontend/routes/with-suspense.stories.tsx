import "@/i18n";
import { lazy } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { withSuspense } from "./with-suspense";

const PendingPage = lazy(() => new Promise<{ default: () => React.JSX.Element }>(() => {}));
const LoadingPage = withSuspense(PendingPage);
const ReadyPage = withSuspense(() => <p>The page is ready.</p>);

const meta = {
  title: "Shell/Page boundary",
  component: LoadingPage,
  decorators: [
    (Story) => (
      <div className="h-64">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LoadingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status", { name: "Loading page" })).toBeVisible();
  },
};

export const Ready: Story = {
  render: () => <ReadyPage />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("The page is ready.")).toBeVisible();
    await expect(within(canvasElement).queryByRole("status")).not.toBeInTheDocument();
  },
};
