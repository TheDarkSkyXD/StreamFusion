import { useTranslation } from "react-i18next";

import {
  CAROUSEL_INTERVAL_MAX_SEC,
  CAROUSEL_INTERVAL_MIN_SEC,
  CAROUSEL_INTERVAL_STEP_SEC,
  DENSITY_OPTIONS,
  SEEK_INTERVAL_OPTIONS,
  VIDEO_QUALITY_OPTIONS,
  type PreferencePatch,
} from "@streamfusion/core/settings";

import type { SettingsView } from "../capabilities/settings";
import {
  SettingsCopy,
  SettingsLanguagePicker,
  SettingsSection,
  SettingsSelect,
  SettingsSlider,
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
  const { t } = useTranslation();
  return (
    <SettingsSection testID="panel-appearance" title={t("settings.general").toUpperCase()}>
      <AppearanceLookRows onChange={onChange} view={view} />
      <AppearanceSessionRows onChange={onChange} view={view} />
    </SettingsSection>
  );
}

function AppearanceLookRows({ onChange, view }: SettingsPanelProps) {
  const { t } = useTranslation();
  const prefs = view.preferences;
  return (
    <>
      <SettingsCopy testID="theme" value={view.effective.theme} />
      <SettingsSelect
        current={prefs.density}
        label={t("settings.density")}
        onSelect={(density) => onChange({ density })}
        options={DENSITY_OPTIONS.map((value) => ({
          label: capitalize(value),
          value,
        }))}
        testID="density"
      />
      <SettingsLanguagePicker
        current={prefs.language}
        label={t("settings.displayLanguage")}
        onSelect={(language) => onChange({ language })}
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
  const { t } = useTranslation();
  const prefs = view.preferences;
  return (
    <>
      <SettingsSelect
        current={prefs.quality}
        detail={t("settings.preferredStreamQualityWhenAvailable")}
        label={t("settings.defaultQuality")}
        onSelect={(quality) => onChange({ quality })}
        options={VIDEO_QUALITY_OPTIONS.map((value) => ({
          label: qualityLabel(t, value),
          value,
        }))}
        testID="quality"
      />
      <SettingsSlider
        detail="How long each home featured stream stays active before rotating."
        formatValue={(seconds) => `${seconds}s`}
        label="Featured carousel timing"
        max={CAROUSEL_INTERVAL_MAX_SEC}
        min={CAROUSEL_INTERVAL_MIN_SEC}
        onValueChange={(carouselSeconds) => onChange({ carouselSeconds })}
        step={CAROUSEL_INTERVAL_STEP_SEC}
        testID="carousel"
        value={prefs.carouselSeconds}
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
  const { t } = useTranslation();
  const prefs = view.preferences;
  return (
    <>
      <SettingsSelect
        current={prefs.tokenPlayer}
        detail={t("settings.playerTypeUsedWhenRequestingTheAdBlockStreamTokenLeaveOnDefaultU")}
        label={t("settings.accessTokenPlayerType")}
        onSelect={(tokenPlayer) => onChange({ tokenPlayer })}
        options={[
          {
            label: "native-exoplayer",
            value: "native-exoplayer" as const,
          },
        ]}
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
  const { t } = useTranslation();
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
      <SettingsSelect
        current={prefs.rewindSeconds}
        label={t("settings.rewind")}
        onSelect={(rewindSeconds) => onChange({ rewindSeconds })}
        options={SEEK_INTERVAL_OPTIONS.map((seconds) => ({
          label: `${seconds} ${t("settings.seconds")}`,
          value: seconds,
        }))}
        testID="rewind"
      />
      <SettingsSelect
        current={prefs.fastForwardSeconds}
        label={t("settings.fastForward")}
        onSelect={(fastForwardSeconds) => onChange({ fastForwardSeconds })}
        options={SEEK_INTERVAL_OPTIONS.map((seconds) => ({
          label: `${seconds} ${t("settings.seconds")}`,
          value: seconds,
        }))}
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
      <SettingsSlider
        detail="Segments from the live edge. Lower stays closer to live but is less stable."
        formatValue={(count) => `${count} seg`}
        label="Target live latency"
        max={10}
        min={1}
        onValueChange={(liveSyncDurationCount) =>
          onChange({ liveSyncDurationCount })
        }
        step={1}
        testID="target-latency"
        value={prefs.liveSyncDurationCount}
      />
      <SettingsSlider
        detail="Seconds of video buffered ahead. Higher resists stalls but adds latency."
        formatValue={(seconds) => `${seconds} s`}
        label="Forward buffer"
        max={60}
        min={5}
        onValueChange={(forwardBufferSec) => onChange({ forwardBufferSec })}
        step={1}
        testID="forward-buffer"
        value={prefs.forwardBufferSec}
      />
      <SettingsSlider
        detail="Hard cap on buffered seconds. The byte budget scales with this value."
        formatValue={(seconds) => `${seconds} s`}
        label="Max buffer"
        max={120}
        min={10}
        onValueChange={(maxBufferSec) => onChange({ maxBufferSec })}
        step={5}
        testID="max-buffer"
        value={prefs.maxBufferSec}
      />
      <SettingsCopy testID="buffer-effective" value={view.effective.buffer} />
    </SettingsSection>
  );
}

export function MultiviewSettingsPanel({ onChange, view }: SettingsPanelProps) {
  const { t } = useTranslation();
  const prefs = view.preferences;
  return (
    <SettingsSection testID="panel-multiview" title="MULTIVIEW">
      <SettingsSelect
        current={prefs.multiviewCap}
        label="Slot cap"
        onSelect={(multiviewCap) => onChange({ multiviewCap })}
        options={[1, 2, 3, 4, 5, 6].map((value) => ({
          label: String(value),
          value,
        }))}
        testID="multiview-cap"
      />
      <SettingsCopy testID="multiview-cap-effective" value={view.effective.multiviewCap} />
      <SettingsSelect
        current={prefs.backgroundQuality}
        detail={t("settings.howNonFocusedStreamsRenderLowerSettingsFreeUpRamAndBandwidthSoTh")}
        label={t("settings.backgroundStreamQuality")}
        onSelect={(backgroundQuality) => onChange({ backgroundQuality })}
        options={VIDEO_QUALITY_OPTIONS.map((value) => ({
          label: qualityLabel(t, value),
          value,
        }))}
        testID="background-quality"
      />
      <SettingsCopy
        testID="background-quality-effective"
        value={view.effective.backgroundQuality}
      />
    </SettingsSection>
  );
}


function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function qualityLabel(
  t: (key: string) => string,
  value: (typeof VIDEO_QUALITY_OPTIONS)[number],
): string {
  switch (value) {
    case "auto":
      return t("settings.auto");
    case "highest":
      return t("settings.highest");
    case "1440p":
    case "2k":
      return t("settings.value1440p2k");
    case "1080p":
      return t("settings.value1080p60");
    case "720p":
      return t("settings.value720p60");
    case "480p":
      return t("settings.value480p");
    case "360p":
      return t("settings.value360p");
    case "160p":
      return t("settings.value160p");
    default:
      return value;
  }
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
