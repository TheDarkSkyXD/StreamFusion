import { useEffect, useState } from "react";

import type {
  PredictionPreferencePatch,
  PredictionSettingsSession,
  PredictionSettingsView,
  PredictionStyle,
} from "../capabilities/prediction-settings";
import { defaultPredictionSettingsView } from "../domain/prediction-preferences";
import {
  SettingsCopy,
  SettingsSection,
  SettingsSelect,
} from "./settings-controls";

const STYLE_OPTIONS: readonly { value: PredictionStyle; label: string }[] = [
  { value: "native", label: "Native (per platform)" },
  { value: "unified", label: "Unified (StreamFusion)" },
];

export function PredictionsSettingsPanel({
  session,
}: {
  readonly session: PredictionSettingsSession;
}) {
  const [view, setView] = useState<PredictionSettingsView>(
    defaultPredictionSettingsView(),
  );
  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      setView(session.peek());
    });
    void session.load().then(setView);
    return unsubscribe;
  }, [session]);
  return (
    <PredictionsSettingsView
      onChange={(patch) => {
        void session.apply(patch).then(setView);
      }}
      view={view}
    />
  );
}

export function PredictionsSettingsView({
  onChange,
  view,
}: {
  readonly onChange: (patch: PredictionPreferencePatch) => void;
  readonly view: PredictionSettingsView;
}) {
  return (
    <SettingsSection testID="panel-predictions" title="PREDICTIONS">
      <SettingsCopy testID="prediction-disclosure" value={view.disclosure} />
      <SettingsSelect
        current={view.preferences.style}
        label="Style"
        onSelect={(style) => onChange({ style })}
        options={STYLE_OPTIONS}
        testID="prediction-style"
      />
      <SettingsCopy
        testID="prediction-style-detail"
        value={
          view.preferences.style === "native"
            ? "Native matches each platform UI (Twitch purple / Kick green-pink)."
            : "Unified uses StreamFusion storm accent on both platforms."
        }
      />
    </SettingsSection>
  );
}
