import { createRequire } from "node:module";

export const toolingRequire = createRequire(
  new URL("../packages/tooling/package.json", import.meta.url),
);
