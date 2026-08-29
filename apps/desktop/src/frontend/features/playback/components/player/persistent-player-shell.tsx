import type React from "react";
import { createContext, useCallback, useContext, useState } from "react";

import type { PlayerError } from "./types";

export interface DockedLivePlayerConfig {
  muted: boolean;
  isTheater: boolean;
  startedAt?: string | null;
  poster?: string;
  onError: (error: PlayerError) => boolean | void;
  onCleanPresentedFrame?: () => void;
  onRefresh: () => void;
  onToggleTheater: () => void;
}

type RegisterDockedConfig = (config: DockedLivePlayerConfig) => () => void;

const PersistentPlayerRegistrationContext = createContext<RegisterDockedConfig | null>(null);
const DockedPlayerConfigContext = createContext<DockedLivePlayerConfig | null>(null);

export function PersistentPlayerShell({ children }: { children: React.ReactNode }) {
  const [registration, setRegistration] = useState<{
    id: symbol;
    config: DockedLivePlayerConfig;
  } | null>(null);
  const registerDockedConfig = useCallback((config: DockedLivePlayerConfig) => {
    const id = Symbol("docked-live-player");
    setRegistration({ id, config });
    return () => {
      setRegistration((current) => (current?.id === id ? null : current));
    };
  }, []);

  return (
    <PersistentPlayerRegistrationContext.Provider value={registerDockedConfig}>
      <DockedPlayerConfigContext.Provider value={registration?.config ?? null}>
        {children}
      </DockedPlayerConfigContext.Provider>
    </PersistentPlayerRegistrationContext.Provider>
  );
}

export function useDockedPlayerConfig(): DockedLivePlayerConfig | null {
  return useContext(DockedPlayerConfigContext);
}

export function useRegisterDockedPlayerConfig(): RegisterDockedConfig | null {
  return useContext(PersistentPlayerRegistrationContext);
}
