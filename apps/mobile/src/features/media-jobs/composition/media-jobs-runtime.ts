import type { AndroidMediaJobsContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

import type { MediaJobRepository, MediaJobWorkflow } from "../capabilities/media-jobs";
import { createMediaJobWorkflow } from "../domain/media-job-workflow";

export function createMediaJobsRuntime(options: {
  readonly activity: ActivityRepository;
  readonly native: AndroidMediaJobsContractPort;
  readonly product: MediaJobRepository;
}): MediaJobWorkflow {
  return createMediaJobWorkflow(options);
}
