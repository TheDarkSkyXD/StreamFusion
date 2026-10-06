import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { MobileBottomSheet } from "./bottom-sheet";
import { MobileButton } from "./button";
import { MobileListRow } from "./list-row";
import { mobileColors, mobileSpacing, mobileType } from "./tokens";

function SheetExample({
  form = false,
  long = false,
  startOpen = true,
}: {
  readonly form?: boolean;
  readonly long?: boolean;
  readonly startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [choice, setChoice] = useState("Auto");
  return (
    <View
      style={{
        flex: 1,
        padding: mobileSpacing.large,
        gap: mobileSpacing.medium,
      }}
    >
      <Text style={mobileType.display}>Settings</Text>
      <Text style={mobileType.body}>Selected quality · {choice}</Text>
      <MobileButton
        accessibilityLabel="Open sheet"
        onPress={() => setOpen(true)}
        testID="open-sheet"
        variant="primary"
      >
        Open sheet
      </MobileButton>
      <MobileBottomSheet
        title={form ? "Add channel" : "Quality"}
        visible={open}
        onDismiss={() => setOpen(false)}
        size={long || form ? "expanded" : "content"}
        {...(form
          ? {
              footer: (
                <MobileButton
                  accessibilityLabel="Save channel"
                  onPress={() => setOpen(false)}
                  testID="save-channel"
                  variant="primary"
                >
                  Save channel
                </MobileButton>
              ),
            }
          : {})}
      >
        {form ? (
          <TextInput
            accessibilityLabel="Channel username"
            placeholder="Channel username"
            placeholderTextColor={mobileColors.textSecondary}
            style={{
              color: mobileColors.textPrimary,
              backgroundColor: mobileColors.surfaceMuted,
              borderRadius: 8,
              padding: 16,
              minHeight: 48,
            }}
          />
        ) : null}
        {(form
          ? []
          : long
            ? Array.from({ length: 24 }, (_, index) => `Option ${index + 1}`)
            : ["Auto", "1080p60", "720p60", "480p", "Audio only"]
        ).map((label) => (
          <MobileListRow
            title={label}
            key={label}
            trailing={
              <Text style={mobileType.label}>
                {choice === label ? "Selected" : ""}
              </Text>
            }
            onPress={() => {
              setChoice(label);
              setOpen(false);
            }}
          />
        ))}
      </MobileBottomSheet>
    </View>
  );
}
const meta = {
  title: "Android/Components/Bottom sheet",
  component: SheetExample,
} satisfies Meta<typeof SheetExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Selection: Story = {};
export const Closed: Story = { args: { startOpen: false } };
export const LongScrollableList: Story = { args: { long: true } };
export const FormWithFooter: Story = { args: { form: true } };
