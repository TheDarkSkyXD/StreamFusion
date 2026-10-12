import type { StorybookConfig } from "@storybook/react-native-web-vite";

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
};

export default config;
