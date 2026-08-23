import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { useDownloadDuplicateConfirmationStore } from "@/store/download-duplicate-confirmation-store";

import { DownloadDuplicateConfirmationDialog } from "./download-duplicate-confirmation-dialog";

function installPendingDownload(
  kind: "video" | "clip",
  title: string,
  onResolve = fn()
): () => void {
  const previousState = useDownloadDuplicateConfirmationStore.getState();

  useDownloadDuplicateConfirmationStore.setState({
    pending: { kind, title, resolve: onResolve },
  });

  return () => {
    useDownloadDuplicateConfirmationStore.setState(previousState, true);
  };
}

const meta = {
  title: "Components/Downloads/DuplicateConfirmationDialog",
  component: DownloadDuplicateConfirmationDialog,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A focused duplicate-download decision. Stories seed the confirmation store directly and never start a download or use IPC.",
      },
    },
  },
} satisfies Meta<typeof DownloadDuplicateConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vod: Story = {
  beforeEach: () =>
    installPendingDownload("video", "Road to radiant, calm comms and good decisions"),
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Download this VOD again?");
    await expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  },
};

export const Clip: Story = {
  beforeEach: () => installPendingDownload("clip", "Last-second ace"),
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Download this clip again?");
  },
};

export const ConfirmDownloadAgain: Story = {
  beforeEach: () => installPendingDownload("video", "Road to radiant"),
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Download again" }));
    await expect(
      within(canvasElement.ownerDocument.body).queryByRole("alertdialog")
    ).not.toBeInTheDocument();
  },
};
