import type { TextInputProps, TextStyle } from "react-native";

import { mobileColors, mobileSpacing } from "./tokens";

export const mobileTextFieldStyle: Omit<TextStyle, "fontWeight"> = {
  color: mobileColors.textPrimary,
  fontSize: 16,
  includeFontPadding: false,
  paddingVertical: mobileSpacing.small,
};

export const mobileTextFieldProps: Pick<
  TextInputProps,
  | "cursorColor"
  | "keyboardAppearance"
  | "selectionColor"
  | "textAlignVertical"
  | "underlineColorAndroid"
> = {
  cursorColor: mobileColors.textPrimary,
  keyboardAppearance: "dark",
  selectionColor: mobileColors.textPrimary,
  textAlignVertical: "center",
  underlineColorAndroid: "transparent",
};
