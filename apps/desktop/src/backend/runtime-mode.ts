export type DebuggingPolicy =
  | { readonly kind: "disabled" }
  | { readonly kind: "cdp"; readonly source: "cli"; readonly port: number };

function parseExplicitPort(argv: readonly string[]): number | null {
  const argument = argv.find((value) => value.startsWith("--remote-debugging-port="));
  if (!argument) return null;
  const port = Number(argument.slice(argument.indexOf("=") + 1));
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

export function resolveDebuggingPolicy(input: {
  readonly isPackaged: boolean;
  readonly argv: readonly string[];
}): DebuggingPolicy {
  if (input.isPackaged) return { kind: "disabled" };

  const explicitPort = parseExplicitPort(input.argv);
  return explicitPort === null
    ? { kind: "disabled" }
    : { kind: "cdp", source: "cli", port: explicitPort };
}
