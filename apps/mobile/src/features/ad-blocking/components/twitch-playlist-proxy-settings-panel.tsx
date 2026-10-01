import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Switch,
} from "react-native";

import { SettingsSwitch } from "@mobile/features/settings/components/settings-controls";
import type { AdBlockSession } from "../capabilities/ad-blocking";
import type {
  PlaylistProxyHealth,
  PlaylistProxySourceStatus,
} from "../capabilities/playlist-proxy-health";
import { usePlaylistProxyStatuses } from "./use-playlist-proxy-statuses";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  TwitchPlaylistProxyPreferences,
  TwitchPlaylistProxySession,
  TwitchPlaylistProxySource,
  TwitchPlaylistProxyView,
} from "../capabilities/twitch-playlist-proxy";
import { isTwitchPlaylistProxyTemplate } from "../domain/twitch-playlist-proxy";
import { DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES } from "../domain/twitch-playlist-proxy-preferences";

type SourceDraft = {
  readonly id: string | null;
  readonly url: string;
  readonly addQueryParams: boolean;
};

const EMPTY_DRAFT: SourceDraft = { id: null, url: "", addQueryParams: true };
const NO_SOURCES: readonly TwitchPlaylistProxySource[] = [];

function sourceId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `playlist-proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function TwitchPlaylistProxySettingsPanel({
  session,
  customFiltering,
  health,
}: {
  readonly session: TwitchPlaylistProxySession;
  readonly customFiltering: AdBlockSession;
  readonly health: PlaylistProxyHealth;
}) {
  const [view, setView] = useState<TwitchPlaylistProxyView | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [deleteSource, setDeleteSource] =
    useState<TwitchPlaylistProxySource | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [customEnabled, setCustomEnabled] = useState(true);
  useEffect(() => {
    void Promise.all([session.load(), customFiltering.load()])
      .then(([proxy, custom]) => {
        setView(proxy);
        setCustomEnabled(custom.enabled);
      })
      .catch(() => setSaveError("Could not load playlist proxy settings."));
  }, [session, customFiltering]);
  const preferences: TwitchPlaylistProxyPreferences = view
    ? { enabled: view.enabled, sources: view.sources }
    : DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES;
  const { statuses, refresh } = usePlaylistProxyStatuses(
    view?.sources ?? NO_SOURCES,
    health,
  );

  const save = async (
    next: TwitchPlaylistProxyPreferences,
  ): Promise<boolean> => {
    setBusy(true);
    setSaveError(null);
    try {
      setView(await session.save(next));
      return true;
    } catch {
      setSaveError("Could not save playlist proxy settings. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <TwitchPlaylistProxySettingsView
      busy={busy || view === null}
      customEnabled={customEnabled}
      deleteSource={deleteSource}
      draft={draft}
      draftError={draftError}
      onChangeDraft={setDraft}
      onCloseDraft={() => {
        setDraft(null);
        setDraftError(null);
      }}
      onRestoreDefaults={() => {
        void save(DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES);
      }}
      onCancelDelete={() => setDeleteSource(null)}
      onConfirmDelete={() => {
        if (!deleteSource) return;
        void save({
          ...preferences,
          sources: preferences.sources.filter(
            (source) => source.id !== deleteSource.id,
          ),
        }).then((saved) => {
          if (saved) setDeleteSource(null);
        });
      }}
      onRequestDelete={setDeleteSource}
      onRefreshStatuses={refresh}
      onSaveDraft={() => {
        if (!draft) return;
        const url = draft.url.trim();
        if (!isTwitchPlaylistProxyTemplate(url)) {
          setDraftError("Use an HTTP(S) URL that includes $channel.");
          return;
        }
        if (draft.id) {
          void save({
            ...preferences,
            sources: preferences.sources.map((source) =>
              source.id === draft.id
                ? { ...source, addQueryParams: draft.addQueryParams, url }
                : source,
            ),
          }).then((saved) => {
            if (saved) {
              setDraft(null);
              setDraftError(null);
            }
          });
        } else {
          void save({
            ...preferences,
            sources: [
              ...preferences.sources,
              {
                addQueryParams: draft.addQueryParams,
                enabled: true,
                id: sourceId(),
                url,
              },
            ],
          }).then((saved) => {
            if (saved) {
              setDraft(null);
              setDraftError(null);
            }
          });
        }
      }}
      onSavePreferences={(next) => {
        void save(next);
      }}
      onSetDraftError={setDraftError}
      preferences={preferences}
      saveError={saveError}
      statuses={statuses}
      view={view}
    />
  );
}

export function TwitchPlaylistProxySettingsView({
  busy,
  customEnabled = false,
  deleteSource = null,
  draft,
  draftError,
  onChangeDraft,
  onCloseDraft,
  onRestoreDefaults,
  onCancelDelete,
  onConfirmDelete,
  onRequestDelete,
  onRefreshStatuses,
  onSaveDraft,
  onSavePreferences,
  onSetDraftError,
  preferences,
  saveError,
  statuses = {},
  view,
}: {
  readonly busy: boolean;
  readonly customEnabled?: boolean;
  readonly deleteSource?: TwitchPlaylistProxySource | null;
  readonly draft: SourceDraft | null;
  readonly draftError: string | null;
  readonly onChangeDraft: (draft: SourceDraft | null) => void;
  readonly onCloseDraft: () => void;
  readonly onRestoreDefaults: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onRequestDelete: (source: TwitchPlaylistProxySource) => void;
  readonly onRefreshStatuses: () => void;
  readonly onSaveDraft: () => void;
  readonly onSavePreferences: (next: TwitchPlaylistProxyPreferences) => void;
  readonly onSetDraftError: (error: string | null) => void;
  readonly preferences: TwitchPlaylistProxyPreferences;
  readonly saveError?: string | null;
  readonly statuses?: Readonly<Record<string, PlaylistProxySourceStatus>>;
  readonly view: TwitchPlaylistProxyView | null;
}) {
  return (
    <View style={styles.panel} testID="panel-twitch-playlist-proxy">
      <Text selectable style={styles.label}>
        TWITCH PLAYLIST PROXY
      </Text>
      <Text
        selectable
        style={styles.title}
        testID="twitch-playlist-proxy-title"
      >
        {view?.title ?? "Reading playlist proxy."}
      </Text>
      <Text
        selectable
        style={styles.detail}
        testID="twitch-playlist-proxy-detail"
      >
        {view?.detail ??
          "Routes live Twitch playlists through ordered $channel sources when enabled."}
      </Text>
      <SettingsSwitch
        checked={preferences.enabled}
        disabled={busy || customEnabled}
        label="Playlist proxy"
        onToggle={() =>
          onSavePreferences({ ...preferences, enabled: !preferences.enabled })
        }
        testID="twitch-playlist-proxy-enabled"
      />
      {customEnabled ? (
        <Text
          selectable
          style={styles.detail}
          testID="twitch-playlist-proxy-locked"
        >
          Turn off Custom Twitch ad blocker to use the playlist proxy.
        </Text>
      ) : null}
      {saveError ? (
        <Text
          selectable
          style={styles.error}
          testID="twitch-playlist-proxy-save-error"
        >
          {saveError}
        </Text>
      ) : null}
      <Text selectable style={styles.detail}>
        Sources are tried top to bottom. Direct Twitch is the final fallback.
      </Text>
      <Pressable
        accessibilityLabel="Refresh source status"
        accessibilityRole="button"
        disabled={busy}
        onPress={onRefreshStatuses}
        style={styles.switchRow}
        testID="twitch-playlist-proxy-refresh"
      >
        <Text selectable style={styles.switchLabel}>
          Refresh status
        </Text>
      </Pressable>
      {preferences.sources.length === 0 ? (
        <Text
          selectable
          style={styles.detail}
          testID="twitch-playlist-proxy-empty"
        >
          No playlist proxy sources. Add a source or restore defaults.
        </Text>
      ) : (
        preferences.sources.map((source, index) => (
          <SourceRow
            busy={busy}
            key={source.id}
            onDelete={() => onRequestDelete(source)}
            status={statuses[source.id] ?? "checking"}
            onEdit={() => {
              onSetDraftError(null);
              onChangeDraft({
                addQueryParams: source.addQueryParams,
                id: source.id,
                url: source.url,
              });
            }}
            {...(index < preferences.sources.length - 1
              ? {
                  onMoveDown: () =>
                    onSavePreferences({
                      ...preferences,
                      sources: swapSources(
                        preferences.sources,
                        index,
                        index + 1,
                      ),
                    }),
                }
              : {})}
            {...(index > 0
              ? {
                  onMoveUp: () =>
                    onSavePreferences({
                      ...preferences,
                      sources: swapSources(
                        preferences.sources,
                        index,
                        index - 1,
                      ),
                    }),
                }
              : {})}
            onToggle={() =>
              onSavePreferences({
                ...preferences,
                sources: preferences.sources.map((candidate) =>
                  candidate.id === source.id
                    ? { ...candidate, enabled: !candidate.enabled }
                    : candidate,
                ),
              })
            }
            source={source}
          />
        ))
      )}
      <Pressable
        accessibilityLabel="Add playlist source"
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          onSetDraftError(null);
          onChangeDraft(EMPTY_DRAFT);
        }}
        style={styles.switchRow}
        testID="twitch-playlist-proxy-add"
      >
        <Text selectable style={styles.switchLabel}>
          Add source
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Restore playlist proxy defaults"
        accessibilityRole="button"
        disabled={busy}
        onPress={onRestoreDefaults}
        style={styles.switchRow}
        testID="twitch-playlist-proxy-restore"
      >
        <Text selectable style={styles.switchLabel}>
          Restore defaults
        </Text>
      </Pressable>
      {draft ? (
        <SourceDraftEditor
          busy={busy}
          draft={draft}
          draftError={draftError}
          onChange={onChangeDraft}
          onClose={onCloseDraft}
          onSave={onSaveDraft}
        />
      ) : null}
      {deleteSource ? (
        <View
          style={styles.draft}
          testID="twitch-playlist-proxy-delete-confirmation"
        >
          <Text selectable style={styles.title}>
            Delete playlist source?
          </Text>
          <Text selectable style={styles.detail}>
            {deleteSource.url} will no longer be tried during Twitch playback.
          </Text>
          <Pressable
            accessibilityLabel="Confirm delete playlist source"
            accessibilityRole="button"
            onPress={onConfirmDelete}
            style={styles.switchRow}
            testID="twitch-playlist-proxy-confirm-delete"
          >
            <Text selectable style={styles.switchLabel}>
              Delete source
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Cancel deleting playlist source"
            accessibilityRole="button"
            onPress={onCancelDelete}
            style={styles.switchRow}
            testID="twitch-playlist-proxy-cancel-delete"
          >
            <Text selectable style={styles.switchLabel}>
              Cancel
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SourceRow({
  busy,
  onDelete,
  onEdit,
  onMoveDown,
  onMoveUp,
  onToggle,
  source,
  status,
}: {
  readonly busy: boolean;
  readonly onDelete: () => void;
  readonly onEdit: () => void;
  readonly onMoveDown?: () => void;
  readonly onMoveUp?: () => void;
  readonly onToggle: () => void;
  readonly source: TwitchPlaylistProxySource;
  readonly status: PlaylistProxySourceStatus;
}) {
  return (
    <View
      style={styles.sourceRow}
      testID={`twitch-playlist-proxy-source-${source.id}`}
    >
      <Text selectable style={styles.sourceUrl}>
        {source.url}
      </Text>
      <View style={styles.statusRow}>
        <View style={styles.statusPair}>
          <View
            accessibilityElementsHidden
            style={[
              styles.statusDot,
              status === "online"
                ? styles.statusOnline
                : status === "offline"
                  ? styles.statusOffline
                  : styles.statusChecking,
            ]}
            testID={`twitch-playlist-proxy-status-${source.id}`}
          />
          <Text selectable style={styles.detail}>
            {status === "checking"
              ? "Checking"
              : status === "online"
                ? "Online"
                : "Offline"}
          </Text>
        </View>
        {source.addQueryParams ? (
          <Text selectable style={styles.detail}>· playback query params</Text>
        ) : null}
      </View>
      <View style={styles.sourceActions}>
        <Switch
          accessibilityLabel={
            source.enabled ? "Disable source" : "Enable source"
          }
          disabled={busy}
          onValueChange={() => onToggle()}
          testID={`twitch-playlist-proxy-toggle-${source.id}`}
          thumbColor={
            source.enabled
              ? mobileColors.textPrimary
              : mobileColors.textSecondary
          }
          trackColor={{
            false: mobileColors.border,
            true: mobileColors.twitchBright,
          }}
          value={source.enabled}
        />
        {onMoveUp ? (
          <Pressable
            accessibilityLabel="Move source up"
            accessibilityRole="button"
            disabled={busy}
            onPress={onMoveUp}
            style={styles.actionButton}
            testID={`twitch-playlist-proxy-up-${source.id}`}
          >
            <Text selectable style={styles.actionLabel}>
              Up
            </Text>
          </Pressable>
        ) : null}
        {onMoveDown ? (
          <Pressable
            accessibilityLabel="Move source down"
            accessibilityRole="button"
            disabled={busy}
            onPress={onMoveDown}
            style={styles.actionButton}
            testID={`twitch-playlist-proxy-down-${source.id}`}
          >
            <Text selectable style={styles.actionLabel}>
              Down
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel="Edit source"
          accessibilityRole="button"
          disabled={busy}
          onPress={onEdit}
          style={styles.actionButton}
          testID={`twitch-playlist-proxy-edit-${source.id}`}
        >
          <Text selectable style={styles.actionLabel}>
            Edit
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Delete source"
          accessibilityRole="button"
          disabled={busy}
          onPress={onDelete}
          style={styles.actionButton}
          testID={`twitch-playlist-proxy-delete-${source.id}`}
        >
          <Text selectable style={styles.actionLabel}>
            Delete
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SourceDraftEditor({
  busy,
  draft,
  draftError,
  onChange,
  onClose,
  onSave,
}: {
  readonly busy: boolean;
  readonly draft: SourceDraft;
  readonly draftError: string | null;
  readonly onChange: (draft: SourceDraft) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
}) {
  return (
    <View style={styles.draft} testID="twitch-playlist-proxy-draft">
      <Text selectable style={styles.title}>
        {draft.id ? "Edit playlist source" : "Add playlist source"}
      </Text>
      <Text selectable style={styles.detail}>
        Include $channel where the Twitch channel name belongs.
      </Text>
      <TextInput
        accessibilityLabel="Playlist URL"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(url) => onChange({ ...draft, url })}
        placeholder="https://example.com/live/$channel"
        placeholderTextColor={mobileColors.textSecondary}
        style={styles.input}
        testID="twitch-playlist-proxy-url"
        value={draft.url}
      />
      {draftError ? (
        <Text
          selectable
          style={styles.error}
          testID="twitch-playlist-proxy-draft-error"
        >
          {draftError}
        </Text>
      ) : null}
      <SettingsSwitch
        checked={draft.addQueryParams}
        disabled={busy}
        label="Playback query params"
        onToggle={() =>
          onChange({ ...draft, addQueryParams: !draft.addQueryParams })
        }
        testID="twitch-playlist-proxy-add-query-params"
      />
      <Pressable
        accessibilityLabel="Save playlist source"
        accessibilityRole="button"
        disabled={busy}
        onPress={onSave}
        style={styles.switchRow}
        testID="twitch-playlist-proxy-save-draft"
      >
        <Text selectable style={styles.switchLabel}>
          {draft.id ? "Save source" : "Add source"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Cancel playlist source edit"
        accessibilityRole="button"
        disabled={busy}
        onPress={onClose}
        style={styles.switchRow}
        testID="twitch-playlist-proxy-cancel-draft"
      >
        <Text selectable style={styles.switchLabel}>
          Cancel
        </Text>
      </Pressable>
    </View>
  );
}

function swapSources(
  sources: readonly TwitchPlaylistProxySource[],
  from: number,
  to: number,
): TwitchPlaylistProxySource[] {
  const next = [...sources];
  const temp = next[from]!;
  next[from] = next[to]!;
  next[to] = temp;
  return next;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  label: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  detail: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
  switchRow: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  switchLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  sourceRow: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    gap: mobileSpacing.xSmall,
    padding: mobileSpacing.small,
  },
  sourceUrl: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  sourceActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  statusDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  statusPair: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
  },
  statusOnline: { backgroundColor: "#34d399" },
  statusOffline: { backgroundColor: mobileColors.danger },
  statusChecking: { backgroundColor: mobileColors.textSecondary },
  actionButton: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  draft: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    gap: mobileSpacing.small,
    padding: mobileSpacing.small,
  },
  input: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    color: mobileColors.textPrimary,
    fontSize: 16,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  error: {
    color: mobileColors.danger,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
});
