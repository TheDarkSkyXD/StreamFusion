import { Linking } from "react-native";

import type { SupportReleaseOpenPort } from "../capabilities/support-settings";

export function createGithubReleaseOpenPort(): SupportReleaseOpenPort {
  return { open: (url) => Linking.openURL(url) };
}
