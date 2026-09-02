import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuSearch } from "react-icons/lu";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BROADCAST_LANGUAGES, getLanguageDisplayName } from "@/lib/languages";

interface Props {
  language: string;
  onLanguageChange: (v: string) => void;
  tagQuery: string;
  onTagQueryChange: (v: string) => void;
  sortOrder: "desc" | "asc";
  onSortOrderChange: (v: "desc" | "asc") => void;
  showViewerSort?: boolean;
  compact?: boolean;
}

// Radix Select forbids empty-string values, so we use a sentinel for "all".
const ALL_LANGUAGES = "__all__";

export function CategoryFilterBar({
  language,
  onLanguageChange,
  tagQuery,
  onTagQueryChange,
  sortOrder,
  onSortOrderChange,
  showViewerSort = true,
  compact = false,
}: Props) {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState(tagQuery);
  const languageOptions = useMemo(
    () =>
      BROADCAST_LANGUAGES.map((code) => ({ code, name: getLanguageDisplayName(code) })).sort(
        (a, b) => a.name.localeCompare(b.name)
      ),
    []
  );

  useEffect(() => {
    setTagInput(tagQuery);
  }, [tagQuery]);

  return (
    <div className={`flex flex-wrap items-center ${compact ? "gap-2" : "gap-3"}`}>
      <Select
        value={language || ALL_LANGUAGES}
        onValueChange={(v) => onLanguageChange(v === ALL_LANGUAGES ? "" : v)}
      >
        <SelectTrigger
          aria-label={t("discovery.language")}
          className={compact ? "h-8 min-w-[132px] w-auto px-2.5 text-xs" : "min-w-[160px] w-auto"}
        >
          <SelectValue placeholder={t("discovery.allLanguages")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_LANGUAGES}>{t("discovery.allLanguages")}</SelectItem>
          {languageOptions.map((opt) => (
            <SelectItem key={opt.code} value={opt.code}>
              {opt.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className={`relative ${compact ? "w-36" : "min-w-[160px]"}`}>
        <LuSearch
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-foreground-muted)] pointer-events-none"
          aria-hidden="true"
        />
        <input
          aria-label={t("discovery.tag")}
          type="text"
          value={tagInput}
          onChange={(e) => {
            setTagInput(e.target.value);
            onTagQueryChange(e.target.value);
          }}
          placeholder={t("discovery.searchTags")}
          className={`${compact ? "h-8 pl-8 pr-2.5 text-xs" : "h-9 pl-9 pr-3 text-sm"} w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background-tertiary)] shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500`}
        />
      </div>

      {showViewerSort && (
        <Select value={sortOrder} onValueChange={(v) => onSortOrderChange(v as "desc" | "asc")}>
          <SelectTrigger aria-label={t("discovery.viewerSort")} className="min-w-[160px] w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">{t("discovery.mostViewers")}</SelectItem>
            <SelectItem value="asc">{t("discovery.fewestViewers")}</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
