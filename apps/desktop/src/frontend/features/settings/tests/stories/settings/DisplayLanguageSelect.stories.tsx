import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import { DisplayLanguageSelect } from "../../../components/settings/DisplayLanguageSelect";
import type { DisplayLanguage } from "@shared/display-language";

const meta = {
  title: "Components/Settings/DisplayLanguageSelect",
  component: DisplayLanguageSelect,
  parameters: { layout: "centered" },
  args: { value: "en", onChange: fn() },
} satisfies Meta<typeof DisplayLanguageSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChooseLanguage: Story = {
  render: () => {
    function Preview() {
      const [value, setValue] = useState<DisplayLanguage>("en");
      return (
        <div className="rounded-lg bg-[#252525] p-8 text-white">
          <DisplayLanguageSelect value={value} onChange={setValue} />
        </div>
      );
    }
    return <Preview />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox"));
    const spanish = await within(canvasElement.ownerDocument.body).findByRole("option", {
      name: /espa/i,
    });
    await userEvent.click(spanish);
    expect(canvas.getByRole("combobox")).toHaveTextContent(/espa/i);
  },
};
