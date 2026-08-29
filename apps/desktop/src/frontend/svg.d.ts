/// <reference types="vite-plugin-svgr/client" />

// Allows importing SVGs as React components
// Usage: import { ReactComponent as Logo } from '../shared/logo.svg';
// Or default import: import Logo from '../shared/logo.svg?react';
declare module "*.svg?react" {
  import * as React from "react";
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

declare module "*.svg" {
  const src: string;
  export default src;
  import * as React from "react";
  export const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
}
