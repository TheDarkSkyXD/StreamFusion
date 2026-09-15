import {
  DENSITY_OPTIONS,
  SEEK_INTERVAL_OPTIONS,
  THEME_OPTIONS,
  VIDEO_QUALITY_OPTIONS,
  type PreferencePatch,
} from "@streamfusion/core/settings";

import type { SettingsView } from "../capabilities/settings";
import {
  SettingsChoiceRow,
  SettingsCopy,
  SettingsSection,
  SettingsSwitch,
} from "./settings-controls";

type SettingsPanelProps = {
  readonly onChange: (patch: PreferencePatch) => void;
  readonly view: SettingsView;
};

const PLAYER_CHROME_TOGGLES = [
  { field: "showQuality", label: "Quality control", testID: "control-0" },
  { field: "showSpeed", label: "Speed control", testID: "control-1" },
  { field: "showVolume", label: "Volume control", testID: "control-2" },
  { field: "showFullscreen", label: "Fullscreen control", testID: "control-3" },
  { field: "showTheater", label: "Theater control", testID: "control-4" },
  { field: "showVideoStats", label: "Video stats control", testID: "control-5" },
] as const;

export function AppearanceSettingsPanel({ onChange, view }: SettingsPanelProps) {
  return (
    <SettingsSection testID="panel-appearance" title="APPEARANCE">
      <AppearanceLookRows onChange={onChange} view={view} />
      <AppearanceSessionRows onChange={onChange} view={view} />
    </SettingsSection>
  );
}

function AppearanceLookRows({ onChange, view }: SettingsPanelProps) {
  const prefs = view.preferences;
  return (
    <>
      <SettingsChoiceRow
        current={prefs.theme}
        label="Theme"
        onSelect={(theme) => onChange({ theme })}
        options={THEME_OPTIONS}
        testID="theme"
      />
      <SettingsChoiceRow
        current={prefs.density}
        label="Density"
        onSelect={(density) => onChange({ density })}
        options={DENSITY_OPTIONS}
        testID="density"
      />
      <SettingsChoiceRow
        current={prefs.language}
        label="Language"
        onSelect={(language) => onChange({ language })}
        options={["en"]}
        testID="language"
      />
      <SettingsCopy testID="language-effective" value={view.effective.language} />
    </>
  );
}

function AppearanceSessionRows({ onChange, view }: SettingsPanelProps) {
  const prefs = view.preferences;
  return (
    <>
      <PreferenceSwitch
        checked={prefs.restoreSession}
        copy={view.effective.restoreSession}
        label="Restore session"
        onToggle={() => onChange({ restoreSession: !prefs.restoreSession })}
        testID="restore-session"
      />
      <PreferenceSwitch
        checked={prefs.resumePlayback}
        copy={view.effective.resumePlayback}
        label="Resume playback"
        onToggle={() => onChange({ resumePlayback: !prefs.resumePlayback })}
        testID="resume-playback"
      />
    </>
  );
}

export function PlaybackSettingsPanel({ onChange, view }: SettingsPanelProps) {
  return (
    <SettingsSection testID="panel-playback" title="PLAYBACK">
      <PlaybackQualityRows onChange={onChange} view={view} />
      <PlaybackCodecRows onChange={onChange} view={view} />
    </SettingsSection>
  );
}

function PlaybackQualityRows({ onChange, view }: SettingsPanelProps) {
  const prefs = view.preferences;
  return (
    <>
      <SettingsChoiceRow
        current={prefs.quality}
        label="Default quality"
        onSelect={(quality) => onChange({ quality })}
        options={VIDEO_QUALITY_OPTIONS}
        testID="quality"
      />
      <SettingsChoiceRow
        current={prefs.carouselSeconds}
        label="Carousel seconds"
        onSelect={(carouselSeconds) => onChange({ carouselSeconds })}
        options={[15, 30, 60, 120]}
        testID="carousel"
      />
      <SettingsCopy testID="carousel-effective" value={view.effective.carousel} />
      <PreferenceSwitch
        checked={prefs.captionsEnabled}
        copy={view.effective.captions}
        label="Local captions"
        onToggle={() => onChange({ captionsEnabled: !prefs.captionsEnabled })}
        testID="captions"
      />
    </>
  );
}

function PlaybackCodecRows({ onChange, view }: SettingsPanelProps) {
  const prefs = view.preferences;
  return (
    <>
      <SettingsChoiceRow
        current={prefs.tokenPlayer}
        label="Token player"
        onSelect={(tokenPlayer) => onChange({ tokenPlayer })}
        options={["native-exoplayer"]}
        testID="token-player"
      />
      <SettingsCopy testID="token-player-effective" value={view.effective.tokenPlayer} />
      <PreferenceSwitch
        checked={prefs.allowHevc}
        copy={view.effective.hevc}
        label="Allow HEVC"
        onToggle={() => onChange({ allowHevc: !prefs.allowHevc })}
        testID="hevc"
      />
      <SettingsCopy
        testID="stream-device-id"
        value={`Stream device id: ${view.streamDeviceId}`}
      />
    </>
  );
}

export function PlayerControlsSettingsPanel({ onChange, view }: SettingsPanelProps) {
  const prefs = view.preferences;
  return (
    <SettingsSection testID="panel-player-controls" title="PLAYER CONTROLS">
      {PLAYER_CHROME_TOGGLES.map((toggle) => (
        <SettingsSwitch
          checked={prefs[toggle.field]}
          key={toggle.testID}
          label={toggle.label}
          onToggle={() => onChange({ [toggle.field]: !prefs[toggle.field] })}
          testID={toggle.testID}
        />
      ))}
      <SettingsCopy testID="player-chrome-effective" value={view.effective.playerChrome} />
      <SettingsChoiceRow
        current={prefs.rewindSeconds}
        label="Rewind seconds"
        onSelect={(rewindSeconds) => onChange({ rewindSeconds })}
        options={SEEK_INTERVAL_OPTIONS}
        testID="rewind"
      />
      <SettingsChoiceRow
        current={prefs.fastForwardSeconds}
        label="Fast-forward seconds"
        onSelect={(fastForwardSeconds) => onChange({ fastForwardSeconds })}
        options={SEEK_INTERVAL_OPTIONS}
        testID="fast-forward"
      />
    </SettingsSection>
  );
}

export function BufferSettingsPanel({ onChange, view }: SettingsPanelProps) {
  const prefs = view.preferences;
  return (
    <SettingsSection testID="panel-buffer" title="BUFFER">
      <SettingsSwitch
        checked={prefs.lowLatencyMode}
        label="Low latency"
        onToggle={() => onChange({ lowLatencyMode: !prefs.lowLatencyMode })}
        testID="low-latency"
      />
      <SettingsChoiceRow
        current={prefs.liveSyncDurationCount}
        label="Target live segments"
        onSelect={(liveSyncDurationCount) => onChange({ liveSyncDurationCount })}
        options={[2, 3, 4, 6, 8]}
        testID="target-latency"
      />
      <SettingsChoiceRow
        current={prefs.forwardBufferSec}
        label="Forward buffer seconds"
        onSelect={(forwardBufferSec) => onChange({ forwardBufferSec })}
        options={[8, 15, 30, 45]}
        testID="forward-buffer"
      />
      <SettingsChoiceRow
        current={prefs.maxBufferSec}
        label="Max buffer seconds"
        onSelect={(maxBufferSec) => onChange({ maxBufferSec })}
        options={[15, 30, 45, 60]}
        testID="max-buffer"
      />
      <SettingsCopy testID="buffer-effective" value={view.effective.buffer} />
    </SettingsSection>
  );
}

export function MultiviewSettingsPanel({ onChange, view }: SettingsPanelProps) {
  const prefs = view.preferences;
  return (
    <SettingsSection testID="panel-multiview" title="MULTIVIEW">
      <SettingsChoiceRow
        current={prefs.multiviewCap}
        label="Slot cap"
        onSelect={(multiviewCap) => onChange({ multiviewCap })}
        options={[1, 2, 3, 4, 5, 6]}
        testID="multiview-cap"
      />
      <SettingsCopy testID="multiview-cap-effective" value={view.effective.multiviewCap} />
      <SettingsChoiceRow
        current={prefs.backgroundQuality}
        label="Background quality"
        onSelect={(backgroundQuality) => onChange({ backgroundQuality })}
        options={VIDEO_QUALITY_OPTIONS}
        testID="background-quality"
      />
      <SettingsCopy
        testID="background-quality-effective"
        value={view.effective.backgroundQuality}
      />
    </SettingsSection>
  );
}

function PreferenceSwitch({
  checked,
  copy,
  label,
  onToggle,
  testID,
}: {
  readonly checked: boolean;
  readonly copy: string;
  readonly label: string;
  readonly onToggle: () => void;
  readonly testID: string;
}) {
  return (
    <>
      <SettingsSwitch
        checked={checked}
        label={label}
        onToggle={onToggle}
        testID={testID}
      />
      <SettingsCopy testID={`${testID}-effective`} value={copy} />
    </>
  );
}
