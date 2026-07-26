import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";
import svgr from "vite-plugin-svgr";

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const fromDesktopRoot = (path: string) => resolve(desktopRoot, path);

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: {
    disableWhatsNewNotifications: true,
  },
  async viteFinal(viteConfig) {
    return mergeConfig(viteConfig, {
      plugins: [
        svgr({
          svgrOptions: {
            icon: true,
            svgoConfig: {
              plugins: [{ name: "removeViewBox", active: false }],
            },
          },
        }),
      ],
      resolve: {
        alias: {
          "@": fromDesktopRoot("src"),
          "@backend": fromDesktopRoot("src/backend"),
          "@frontend": fromDesktopRoot("src/frontend"),
          "@shared": fromDesktopRoot("src/shared"),
        },
      },
    });
  },
};

export default config;
