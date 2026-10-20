import type { TextInputProps, TextStyle } from "react-native";

import { mobileColors, mobileSpacing, mobileType } from "./tokens";

export const mobileTextFieldStyle: Omit<TextStyle, "fontWeight"> = {
  color: mobileColors.textPrimary,
  fontSize: mobileType.body.fontSize,
  includeFontPadding: false,
  paddingVertical: mobileSpacing.small,
};

export const mobileTextFieldProps: Pick<
  TextInputProps,
  | "cursorColor"
  | "keyboardAppearance"
  | "placeholderTextColor"
  | "selectionColor"
  | "textAlignVertical"
  | "underlineColorAndroid"
> = {
  cursorColor: mobileColors.textPrimary,
  keyboardAppearance: "dark",
  placeholderTextColor: mobileColors.textSecondary,
  selectionColor: mobileColors.textPrimary,
  textAlignVertical: "center",
  underlineColorAndroid: "transparent",
};
