import type { PhysicalConnectivityResult } from "@shared/ipc-channels";

export async function probeConnectivity(): Promise<
  PhysicalConnectivityResult | { status: "unknown" }
> {
  if (typeof window === "undefined") return { status: "online" };
  const check = window.electronAPI?.connectivity?.check;
  if (!check) return { status: "unknown" };
  try {
    return await check();
  } catch {
    return { status: "unknown" };
  }
}
