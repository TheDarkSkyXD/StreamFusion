import type { AndroidDiagnosticsContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type { MultistreamResourceAdmission } from "../capabilities/resource-admission";

export function createAndroidMultistreamAdmission(
  diagnostics: AndroidDiagnosticsContractPort,
): MultistreamResourceAdmission {
  return {
    async read() {
      const result = await diagnostics.readResourceSnapshot();
      if (result.kind !== "completed")
        return {
          kind: "unavailable",
          detail:
            "Device pressure could not be measured. Reduce streams if playback stalls.",
        } as const;
      if (result.value.memory.lowMemory)
        return {
          kind: "pressured",
          detail:
            "Android reports low memory. Remove a stream before adding another.",
        } as const;
      const thermal = result.value.thermal;
      if (
        thermal.kind === "observed" &&
        ["severe", "critical", "emergency", "shutdown"].includes(thermal.state)
      )
        return {
          kind: "pressured",
          detail:
            "Android reports high thermal pressure. Let the device cool before adding another stream.",
        } as const;
      return { kind: "clear" } as const;
    },
  };
}
