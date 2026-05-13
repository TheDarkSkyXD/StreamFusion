import { useMemo } from "react";
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
}: Props) {
  const languageOptions = useMemo(
    () =>
      BROADCAST_LANGUAGES.map((code) => ({ code, name: getLanguageDisplayName(code) })).sort(
        (a, b) => a.name.localeCompare(b.name)
      ),
    []
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={language || ALL_LANGUAGES}
        onValueChange={(v) => onLanguageChange(v === ALL_LANGUAGES ? "" : v)}
      >
        <SelectTrigger className="min-w-[160px] w-auto">
          <SelectValue placeholder="All languages" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_LANGUAGES}>All languages</SelectItem>
          {languageOptions.map((opt) => (
            <SelectItem key={opt.code} value={opt.code}>
              {opt.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="relative min-w-[160px]">
        <LuSearch
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-foreground-muted)] pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="text"
          value={tagQuery}
          onChange={(e) => onTagQueryChange(e.target.value)}
          placeholder="Search tags…"
          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background-tertiary)] pl-9 pr-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 focus:border-zinc-500"
        />
      </div>

      <Select value={sortOrder} onValueChange={(v) => onSortOrderChange(v as "desc" | "asc")}>
        <SelectTrigger className="min-w-[160px] w-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc">Most viewers</SelectItem>
          <SelectItem value="asc">Fewest viewers</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
