const DEFAULT_DEVELOPMENT_CDP_PORT = 9236;

export type DebuggingPolicy =
  | { readonly kind: "disabled" }
  | { readonly kind: "cdp"; readonly source: "cli" | "default"; readonly port: number };

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
    ? { kind: "cdp", source: "default", port: DEFAULT_DEVELOPMENT_CDP_PORT }
    : { kind: "cdp", source: "cli", port: explicitPort };
}
