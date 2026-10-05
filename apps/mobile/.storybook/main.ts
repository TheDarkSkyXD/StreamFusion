import type { StorybookConfig } from "@storybook/react-native-web-vite";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  staticDirs: ["./public"],
  stories: [
    "../src/design/**/*.stories.tsx",
    "../src/features/**/components/**/*.stories.tsx",
  ],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-native-web-vite",
    options: {
      modulesToTranspile: [
        "react-native-svg",
        "react-native-safe-area-context",
        "lucide-react-native",
      ],
    },
  },
  core: { disableWhatsNewNotifications: true },
  async viteFinal(viteConfig) {
    return mergeConfig(viteConfig, {
      resolve: {
        alias: {
          "expo-haptics": fileURLToPath(
            new URL("./haptics.ts", import.meta.url),
          ),
        },
      },
    });
  },
};

export default config;
