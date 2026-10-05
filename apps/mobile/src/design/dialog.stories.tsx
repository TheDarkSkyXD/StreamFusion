import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useState } from "react";
import { Text, View } from "react-native";

import { MobileButton } from "./button";
import { MobileDialog } from "./dialog";
import { mobileSpacing, mobileType } from "./tokens";

function DialogExample({
  destructive = true,
}: {
  readonly destructive?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState(
    "Your watch history stays on this device.",
  );
  return (
    <View style={{ padding: mobileSpacing.large, gap: mobileSpacing.medium }}>
      <Text style={mobileType.body}>{result}</Text>
      <MobileButton
        accessibilityLabel="Open confirmation"
        onPress={() => setOpen(true)}
        testID="open-dialog"
        variant="secondary"
      >
        Open confirmation
      </MobileButton>
      <MobileDialog
        confirmLabel={destructive ? "Clear history" : "Allow alerts"}
        destructive={destructive}
        message={
          destructive
            ? "Remove all saved watch history? This does not change your platform account."
            : "Receive an alert when a channel you follow goes live?"
        }
        title={destructive ? "Clear watch history?" : "Enable live alerts?"}
        visible={open}
        onCancel={() => {
          setOpen(false);
          setResult("Canceled. Your history is unchanged.");
        }}
        onConfirm={() => {
          setOpen(false);
          setResult(destructive ? "History cleared." : "Alerts enabled.");
        }}
      />
    </View>
  );
}
const meta = {
  title: "Android/Components/Dialog",
  component: DialogExample,
} satisfies Meta<typeof DialogExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DestructiveConfirmation: Story = {};
export const PermissionRationale: Story = { args: { destructive: false } };
