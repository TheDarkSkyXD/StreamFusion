import type { InstallationPolicyTransport } from "../capabilities/installation-policy";

export function createUnavailableInstallationPolicyTransport(): InstallationPolicyTransport {
  const unavailable = {
    kind: "failure" as const,
    failure: { kind: "unavailable" as const },
  };
  return {
    async readManifest() {
      return unavailable;
    },
    async register() {
      return unavailable;
    },
    async rotate() {
      return unavailable;
    },
  };
}
