export default {};
export const View = "View";
export const Text = "Text";
export const Pressable = "Pressable";
export const ScrollView = "ScrollView";
export const FlatList = "FlatList";
export const Image = "Image";
export const TextInput = "TextInput";
export const Switch = "Switch";
export const Modal = "Modal";
export const RefreshControl = "RefreshControl";
export const KeyboardAvoidingView = "KeyboardAvoidingView";
export const StyleSheet = {
  create: (styles) => styles,
  absoluteFill: {},
  hairlineWidth: 1,
};
export const Platform = { OS: "android", select: (map) => map.android ?? map.default };
export const Dimensions = { get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }) };
export const NativeModules = {};
export const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };