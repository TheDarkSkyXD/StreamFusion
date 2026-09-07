import { execFile } from "node:child_process";

const PROCESSOR_POWER_SUBGROUP = "54533251-82be-4824-96c1-47b60b740d00";
const MAXIMUM_PROCESSOR_STATE = "bc5038f7-23e0-4960-96da-33abaf5935ec";
const MAX_OUTPUT_BYTES = 64 * 1_024;

export interface CpuSpeedLimitReading {
  readonly observedAtMs: number;
  readonly percent: number;
}

export function parseWindowsCpuSpeedLimit(
  output: string,
  isOnBatteryPower: boolean
): number | null {
  const hexadecimalValues = [...output.matchAll(/0x([0-9a-f]{8})/gi)].map((match) =>
    Number.parseInt(match[1], 16)
  );
  if (hexadecimalValues.length < 2) return null;

  // powercfg emits the current AC and DC indices last, after the setting bounds.
  const [acPercent, batteryPercent] = hexadecimalValues.slice(-2);
  const percent = isOnBatteryPower ? batteryPercent : acPercent;
  return Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : null;
}

export function readWindowsCpuSpeedLimit(isOnBatteryPower: boolean): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "powercfg",
      ["/QUERY", "SCHEME_CURRENT", PROCESSOR_POWER_SUBGROUP, MAXIMUM_PROCESSOR_STATE],
      { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, timeout: 5_000, windowsHide: true },
      (error, stdout) => {
        resolve(error ? null : parseWindowsCpuSpeedLimit(stdout, isOnBatteryPower));
      }
    );
  });
}
