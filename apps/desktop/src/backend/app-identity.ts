export const WINDOWS_APP_USER_MODEL_ID = "com.streamfusion.app";

interface AppIdentityEnvironment {
  platform: NodeJS.Platform;
  isPackaged: boolean;
}

interface AppIdentityTarget {
  setAppUserModelId(appId: string): void;
}

interface WindowIdentityTarget {
  setIcon(icon: string): void;
  setAppDetails(options: {
    appId: string;
    appIconPath: string;
    appIconIndex: number;
  }): void;
}

/** Keep the development executable and packaged executable under one identity on Windows. */
export function configureAppIdentity(
  electronApp: AppIdentityTarget,
  environment: AppIdentityEnvironment
): void {
  if (environment.platform === "win32" && environment.isPackaged) {
    electronApp.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
  }
}

/** Give the Windows taskbar button StreamFusion artwork even in Electron development launches. */
export function configureWindowIdentity(
  window: WindowIdentityTarget,
  iconPath: string,
  environment: AppIdentityEnvironment
): void {
  if (environment.platform === "win32") {
    window.setIcon(iconPath);
  }

  if (environment.platform === "win32" && environment.isPackaged) {
    window.setAppDetails({
      appId: WINDOWS_APP_USER_MODEL_ID,
      appIconPath: iconPath,
      appIconIndex: 0,
    });
  }
}
