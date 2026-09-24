import { vi } from "vitest";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  FlatList: "FlatList",
  Image: "Image",
  TextInput: "TextInput",
  Switch: "Switch",
  Modal: "Modal",
  RefreshControl: "RefreshControl",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  StyleSheet: {
    create: (styles: unknown) => styles,
    absoluteFill: {},
    hairlineWidth: 1,
  },
  Platform: { OS: "android", select: (map: Record<string, unknown>) => map.android ?? map.default },
  Dimensions: { get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }) },
  NativeModules: {},
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
}));

vi.mock("@react-native-community/slider", () => ({
  default: "Slider",
}));

vi.mock("expo-crypto", () => ({
  getRandomValues: (typedArray: Uint8Array) => {
    for (let index = 0; index < typedArray.length; index += 1) {
      typedArray[index] = (index * 17 + 3) % 256;
    }
    return typedArray;
  },
}));