import { Share } from "react-native";

import type { SupportSharePort } from "../capabilities/support-settings";

export function createSupportSharePort(): SupportSharePort {
  return {
    async share(message) {
      try {
        const result = await Share.share({ message });
        if (result.action === Share.dismissedAction) {
          return "Share was dismissed. The redacted report remains on this device.";
        }
        return "Android share opened for the redacted local report.";
      } catch {
        return "No share target was available. The redacted report remains on this device.";
      }
    },
  };
}
