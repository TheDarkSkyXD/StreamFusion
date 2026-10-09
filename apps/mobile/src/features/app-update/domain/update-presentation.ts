import type { UpdatePhase, UpdateRelease } from "../capabilities/android-updater";

export type UpdateAction = "download" | "later" | "cancel" | "hide" | "retry" | "install";

export type UpdatePresentation = {
  readonly title: string;
  readonly detail: string;
  readonly progress: { readonly bytes: number; readonly total: number } | null;
  readonly actions: readonly UpdateAction[];
  readonly installLabel?: string;
};

export function updatePresentation(
  phase: UpdatePhase,
  offered: UpdateRelease | null,
): UpdatePresentation | null {
  if (phase.kind === "idle" || phase.kind === "unsupported" ||
    (offered !== null && "release" in phase && offered.tag !== phase.release.tag &&
      (phase.kind === "installed" || phase.kind === "canceled" || phase.kind === "failed"))) {
    return offered
      ? {
          title: `Android ${offered.version} is available`,
          detail: phase.kind === "unsupported"
            ? phase.message
            : "Tap Update to download and verify the app. Android will then ask you to approve installation, even if you leave and return.",
          progress: null,
          actions: phase.kind === "unsupported" ? ["later"] : ["download", "later"],
        }
      : null;
  }
  const title = `Android ${phase.release.version}`;
  switch (phase.kind) {
    case "downloading":
      return {
        title: `${title} is downloading`,
        detail: "The download continues if you hide this window.",
        progress: { bytes: phase.bytes, total: phase.total },
        actions: ["cancel", "hide"],
      };
    case "paused":
      return {
        title: `${title} download paused`,
        detail: "The transfer stopped. Retry starts it again from the beginning.",
        progress: { bytes: phase.bytes, total: phase.release.apkBytes },
        actions: ["retry", "cancel", "hide"],
      };
    case "verifying":
      return { title: `Verifying ${title}`, detail: "Checking the APK and app signature.", progress: null, actions: ["hide"] };
    case "ready":
      return { title: `${title} is ready`, detail: "Opening Android approval. If it does not appear, tap Install.", progress: null, actions: ["install", "hide"] };
    case "permission-needed":
      return { title: "Allow updates from StreamFusion", detail: "Enable installation permission for this app, then return. Android approval will open automatically.", progress: null, actions: ["install", "hide"], installLabel: "Open settings" };
    case "staging":
      return { title: `Preparing ${title}`, detail: "Handing the verified APK to Android.", progress: null, actions: ["hide"] };
    case "awaiting-approval":
      return { title: "Approve the Android update", detail: "Review Android's installation prompt. If it closed, tap Continue install.", progress: null, actions: ["install", "hide"], installLabel: "Continue install" };
    case "installed":
      return { title: `${title} installed`, detail: "Android confirmed the new app version.", progress: null, actions: ["hide"] };
    case "canceled":
      return { title: `${title} canceled`, detail: "You can start the download again.", progress: null, actions: ["retry", "hide"] };
    case "failed":
      return {
        title: `${title} could not finish`,
        detail: failureCopy(phase.code),
        progress: null,
        actions: phase.retry === "none" ? ["hide"] : ["retry", "hide"],
      };
  }
}

function failureCopy(code: Extract<UpdatePhase, { kind: "failed" }>["code"]): string {
  switch (code) {
    case "network": return "Connection failed. Check your network and retry.";
    case "storage": return "Not enough storage to keep the update.";
    case "metadata": return "Release metadata did not match the selected APK.";
    case "checksum": return "The APK bytes did not match the published checksum.";
    case "signature": return "The APK signature could not be verified.";
    case "package": return "The APK does not update this installed app.";
    case "version": return "The APK is not newer than this installation.";
    case "sdk": return "The APK does not support this Android version.";
    case "install-blocked": return "Android did not approve installation. Your downloaded update is still ready.";
    case "install-failed": return "Android could not install the update.";
    case "interrupted": return "The update was interrupted. Retry to continue.";
  }
}
