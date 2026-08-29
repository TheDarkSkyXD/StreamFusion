import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";

import { withAppRouter } from "../../../../../.storybook/story-router";
import { Button } from "@/components/ui/button";
import { ActiveRecordingDialog } from "./active-recording-dialog";

const recording = {
  sessionId: "recording-742",
  platform: "twitch" as const,
  channelName: "NovaArcade",
  title: "Road to radiant, calm comms and good decisions",
  status: "recording" as const,
  qualityLabel: "1080p60 (Source)",
  capturedDurationSeconds: 2_847,
  gapCount: 0,
};

const meta = {
  title: "Components/Stream/ActiveRecordingDialog",
  component: ActiveRecordingDialog,
  decorators: [withAppRouter],
  args: {
    recording,
    onClose: () => undefined,
    returnFocusRef: { current: null },
  },
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Blocking dialog shown when a second live recording is requested. It explains the single-recording rule and links back to the active capture.",
      },
    },
  },
} satisfies Meta<typeof ActiveRecordingDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function DialogExample({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button ref={triggerRef} onClick={() => setOpen(true)}>
        Start another recording
      </Button>
      <ActiveRecordingDialog
        recording={open ? recording : null}
        onClose={() => setOpen(false)}
        returnFocusRef={triggerRef}
      />
    </>
  );
}

export const Open: Story = {
  render: () => <DialogExample />,
};

export const Closed: Story = {
  render: () => <DialogExample initiallyOpen={false} />,
};
