import { useCallback, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LuGripVertical, LuPencil, LuPlus, LuRefreshCw, LuTrash2 } from "react-icons/lu";

import { Button } from "@/components/ui/button";
import { translateSettings } from "@/features/settings/utils/settings-translation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  isTwitchPlaylistProxyTemplate,
  moveTwitchPlaylistProxySource,
} from "@/features/playback/utils/twitch-playlist-proxy";
import { useTwitchPlaylistProxyStatuses } from "@/features/settings/data/use-twitch-playlist-proxy-statuses";
import { useAuthStore } from "@/store/auth-store";
import {
  DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES,
  type TwitchPlaylistProxySource,
} from "@shared/auth-types";

interface SourceDraft {
  id: string | null;
  url: string;
  addQueryParams: boolean;
}

const EMPTY_DRAFT: SourceDraft = { id: null, url: "", addQueryParams: true };

function sourceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `playlist-proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sourceStatusCopy(status: "checking" | "online" | "offline" | undefined): string {
  if (status === "online") return "Online";
  if (status === "offline") return "Offline";
  return "Checking";
}

function sourceStatusClass(status: "checking" | "online" | "offline" | undefined): string {
  if (status === "online") return "bg-emerald-400";
  if (status === "offline") return "bg-red-400";
  return "bg-amber-300 animate-pulse motion-reduce:animate-none";
}

interface SortableSourceRowProps {
  source: TwitchPlaylistProxySource;
  status: "checking" | "online" | "offline" | undefined;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SortableSourceRow({ source, status, onToggle, onEdit, onDelete }: SortableSourceRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: source.id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-3 border-b border-[#333333] px-3 py-3 motion-reduce:!transition-none last:border-b-0"
    >
      <Button
        variant="ghost"
        size="icon"
        className="cursor-grab active:cursor-grabbing"
        aria-label={translateSettings("settings.reorderValue", { value1: source.url })}
        {...attributes}
        {...listeners}
      >
        <LuGripVertical className="size-4" aria-hidden />
      </Button>
      <Switch
        checked={source.enabled}
        onCheckedChange={onToggle}
        aria-label={translateSettings("settings.enableValue", { value1: source.url })}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{source.url}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-[#a0a0a0]">
          <span className={`size-2 rounded-full ${sourceStatusClass(status)}`} aria-hidden />
          <span>{sourceStatusCopy(status)}</span>
          {source.addQueryParams && (
            <span>{translateSettings("settings.usesPlaybackQueryParameters")}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label={translateSettings("settings.editValue", { value1: source.url })}
        >
          <LuPencil className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label={translateSettings("settings.deleteValue", { value1: source.url })}
        >
          <LuTrash2 className="size-4 text-red-400" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

interface DeleteSourceDialogProps {
  source: TwitchPlaylistProxySource | null;
  onClose: () => void;
  onConfirm: () => void;
}

function DeleteSourceDialog({ source, onClose, onConfirm }: DeleteSourceDialogProps) {
  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-[#333333] bg-[#1a1a1a] text-white shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)]">
        <DialogHeader>
          <DialogTitle>{translateSettings("settings.deletePlaylistSource")}</DialogTitle>
          <DialogDescription>
            {translateSettings("settings.remove")}
            {source?.url}{" "}
            {translateSettings(
              "settings.fromTheFallbackOrderItWillNoLongerBeTriedDuringTwitchPlayback"
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {translateSettings("settings.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {translateSettings("settings.deleteSource")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TwitchPlaylistProxySettingsSection() {
  useTranslation();
  const preferences = useAuthStore((state) => state.preferences);
  const updatePreferences = useAuthStore((state) => state.updatePreferences);
  const proxyPreferences =
    preferences?.twitchPlaylistProxy ?? DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [sourceToDelete, setSourceToDelete] = useState<TwitchPlaylistProxySource | null>(null);
  const { statuses, refresh: refreshStatuses } = useTwitchPlaylistProxyStatuses(
    proxyPreferences.sources
  );
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const save = useCallback(
    (next: typeof proxyPreferences) => {
      void updatePreferences({ twitchPlaylistProxy: next });
    },
    [updatePreferences]
  );

  const updateSource = useCallback(
    (id: string, updates: Partial<TwitchPlaylistProxySource>) => {
      save({
        ...proxyPreferences,
        sources: proxyPreferences.sources.map((source) =>
          source.id === id ? { ...source, ...updates } : source
        ),
      });
    },
    [proxyPreferences, save]
  );

  const reorderSources = useCallback(
    (event: DragEndEvent) => {
      if (!event.over || event.active.id === event.over.id) return;
      const sources = moveTwitchPlaylistProxySource(
        proxyPreferences.sources,
        String(event.active.id),
        String(event.over.id)
      );
      save({ ...proxyPreferences, sources });
    },
    [proxyPreferences, save]
  );

  const openAdd = () => {
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
    setDialogOpen(true);
  };

  const openEdit = (source: TwitchPlaylistProxySource) => {
    setDraft({ id: source.id, url: source.url, addQueryParams: source.addQueryParams });
    setDraftError(null);
    setDialogOpen(true);
  };

  const saveDraft = () => {
    const url = draft.url.trim();
    if (!isTwitchPlaylistProxyTemplate(url)) {
      setDraftError("Use an HTTP(S) URL that includes $channel.");
      return;
    }
    if (draft.id) {
      updateSource(draft.id, { url, addQueryParams: draft.addQueryParams });
    } else {
      save({
        ...proxyPreferences,
        sources: [
          ...proxyPreferences.sources,
          { id: sourceId(), url, enabled: true, addQueryParams: draft.addQueryParams },
        ],
      });
    }
    setDialogOpen(false);
  };

  return (
    <section
      className="overflow-hidden rounded-xl border border-[#333333] bg-[#1a1a1a]"
      aria-labelledby="playlist-proxy-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#333333] px-6 py-5">
        <div>
          <h3 id="playlist-proxy-heading" className="text-lg font-semibold text-white">
            {translateSettings("settings.twitchPlaylistProxy")}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-[#a0a0a0]">
            {translateSettings(
              "settings.routesLiveTwitchPlaylistsThroughAnOrderedSourceListWhenEnabledTh"
            )}
          </p>
        </div>
        <Switch
          checked={proxyPreferences.enabled}
          onCheckedChange={(enabled) => save({ ...proxyPreferences, enabled })}
          aria-label={translateSettings("settings.enableTwitchPlaylistProxy")}
          className="data-[state=checked]:!bg-[#9146ff] data-[state=checked]:!border-[#9146ff]"
          thumbClassName="data-[state=checked]:!bg-white"
        />
      </div>

      <div className="space-y-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[#a0a0a0]">
            {translateSettings(
              "settings.sourcesAreTriedOnceFromTopToBottomDirectTwitchPlaybackIsTheFinal"
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={refreshStatuses}>
              <LuRefreshCw className="mr-1.5 size-3.5" aria-hidden />
              {translateSettings("settings.refreshStatus")}
            </Button>
            <Button size="sm" onClick={openAdd}>
              <LuPlus className="mr-1.5 size-3.5" aria-hidden />
              {translateSettings("settings.addSource")}
            </Button>
          </div>
        </div>

        {proxyPreferences.sources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#333333] bg-[#252525] px-4 py-8 text-center">
            <p className="text-sm font-medium text-white">
              {translateSettings("settings.noPlaylistProxySources")}
            </p>
            <p className="mt-1 text-sm text-[#a0a0a0]">
              {translateSettings("settings.addASourceOrRestoreTheDefaultList")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => save(DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES)}
            >
              {translateSettings("settings.restoreDefaults")}
            </Button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={reorderSources}
          >
            <SortableContext
              items={proxyPreferences.sources.map((source) => source.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="overflow-hidden rounded-lg border border-[#333333] bg-[#252525]">
                {proxyPreferences.sources.map((source) => (
                  <SortableSourceRow
                    key={source.id}
                    source={source}
                    status={statuses[source.id]}
                    onToggle={(enabled) => updateSource(source.id, { enabled })}
                    onEdit={() => openEdit(source)}
                    onDelete={() => setSourceToDelete(source)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {proxyPreferences.sources.length > 0 && (
          <button
            type="button"
            onClick={() => save(DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES)}
            className="text-xs font-medium text-[#a0a0a0] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {translateSettings("settings.restoreDefaults")}
          </button>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-[#333333] bg-[#1a1a1a] text-white shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)]">
          <DialogHeader>
            <DialogTitle>
              {draft.id
                ? translateSettings("settings.editPlaylistSource")
                : translateSettings("settings.addPlaylistSource")}
            </DialogTitle>
            <DialogDescription>
              {translateSettings("settings.includeChannelWhereTwitchAposSChannelNameBelongs")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="playlist-proxy-url" className="text-sm font-medium text-white">
                {translateSettings("settings.playlistUrl")}
              </label>
              <input
                id="playlist-proxy-url"
                value={draft.url}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, url: event.target.value }))
                }
                placeholder="https://example.com/live/$channel"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={draftError ? true : undefined}
                className="w-full rounded-lg border border-[#333333] bg-[#252525] px-3 py-2 text-sm text-white placeholder:text-[#666666] focus:border-white focus:outline-none focus:ring-2 focus:ring-white/20"
              />
              {draftError && <p className="text-sm text-red-400">{draftError}</p>}
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-[#333333] bg-[#252525] px-3 py-3">
              <div>
                <p className="text-sm font-medium text-white">
                  {translateSettings("settings.addPlaybackQueryParameters")}
                </p>
                <p className="mt-1 text-xs text-[#a0a0a0]">
                  {translateSettings("settings.addsSourceAudioOnlyAndFastBreadFlags")}
                </p>
              </div>
              <Switch
                checked={draft.addQueryParams}
                onCheckedChange={(addQueryParams) =>
                  setDraft((current) => ({ ...current, addQueryParams }))
                }
                aria-label={translateSettings("settings.addPlaybackQueryParameters")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              {translateSettings("settings.cancel")}
            </Button>
            <Button onClick={saveDraft}>
              {draft.id
                ? translateSettings("settings.saveSource")
                : translateSettings("settings.addSource")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteSourceDialog
        source={sourceToDelete}
        onClose={() => setSourceToDelete(null)}
        onConfirm={() => {
          if (!sourceToDelete) return;
          save({
            ...proxyPreferences,
            sources: proxyPreferences.sources.filter(
              (candidate) => candidate.id !== sourceToDelete.id
            ),
          });
          setSourceToDelete(null);
        }}
      />
    </section>
  );
}
