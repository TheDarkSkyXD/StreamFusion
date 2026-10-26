import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PanelDecision } from "../../../components/panels/PanelDecision";
import type { TwitchApiResult } from "@shared/twitch-api-types";

const onSuccess = fn();
const apply: (value: string) => Promise<TwitchApiResult> = async () => ({ ok: true, data: null });
const meta = {
  title: "Moderation/Panels/Decision",
  component: PanelDecision,
  args: {
    actions: [{ value: "FULFILLED", label: "Fulfill request" }],
    apply,
    onSuccess,
  },
} satisfies Meta<typeof PanelDecision>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Confirm: Story = {
  play: async ({ canvasElement }) => {
    onSuccess.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Fulfill request" }));
    await expect(canvas.getByText(/Fulfill request/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Confirm" }));
    await expect(onSuccess).toHaveBeenCalledWith("FULFILLED");
  },
};
export const Failed: Story = {
  args: {
    apply: async () => ({
      ok: false,
      error: { code: "unavailable", message: "Fixture request failed." },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Fulfill request" }));
    await userEvent.click(canvas.getByRole("button", { name: "Confirm" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Fixture request failed.");
  },
};
