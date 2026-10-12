import { createElement } from "react";
import { AppRegistry } from "react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";
import { MobileRuntime } from "./src/composition/mobile-runtime";

function MobileApp() {
  return createElement(SafeAreaProvider, { initialMetrics: initialWindowMetrics }, createElement(MobileRuntime));
}

AppRegistry.registerComponent("main", () => MobileApp);
