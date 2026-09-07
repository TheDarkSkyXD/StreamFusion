import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StreamInfo, StreamInfoUpdate } from "../../../../../capabilities/channel-tools";
import { getChannelTools } from "../../../../../composition/channel-tools";
import { useToolResource } from "../../../../hooks/useToolResource";
import { NativeModViewLink, ToolError, toolButtonClass, toolInputClass } from "./ToolAccessGate";

type Category = StreamInfo["category"];

function CategoryPicker({
  value,
  disabled,
  onChange,
}: {
  value: Category;
  disabled: boolean;
  onChange: (category: Category) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    []
  );
  const search = async () => {
    const current = ++request.current;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const categories = await getChannelTools().streamInfo.searchCategories(query.trim());
      if (current === request.current) setResults(categories);
    } catch (failure) {
      if (current === request.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (current === request.current) setSearching(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs">
        {t("moderation.tools.streamInfo.category")}:{" "}
        {value.name || t("moderation.tools.streamInfo.noCategory")}
      </p>
      <label className="block space-y-1 text-xs">
        {t("moderation.tools.streamInfo.searchCategory")}
        <input
          className={toolInputClass}
          value={query}
          disabled={disabled}
          onChange={(event) => {
            request.current += 1;
            setSearching(false);
            setResults(null);
            setError(null);
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (query.trim() && !searching) void search();
            }
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={toolButtonClass}
          disabled={disabled || searching || !query.trim()}
          onClick={() => void search()}
        >
          {t(searching ? "moderation.loading" : "moderation.tools.streamInfo.search")}
        </button>
        <button
          type="button"
          className={toolButtonClass}
          disabled={disabled || !value.id}
          onClick={() => onChange({ id: "", name: "" })}
        >
          {t("moderation.tools.streamInfo.clearCategory")}
        </button>
      </div>
      <ToolError error={error} retry={() => void search()} />
      {results?.length === 0 && (
        <p role="status" className="text-xs">
          {t("moderation.tools.streamInfo.noResults")}
        </p>
      )}
      {results && results.length > 0 && (
        <ul className="max-h-48 overflow-auto rounded-md border border-[var(--color-border)]">
          {results.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                disabled={disabled}
                className="w-full px-3 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9146ff]"
                onClick={() => {
                  onChange(category);
                  setResults(null);
                }}
              >
                {category.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StreamInfoTool({
  channelId,
  channel,
  refreshCounter,
}: {
  channelId: string;
  channel: string;
  refreshCounter: number;
}) {
  const { t } = useTranslation();
  const load = useCallback(() => getChannelTools().streamInfo.get(channelId), [channelId]);
  const resource = useToolResource(load, refreshCounter);
  const [draft, setDraft] = useState<Partial<StreamInfo>>({});
  const [tagsText, setTagsText] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const info = resource.value ? { ...resource.value, ...draft } : null;
  const disabled = resource.busy || resource.loading || Boolean(resource.error);
  const change = (next: Partial<StreamInfo>) => {
    setSubmitted(false);
    setDraft((current) => ({ ...current, ...next }));
  };
  const tags =
    tagsText === null
      ? (info?.tags ?? [])
      : tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
  const validTags =
    tags.length <= 10 && tags.every((tag) => tag.length <= 25 && /^[\p{L}\p{N}]+$/u.test(tag));
  const dirty = Object.keys(draft).length > 0 || tagsText !== null;
  const save = async () => {
    if (!info || disabled || !dirty || !validTags) return;
    const settings: StreamInfoUpdate = {
      ...(draft.title !== undefined ? { title: draft.title } : {}),
      ...(draft.category ? { categoryId: draft.category.id } : {}),
      ...(draft.language !== undefined ? { language: draft.language } : {}),
      ...(tagsText !== null ? { tags } : {}),
      ...(draft.contentClassificationLabels
        ? {
            contentClassificationLabels: info.availableContentClassificationLabels.map(
              ({ id }) => ({
                id,
                enabled: info.contentClassificationLabels.includes(id),
              })
            ),
          }
        : {}),
    };
    if (await resource.run(() => getChannelTools().streamInfo.update(channelId, settings))) {
      setDraft({});
      setTagsText(null);
      setSubmitted(true);
    }
  };
  return (
    <div className="space-y-3 p-3">
      <ToolError error={resource.error} retry={resource.retry} />
      {resource.loading && <p role="status">{t("moderation.loading")}</p>}
      {submitted && (
        <p role="status" className="text-xs text-[var(--color-foreground-muted)]">
          {t("moderation.tools.streamInfo.submitted")}
        </p>
      )}
      {info && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1 text-xs">
            {t("moderation.tools.title")}
            <textarea
              className={toolInputClass}
              value={info.title}
              required
              maxLength={140}
              disabled={disabled}
              onChange={(event) => change({ title: event.target.value })}
            />
          </label>
          <CategoryPicker
            value={info.category}
            disabled={disabled}
            onChange={(category) => change({ category })}
          />
          <label className="block space-y-1 text-xs">
            {t("moderation.tools.streamInfo.language")}
            <input
              className={toolInputClass}
              value={info.language}
              required
              pattern="[a-z]{2}|other"
              disabled={disabled}
              onChange={(event) => change({ language: event.target.value.toLowerCase() })}
            />
            <span className="block text-[var(--color-foreground-muted)]">
              {t("moderation.tools.streamInfo.languageHint")}
            </span>
          </label>
          <label className="block space-y-1 text-xs">
            {t("moderation.tools.streamInfo.tags")}
            <input
              className={toolInputClass}
              value={tagsText ?? info.tags.join(", ")}
              disabled={disabled}
              aria-invalid={!validTags}
              onChange={(event) => {
                setSubmitted(false);
                setTagsText(event.target.value);
              }}
            />
            <span className="block text-[var(--color-foreground-muted)]">
              {t("moderation.tools.streamInfo.tagsHint")}
            </span>
            {!validTags && <span role="alert">{t("moderation.tools.streamInfo.invalidTags")}</span>}
          </label>
          <fieldset disabled={disabled} className="space-y-2">
            <legend className="mb-2 text-xs font-semibold">
              {t("moderation.tools.streamInfo.labels")}
            </legend>
            {info.availableContentClassificationLabels.map((label) => (
              <label key={label.id} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[#9146ff]"
                  checked={info.contentClassificationLabels.includes(label.id)}
                  onChange={(event) =>
                    change({
                      contentClassificationLabels: event.target.checked
                        ? [...info.contentClassificationLabels, label.id]
                        : info.contentClassificationLabels.filter((id) => id !== label.id),
                    })
                  }
                />
                <span>
                  {label.name}
                  <span className="mt-1 block text-[var(--color-foreground-muted)]">
                    {label.description}
                  </span>
                </span>
              </label>
            ))}
            {info.contentClassificationLabels
              .filter(
                (id) => !info.availableContentClassificationLabels.some((label) => label.id === id)
              )
              .map((id) => (
                <p key={id} className="text-xs text-[var(--color-foreground-muted)]">
                  {t("moderation.tools.streamInfo.managedLabel", { label: id })}
                </p>
              ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={toolButtonClass}
              disabled={disabled || !dirty || !validTags || !info.title.trim()}
            >
              {t(resource.busy ? "moderation.saving" : "moderation.tools.streamInfo.save")}
            </button>
            <button
              type="button"
              className={toolButtonClass}
              disabled={disabled || !dirty}
              onClick={() => {
                setDraft({});
                setTagsText(null);
                setSubmitted(false);
              }}
            >
              {t("moderation.tools.streamInfo.discard")}
            </button>
          </div>
        </form>
      )}
      <p className="text-xs text-[var(--color-foreground-muted)]">
        {t("moderation.tools.streamInfo.nativeOnly")}
      </p>
      <NativeModViewLink channel={channel} />
    </div>
  );
}
