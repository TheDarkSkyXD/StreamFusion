import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import { useAuthStore } from "@/store/auth-store";

import { GuestBadge } from "./GuestMode";

function withGuestState(isGuest: boolean): Decorator {
  return (Story) => {
    useAuthStore.setState({ isGuest });
    return <Story />;
  };
}

const meta = {
  title: "Components/Auth/GuestBadge",
  component: GuestBadge,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A compact account-state badge. The component intentionally renders nothing for authenticated users.",
      },
    },
  },
  args: {
    size: "md",
    showIcon: true,
  },
  argTypes: {
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
    },
  },
  decorators: [withGuestState(true)],
} satisfies Meta<typeof GuestBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutIcon: Story = {
  args: {
    showIcon: false,
  },
};

export const SizeScale: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <GuestBadge size="sm" />
      <GuestBadge size="md" />
      <GuestBadge size="lg" />
    </div>
  ),
};

export const Authenticated: Story = {
  decorators: [withGuestState(false)],
  parameters: {
    docs: {
      description: {
        story: "Authenticated state is deliberately empty because the badge only labels guests.",
      },
    },
  },
};
