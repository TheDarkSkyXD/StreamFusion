import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { ToastRoot } from "./ToastRoot";

type ToastKind = "success" | "error" | "warning" | "info";

function showToast(kind: ToastKind, title: string, description: string, id?: string) {
  const options = { description, id };
  switch (kind) {
    case "success":
      toast.success(title, options);
      break;
    case "error":
      toast.error(title, options);
      break;
    case "warning":
      toast.warning(title, options);
      break;
    case "info":
      toast.info(title, options);
      break;
  }
}

function ToastPreview({ kind }: { kind: ToastKind }) {
  useEffect(() => {
    toast.dismiss();
    showToast(
      kind,
      kind === "success"
        ? "Recording saved"
        : kind === "error"
          ? "Could not connect"
          : kind === "warning"
            ? "Connection is unstable"
            : "Update available",
      kind === "success"
        ? "Late-night-ranked.mp4 is ready in Downloads."
        : "StreamFusion will keep your current view and retry in the background.",
      `storybook-${kind}`
    );
    return () => {
      toast.dismiss();
    };
  }, [kind]);

  return (
    <>
      <Button
        variant="secondary"
        onClick={() =>
          showToast(
            kind,
            "Fresh notification",
            "This toast was triggered from the Storybook canvas."
          )
        }
      >
        Show {kind} toast
      </Button>
      <ToastRoot />
    </>
  );
}

const meta = {
  title: "Components/Notifications/ToastRoot",
  component: ToastRoot,
  parameters: {
    layout: "centered",
    docs: {
      story: { inline: false },
      description: {
        component:
          "The single global Sonner viewport with StreamFusion colors, spacing, icons, actions, and close controls.",
      },
    },
  },
} satisfies Meta<typeof ToastRoot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  render: () => <ToastPreview kind="success" />,
};

export const Error: Story = {
  render: () => <ToastPreview kind="error" />,
};

export const Warning: Story = {
  render: () => <ToastPreview kind="warning" />,
};

export const Info: Story = {
  render: () => <ToastPreview kind="info" />,
};
