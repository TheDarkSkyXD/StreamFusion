import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useState } from "react";
import { Text, View } from "react-native";

import { MobileButton, mobileButtonVariants } from "./button";
import { mobileSpacing, mobileType } from "./tokens";

const meta = {
  title: "Android/Components/Button",
  component: MobileButton,
  args: {
    accessibilityLabel: "Follow channel",
    children: "Follow channel",
    onPress: () => {},
    testID: "button-story",
    variant: "primary",
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof MobileButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Primary: Story = {};
export const Secondary: Story = { args: { variant: "secondary" } };
export const Outline: Story = { args: { variant: "outline" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Twitch: Story = {
  args: { variant: "twitch", children: "Connect Twitch" },
};
export const Kick: Story = {
  args: { variant: "kick", children: "Connect Kick" },
};
export const Destructive: Story = {
  args: { variant: "destructive", children: "Delete recording" },
};
export const Disabled: Story = { args: { disabled: true } };
export const Busy: Story = { args: { busy: true, children: "Connecting..." } };
export const AllVariants: Story = {
  render: () => (
    <View style={{ gap: mobileSpacing.medium }}>
      {mobileButtonVariants.map((variant) => (
        <MobileButton
          key={variant}
          accessibilityLabel={variant}
          onPress={() => {}}
          testID={variant}
          variant={variant}
        >
          {variant}
        </MobileButton>
      ))}
    </View>
  ),
};
export const Interactive: Story = {
  render: function Interactive() {
    const [followed, setFollowed] = useState(false);
    return (
      <View style={{ gap: mobileSpacing.medium }}>
        <MobileButton
          accessibilityLabel={followed ? "Unfollow" : "Follow"}
          onPress={() => setFollowed(!followed)}
          testID="interactive-follow"
          variant={followed ? "secondary" : "primary"}
        >
          {followed ? "Following" : "Follow"}
        </MobileButton>
        <Text style={mobileType.body}>
          {followed
            ? "Saved to Guest Follows"
            : "Follow this channel on this device"}
        </Text>
      </View>
    );
  },
};
