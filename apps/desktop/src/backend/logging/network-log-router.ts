import { addLogSink } from "@/backend/logging/logger";
import { networkLogger } from "@/backend/logging/network-logger";

const NETWORK_TAG_PATTERNS = [
  /^Chromium$/,
  /^Network:/,
  /^Renderer:NetworkMonitor$/,
  /^StatusPoller$/,
  /^PlatformHealth$/,
  /^ProcessMonitor$/,
  /^Kick:(Health|StreamResolver|Endpoints:Stream)/,
  /^Twitch:(Manifest|StreamResolver)/,
  /^Player:/,
  /^Service:(StreamProxy|TwitchManifest|NetworkAdblock)/,
  /^IPC:Stream$/,
];

const NETWORK_TEXT_PATTERN =
  /\b(network|network_service|net::|turn_port|webrtc|ivs|manifest|m3u8|hls|spdy|http\/2|ssl_client_socket|handshake failed|streamresolver|stream resolver|status page|partial outage|major outage|degraded)\b/i;

function isNetworkEntry(entry: { tag: string; message: string; line: string }): boolean {
  if (NETWORK_TAG_PATTERNS.some((pattern) => pattern.test(entry.tag))) return true;
  return NETWORK_TEXT_PATTERN.test(entry.message) || NETWORK_TEXT_PATTERN.test(entry.line);
}

export function installNetworkLogRouter(): () => void {
  return addLogSink(({ level, tag, message, meta, line }) => {
    if (!isNetworkEntry({ tag, message, line })) return;
    networkLogger[level](tag, message, meta);
  });
}
