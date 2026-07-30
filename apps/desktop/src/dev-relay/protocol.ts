import { decodeRelayValue, encodeRelayValue, type RelayValue } from "./codec";

export type RelayMessage =
  | { type: "call"; id: string; path: string[]; args: unknown[] }
  | { type: "result"; id: string; ok: true; value: unknown }
  | {
      type: "result";
      id: string;
      ok: false;
      error: { name: string; message: string; code?: string };
    }
  | { type: "subscribe"; id: string; path: string[]; args: unknown[] }
  | { type: "event"; id: string; args: unknown[] }
  | { type: "unsubscribe"; id: string };

export function encodeRelayMessage(message: RelayMessage): string {
  return JSON.stringify(encodeRelayValue(message));
}

export function decodeRelayMessage(payload: string): RelayMessage {
  return decodeRelayValue(JSON.parse(payload) as RelayValue) as RelayMessage;
}

export function serializeRelayError(error: unknown): {
  name: string;
  message: string;
  code?: string;
} {
  if (!(error instanceof Error)) return { name: "Error", message: String(error) };
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { name: error.name, message: error.message, ...(code ? { code } : {}) };
}
