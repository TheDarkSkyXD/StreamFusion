import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, Switch } from "react-native";

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
import {
  DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES,
} from "../domain/twitch-playlist-proxy-preferences";

type SourceDraft = {
  readonly id: string | null;
  readonly url: string;
  readonly addQueryParams: boolean;
};

const EMPTY_DRAFT: SourceDraft = { id: null, url: "", addQueryParams: true };

function sourceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `playlist-proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function TwitchPlaylistProxySettingsPanel({
  session,
}: {
  readonly session: TwitchPlaylistProxySession;
}) {
  const [view, setView] = useState<TwitchPlaylistProxyView | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  useEffect(() => {
    void session.load().then(setView);
  }, [session]);
  const preferences: TwitchPlaylistProxyPreferences = view
    ? { enabled: view.enabled, sources: view.sources }
    : DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES;

  const save = (next: TwitchPlaylistProxyPreferences) => {
    setBusy(true);
    void session
      .save(next)
      .then(setView)
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <TwitchPlaylistProxySettingsView
      busy={busy}
      draft={draft}
      draftError={draftError}
      onChangeDraft={setDraft}
      onCloseDraft={() => {
        setDraft(null);
        setDraftError(null);
      }}
      onRestoreDefaults={() => save(DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES)}
      onSaveDraft={() => {
        if (!draft) return;
        const url = draft.url.trim();
        if (!isTwitchPlaylistProxyTemplate(url)) {
          setDraftError("Use an HTTP(S) URL that includes $channel.");
          return;
        }
        if (draft.id) {
          save({
            ...preferences,
            sources: preferences.sources.map((source) =>
              source.id === draft.id
                ? { ...source, addQueryParams: draft.addQueryParams, url }
                : source,
            ),
          });
        } else {
          save({
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
          });
        }
        setDraft(null);
        setDraftError(null);
      }}
      onSavePreferences={save}
      onSetDraftError={setDraftError}
      preferences={preferences}
      view={view}
    />
  );
}

export function TwitchPlaylistProxySettingsView({
  busy,
  draft,
  draftError,
  onChangeDraft,
  onCloseDraft,
  onRestoreDefaults,
  onSaveDraft,
  onSavePreferences,
  onSetDraftError,
  preferences,
  view,
}: {
  readonly busy: boolean;
  readonly draft: SourceDraft | null;
  readonly draftError: string | null;
  readonly onChangeDraft: (draft: SourceDraft | null) => void;
  readonly onCloseDraft: () => void;
  readonly onRestoreDefaults: () => void;
  readonly onSaveDraft: () => void;
  readonly onSavePreferences: (next: TwitchPlaylistProxyPreferences) => void;
  readonly onSetDraftError: (error: string | null) => void;
  readonly preferences: TwitchPlaylistProxyPreferences;
  readonly view: TwitchPlaylistProxyView | null;
}) {
  return (
    <View style={styles.panel} testID="panel-twitch-playlist-proxy">
      <Text selectable style={styles.label}>
        TWITCH PLAYLIST PROXY
      </Text>
      <Text selectable style={styles.title} testID="twitch-playlist-proxy-title">
        {view?.title ?? "Reading playlist proxy."}
      </Text>
      <Text selectable style={styles.detail} testID="twitch-playlist-proxy-detail">
        {view?.detail ??
          "Routes live Twitch playlists through ordered $channel sources when enabled."}
      </Text>
      <Pressable
        accessibilityLabel={
          preferences.enabled
            ? "Disable Twitch playlist proxy"
            : "Enable Twitch playlist proxy"
        }
        accessibilityRole="switch"
        accessibilityState={{ busy, checked: preferences.enabled }}
        disabled={busy}
        onPress={() =>
          onSavePreferences({ ...preferences, enabled: !preferences.enabled })
        }
        style={styles.switchRow}
        testID="twitch-playlist-proxy-enabled"
      >
        <Text selectable style={styles.switchLabel}>
          {preferences.enabled ? "Playlist proxy on" : "Playlist proxy off"}
        </Text>
      </Pressable>
      <Text selectable style={styles.detail}>
        Sources are tried top to bottom. Direct Twitch is the final fallback.
        Custom strip and canary stay paused while this is on.
      </Text>
      {preferences.sources.length === 0 ? (
        <Text selectable style={styles.detail} testID="twitch-playlist-proxy-empty">
          No playlist proxy sources. Add a source or restore defaults.
        </Text>
      ) : (
        preferences.sources.map((source, index) => (
          <SourceRow
            busy={busy}
            key={source.id}
            onDelete={() =>
              onSavePreferences({
                ...preferences,
                sources: preferences.sources.filter(
                  (candidate) => candidate.id !== source.id,
                ),
              })
            }
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
                      sources: swapSources(preferences.sources, index, index + 1),
                    }),
                }
              : {})}
            {...(index > 0
              ? {
                  onMoveUp: () =>
                    onSavePreferences({
                      ...preferences,
                      sources: swapSources(preferences.sources, index, index - 1),
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
}: {
  readonly busy: boolean;
  readonly onDelete: () => void;
  readonly onEdit: () => void;
  readonly onMoveDown?: () => void;
  readonly onMoveUp?: () => void;
  readonly onToggle: () => void;
  readonly source: TwitchPlaylistProxySource;
}) {
  return (
    <View style={styles.sourceRow} testID={`twitch-playlist-proxy-source-${source.id}`}>
      <Text selectable style={styles.sourceUrl}>
        {source.url}
      </Text>
      <Text selectable style={styles.detail}>
        {source.enabled ? "Enabled" : "Disabled"}
        {source.addQueryParams ? " · playback query params" : ""}
      </Text>
      <View style={styles.sourceActions}>
        <Switch
          accessibilityLabel={source.enabled ? "Disable source" : "Enable source"}
          disabled={busy}
          onValueChange={() => onToggle()}
          testID={`twitch-playlist-proxy-toggle-${source.id}`}
          thumbColor={
            source.enabled ? mobileColors.textPrimary : mobileColors.textSecondary
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
        <Text selectable style={styles.error} testID="twitch-playlist-proxy-draft-error">
          {draftError}
        </Text>
      ) : null}
      <Pressable
        accessibilityLabel="Toggle playback query parameters"
        accessibilityRole="switch"
        accessibilityState={{ checked: draft.addQueryParams }}
        disabled={busy}
        onPress={() =>
          onChange({ ...draft, addQueryParams: !draft.addQueryParams })
        }
        style={styles.switchRow}
        testID="twitch-playlist-proxy-add-query-params"
      >
        <Text selectable style={styles.switchLabel}>
          {draft.addQueryParams
            ? "Playback query params on"
            : "Playback query params off"}
        </Text>
      </Pressable>
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
