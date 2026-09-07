export const WINDOWS_APP_USER_MODEL_ID = "com.streamfusion.app";
const WINDOWS_DEVELOPMENT_APP_USER_MODEL_ID = `${WINDOWS_APP_USER_MODEL_ID}.dev`;

interface AppIdentityEnvironment {
  platform: NodeJS.Platform;
  isPackaged: boolean;
}

interface AppIdentityTarget {
  setAppUserModelId(appId: string): void;
}

interface WindowIdentityTarget {
  setIcon(icon: string): void;
  setAppDetails(options: { appId: string; appIconPath: string; appIconIndex: number }): void;
}

export function configureAppIdentity(
  electronApp: AppIdentityTarget,
  environment: AppIdentityEnvironment
): void {
  if (environment.platform === "win32") {
    electronApp.setAppUserModelId(
      environment.isPackaged ? WINDOWS_APP_USER_MODEL_ID : WINDOWS_DEVELOPMENT_APP_USER_MODEL_ID
    );
  }
}

/** Give the Windows taskbar button StreamFusion artwork even in Electron development launches. */
export function configureWindowIdentity(
  window: WindowIdentityTarget,
  iconPath: string,
  environment: AppIdentityEnvironment & { executablePath: string }
): void {
  if (environment.platform === "win32") {
    window.setIcon(iconPath);
    window.setAppDetails({
      appId: environment.isPackaged
        ? WINDOWS_APP_USER_MODEL_ID
        : WINDOWS_DEVELOPMENT_APP_USER_MODEL_ID,
      // Windows Shell cannot load icon resources through Electron's virtual ASAR filesystem.
      appIconPath: environment.isPackaged ? environment.executablePath : iconPath,
      appIconIndex: 0,
    });
  }
}
