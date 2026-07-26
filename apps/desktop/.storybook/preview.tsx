import "./browser-mocks";
import "../src/index.css";
import "./preview.css";

import type { Preview } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

function StoryProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnMount: false,
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

const preview: Preview = {
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  parameters: {
    a11y: {
      test: "todo",
    },
    backgrounds: {
      options: {
        dark: {
          name: "StreamFusion dark",
          value: "#0f0f0f",
        },
        elevated: {
          name: "StreamFusion elevated",
          value: "#2d2d2d",
        },
        light: {
          name: "Light",
          value: "#ffffff",
        },
      },
    },
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      codePanel: true,
    },
    layout: "padded",
  },
  initialGlobals: {
    backgrounds: {
      value: "dark",
    },
  },
  tags: ["autodocs"],
};

export default preview;
