import type { KickPublicClientConfigurationResolver } from "../../capabilities/kick-session";
import { getPlatformModule } from "../../../../../modules/streamfusion-native-contracts/src/platform";
import { createKickPkceAuthorization } from "./kick-authorization-url";

export function createKickAuthorizer(
  configuration: KickPublicClientConfigurationResolver,
) {
  return async ({ nowEpochMs }: { readonly nowEpochMs: number }) => {
    const { clientId } = await configuration.resolve();
    const scheme = getPlatformModule().appScheme;
    if (scheme !== "streamfusion" && scheme !== "streamfusion-development")
      throw new Error("The StreamFusion app scheme is unavailable.");
    return createKickPkceAuthorization({
      clientId,
      nowEpochMs,
      channel: scheme === "streamfusion" ? "production" : "development",
    });
  };
}
