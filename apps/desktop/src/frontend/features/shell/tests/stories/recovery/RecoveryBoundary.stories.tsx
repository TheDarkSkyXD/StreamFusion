import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { RecoveryBoundary } from "../../../components/recovery/RecoveryBoundary";

function FailingContent({ fail }: { fail: boolean }) {
  if (fail) throw new Error("Fixture render failure");
  return <p className="p-5 text-white">Following channels are available again.</p>;
}

function RecoveryPreview() {
  const [fail, setFail] = useState(true);
  return (
    <div className="w-[540px] bg-[#1a1a1a]">
      <RecoveryBoundary name="Following sidebar">
        <FailingContent fail={fail} />
      </RecoveryBoundary>
      <button
        type="button"
        className="m-4 text-sm text-white underline"
        onClick={() => setFail(false)}
      >
        Restore fixture
      </button>
    </div>
  );
}

const meta = {
  title: "Components/Shell/RecoveryBoundary",
  component: RecoveryBoundary,
  parameters: { layout: "centered" },
  args: { name: "Following sidebar", children: null },
} satisfies Meta<typeof RecoveryBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RegionFailure: Story = {
  render: () => <RecoveryPreview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByRole("alert")).toHaveTextContent("Following sidebar");
    expect(canvas.queryByText("Fixture render failure")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Restore fixture" }));
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    expect(await canvas.findByText("Following channels are available again.")).toBeVisible();
  },
};
