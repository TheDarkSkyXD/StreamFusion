import { vi } from "vitest";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;


vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

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
  Platform: {
    OS: "android",
    select: (map: Record<string, unknown>) => map.android ?? map.default,
  },
  Dimensions: {
    get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
  },
  NativeModules: {},
  NativeEventEmitter: class {
    constructor(private readonly nativeModule: {
      addListener(event: string): void;
      removeListeners(count: number): void;
    }) {}

    addListener(event: string, _listener: (value: unknown) => void) {
      this.nativeModule.addListener(event);
      return { remove: () => this.nativeModule.removeListeners(1) };
    }
  },
  UIManager: { getViewManagerConfig: () => null },
  requireNativeComponent: (name: string) => name,
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove() {} }),
  },
}));

vi.mock("react-native-svg", () => ({
  default: "Svg",
  Defs: "Defs",
  LinearGradient: "LinearGradient",
  RadialGradient: "RadialGradient",
  Mask: "Mask",
  Filter: "Filter",
  G: "SvgGroup",
  FeDropShadow: "FeDropShadow",
  Image: "SvgImage",
  Text: "SvgText",
  Path: "Path",
  Rect: "Rect",
  Stop: "Stop",
}));

vi.mock("@react-native-community/slider", () => ({
  default: "Slider",
}));
