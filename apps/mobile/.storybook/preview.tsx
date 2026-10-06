import type { Preview } from "@storybook/react-native-web-vite";
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import "./preview.css";
import "@mobile/i18n";

const androidInsets = { top: 24, right: 0, bottom: 24, left: 0 };

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { matchers: { color: /(background|color)$/i } },
    backgrounds: {
      options: { dark: { name: "StreamFusion", value: "#0f0f0f" } },
    },
    a11y: { test: "error" },
    viewport: {
      options: {
        compact: {
          name: "Compact Android",
          styles: { width: "360px", height: "800px" },
          type: "mobile",
        },
        phone: {
          name: "Android phone",
          styles: { width: "412px", height: "892px" },
          type: "mobile",
        },
        tablet: {
          name: "Android tablet",
          styles: { width: "800px", height: "1280px" },
          type: "tablet",
        },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: "dark" },
    viewport: { value: "phone" },
  },
  decorators: [
    (Story) => (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 412, height: 892 },
          insets: androidInsets,
        }}
      >
        <SafeAreaInsetsContext.Provider value={androidInsets}>
          <Story />
        </SafeAreaInsetsContext.Provider>
      </SafeAreaProvider>
    ),
  ],
};

export default preview;
