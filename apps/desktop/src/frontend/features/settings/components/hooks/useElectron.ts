import { useCallback, useEffect, useState } from "react";
import type { VersionInfo } from "@shared/ipc-channels";
import { getDesktopControls } from "../../composition/settings-services";
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getDesktopControls()?.getVersion().then(setVersion);
  }, []);

  return version;
}

export function useAppVersionInfo(): VersionInfo | null {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    getDesktopControls()?.getVersionInfo?.().then(setVersionInfo);
  }, []);

  return versionInfo;
}

export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const controls = getDesktopControls();
    if (!controls) return;
    controls.isMaximized().then(setIsMaximized);
    const unsubscribe = controls.onMaximizeChange(setIsMaximized);
    return unsubscribe;
  }, []);

  const minimize = useCallback(() => {
    getDesktopControls()?.minimizeWindow();
  }, []);

  const maximize = useCallback(() => {
    getDesktopControls()?.maximizeWindow();
  }, []);

  const close = useCallback(() => {
    getDesktopControls()?.closeWindow();
  }, []);

  return {
    isMaximized,
    minimize,
    maximize,
    close,
  };
}

export function useOpenExternal() {
  return useCallback((url: string) => {
    getDesktopControls()?.openExternal(url);
  }, []);
}
