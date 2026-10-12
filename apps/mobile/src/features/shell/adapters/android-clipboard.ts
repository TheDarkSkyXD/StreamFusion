import { getPlatformModule } from "../../../../modules/streamfusion-native-contracts/src/platform";

export async function copyTextToClipboard(value: string): Promise<void> {
  await getPlatformModule().setClipboardText(value);
}
