import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import { TitleBar } from "./TitleBar";

function withMaximizedState(isMaximized: boolean): Decorator {
  return (Story) => {
    const baseBridge = window.electronAPI;
    const storyBridge = new Proxy(baseBridge, {
      get(target, property, receiver) {
        if (property === "isMaximized") return async () => isMaximized;
        return Reflect.get(target, property, receiver);
      },
    });
    Reflect.defineProperty(window, "electronAPI", {
      configurable: true,
      value: storyBridge,
    });
    return <Story />;
  };
}

const meta = {
  title: "Components/Layout/TitleBar",
  component: TitleBar,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The draggable frameless-window title bar. Electron window actions are safely mocked in Storybook.",
      },
    },
  },
  decorators: [withMaximizedState(false)],
} satisfies Meta<typeof TitleBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Windowed: Story = {};

export const Maximized: Story = {
  decorators: [withMaximizedState(true)],
};
