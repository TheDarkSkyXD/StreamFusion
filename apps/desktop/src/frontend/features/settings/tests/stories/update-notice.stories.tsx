import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { toast } from "sonner";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { NavigateFn } from "@tanstack/react-router";

import { ToastRoot } from "@/features/shell/components/ToastRoot";
import { UpdateNotice } from "../../components/update-notice";
import { useUpdateStore, type UpdateStatus } from "../../components/state/update-store";

function UpdatePreview({ status, navigate }: { status: UpdateStatus; navigate: NavigateFn }) {
  useEffect(() => {
    const previous = useUpdateStore.getState();
    useUpdateStore.setState({
      status,
      updateInfo: {
        version: "2.3.0",
        releaseDate: "2026-08-10T12:00:00.000Z",
        releaseNotes: null,
        releaseName: null,
      },
    });
    return () => {
      useUpdateStore.setState({ status: previous.status, updateInfo: previous.updateInfo });
      toast.dismiss("app-update-available");
    };
  }, [status]);
  return (
    <>
      <UpdateNotice navigate={navigate} />
      <ToastRoot />
    </>
  );
}

const navigateAction = fn();
const navigate: NavigateFn = (options) => {
  navigateAction(options);
  return Promise.resolve();
};

const meta = {
  title: "Components/Settings/UpdateNotice",
  component: UpdateNotice,
  parameters: { layout: "fullscreen" },
  args: { navigate },
} satisfies Meta<typeof UpdateNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {
  render: ({ navigate }) => <UpdatePreview status="available" navigate={navigate} />,
  play: async ({ canvasElement }) => {
    navigateAction.mockClear();
    const canvas = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(canvas.getByText("Version 2.3.0 is available")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Updates" }));
    expect(navigateAction).toHaveBeenCalledWith({ to: "/settings", search: { tab: "updates" } });
  },
};

export const ReadyToInstall: Story = {
  render: ({ navigate }) => <UpdatePreview status="downloaded" navigate={navigate} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(canvas.getByText("Update ready to install")).toBeVisible());
  },
};
