import { lazy, Suspense } from "react";
import { ClientOnly, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import "../global.css";

const DesktopRuntime = lazy(() => import("../renderer/desktop-runtime"));

export const Route = createRootRoute({ component: StartDocument });

function StartDocument() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>StreamFusion</title>
        <HeadContent />
      </head>
      <body>
        <div id="root">
          <ClientOnly fallback={null}>
            <Suspense fallback={null}>
              <DesktopRuntime />
            </Suspense>
          </ClientOnly>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
