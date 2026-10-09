import type { UpdatePhase, UpdateRelease } from "../capabilities/android-updater";

export type UpdateAction = "download" | "later" | "cancel" | "hide" | "retry" | "install";

type DialogPresentation = {
  readonly kind: "offer" | "download" | "recovery";
  readonly title: string | null;
  readonly detail: string;
  readonly progress: { readonly bytes: number; readonly total: number } | null;
  readonly actions: readonly UpdateAction[];
  readonly dismissAction: "later" | "cancel" | "hide";
  readonly installLabel?: string;
  readonly failureDetail?: string | null;
};

export type UpdatePresentation = DialogPresentation | {
  readonly kind: "handoff";
  readonly detail: string;
  readonly installLabel: "Install" | "Open settings" | "Continue install" | null;
};

export type UpdateDialogModel = DialogPresentation;

export function updatePresentation(
  phase: UpdatePhase,
  offered: UpdateRelease | null,
): UpdatePresentation | null {
  if (phase.kind === "idle" || phase.kind === "unsupported" ||
    (offered !== null && "release" in phase && offered.tag !== phase.release.tag &&
      (phase.kind === "installed" || phase.kind === "canceled" || phase.kind === "failed"))) {
    return offered
      ? phase.kind === "unsupported"
        ? { kind: "recovery", title: "Update unavailable", detail: phase.message, progress: null, actions: ["hide"], dismissAction: "hide" }
        : { kind: "offer", title: "Update available", detail: "Download latest update?", progress: null, actions: ["later", "download"], dismissAction: "later" }
      : null;
  }
  const title = `Android ${phase.release.version}`;
  switch (phase.kind) {
    case "downloading":
      return { kind: "download", title: null, detail: "", progress: { bytes: phase.bytes, total: phase.total }, actions: ["cancel"], dismissAction: "cancel" };
    case "verifying":
      return { kind: "download", title: null, detail: "", progress: { bytes: phase.release.apkBytes, total: phase.release.apkBytes }, actions: ["cancel"], dismissAction: "cancel" };
    case "ready":
      return { kind: "handoff", detail: "The verified update is ready for Android installation.", installLabel: "Install" };
    case "permission-needed":
      return { kind: "handoff", detail: "Allow updates from StreamFusion in Android settings, then return.", installLabel: "Open settings" };
    case "staging":
      return { kind: "handoff", detail: "Preparing the verified update for Android.", installLabel: null };
    case "awaiting-approval":
      return { kind: "handoff", detail: "Review Android's installation prompt. If it closed, continue installation.", installLabel: "Continue install" };
    case "paused":
      return { kind: "recovery", title: `${title} download paused`, detail: "The transfer stopped. Retry starts it again from the beginning.", progress: { bytes: phase.bytes, total: phase.release.apkBytes }, actions: ["retry", "cancel", "hide"], dismissAction: "hide" };
    case "installed":
      return { kind: "recovery", title: `${title} installed`, detail: "Android confirmed the new app version.", progress: null, actions: ["hide"], dismissAction: "hide" };
    case "canceled":
      return { kind: "recovery", title: `${title} canceled`, detail: "You can start the download again.", progress: null, actions: ["retry", "hide"], dismissAction: "hide" };
    case "failed":
      return {
        kind: "recovery", title: `${title} could not finish`, detail: failureCopy(phase.code),
        progress: null, actions: phase.retry === "none" ? ["hide"] : ["retry", "hide"], dismissAction: "hide",
        failureDetail: phase.installerFailure
          ? `${phase.installerFailure.message} (Android status ${phase.installerFailure.status})`
          : null,
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
