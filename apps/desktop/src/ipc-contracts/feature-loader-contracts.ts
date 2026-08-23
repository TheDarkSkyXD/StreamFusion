import { z } from "zod";

import { IPC_FEATURES, type IpcFeature } from "../shared/ipc-channels";
import { ipcReplySchema } from "./reliability-contracts";

const featureValues = Object.values(IPC_FEATURES) as [IpcFeature, ...IpcFeature[]];

export const featureLoaderIpcContract = {
  request: z.enum(featureValues),
  response: ipcReplySchema(z.null()),
} as const;
