import { useEffect, useState } from "react";

import type { SettingsSession, SettingsView } from "../capabilities/settings";
import { defaultSettingsView } from "../domain/settings-view";

export function useSettingsSession(session: SettingsSession): {
  readonly ready: boolean;
  readonly view: SettingsView;
} {
  const [view, setView] = useState<SettingsView>(defaultSettingsView);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      setView(session.peek());
    });
    void session.load().then((next) => {
      setView(next);
      setReady(true);
    });
    return unsubscribe;
  }, [session]);
  return { ready, view };
}
