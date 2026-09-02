import { toast } from "sonner";
import { translateSettings } from "./settings-translation";

/**
 * Unified "saved" toast for the Settings page and the Chat settings section.
 *
 * Settings controls auto-save on change, so feedback must be unmissable but not
 * spammy. A single stable toast `id` means rapid-fire saves (e.g. dragging a
 * buffer/font-size slider, which fires per tick) collapse into one toast that
 * just refreshes its timer instead of stacking dozens.
 */
export function notifySettingsSaved(message: string = translateSettings("settings.settingsSaved")) {
  toast.success(message, { id: "settings-saved" });
}
