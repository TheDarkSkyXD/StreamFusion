import type { AndroidMediaJobsContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

export function createAndroidMediaJobsGateway(
  port: AndroidMediaJobsContractPort,
): AndroidMediaJobsContractPort {
  return port;
}
