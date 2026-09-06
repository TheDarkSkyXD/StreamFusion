import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Filter } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  MOD_LOG_ACTION_FILTERS,
  type ModLogAction,
  type ModLogActionFilter,
} from "@shared/mod-action-filters";

type CategoryFilterId = Exclude<ModLogActionFilter["id"], "all">;
const categoryFilters = MOD_LOG_ACTION_FILTERS.filter((filter) => filter.id !== "all");

const labelKeys: Record<CategoryFilterId, `moderation.modActionFilters.${string}`> = {
  "message-deletions": "moderation.modActionFilters.messageDeletions",
  "chat-mode-changes": "moderation.modActionFilters.chatModeChanges",
  "automod-level-changes": "moderation.modActionFilters.autoModLevelChanges",
  "mods-and-vips": "moderation.modActionFilters.modsAndVips",
  "timeouts-and-untimeouts": "moderation.modActionFilters.timeoutsAndUntimeouts",
  "blocked-and-permitted-terms": "moderation.modActionFilters.blockedAndPermittedTerms",
  shoutouts: "moderation.modActionFilters.shoutouts",
  "chat-warnings": "moderation.modActionFilters.chatWarnings",
  "bans-and-unbans": "moderation.modActionFilters.bansAndUnbans",
  raids: "moderation.modActionFilters.raids",
  "unban-requests": "moderation.modActionFilters.unbanRequests",
  "suspicious-users": "moderation.modActionFilters.suspiciousUsers",
  "guest-star": "moderation.modActionFilters.guestStar",
  roles: "moderation.modActionFilters.roles",
};

export const ALL_MOD_ACTION_FILTER_IDS = categoryFilters.map((filter) => filter.id);

export function selectedModLogActions(
  selectedIds: readonly CategoryFilterId[]
): ModLogAction[] | undefined {
  if (selectedIds.length === categoryFilters.length) return undefined;

  const selected = new Set(selectedIds);
  const actions = new Set<ModLogAction>();
  for (const filter of categoryFilters) {
    if (!selected.has(filter.id)) continue;
    for (const action of filter.actions) actions.add(action);
  }
  return [...actions];
}

interface ModActionFilterMenuProps {
  platform: "twitch" | "kick";
  selectedIds: readonly CategoryFilterId[];
  onSelectedIdsChange: (selectedIds: CategoryFilterId[]) => void;
  moderatorFilter: string;
  onModeratorFilterChange: (value: string) => void;
}

export function ModActionFilterMenu({
  platform,
  selectedIds,
  onSelectedIdsChange,
  moderatorFilter,
  onModeratorFilterChange,
}: ModActionFilterMenuProps) {
  const { t } = useTranslation();
  const selected = new Set(selectedIds);
  const allSelected = selectedIds.length === categoryFilters.length;
  const buttonLabel = t("moderation.filtersSelected", {
    count: selectedIds.length,
    defaultValue: "Filters ({{count}} selected)",
  });

  const updateCategory = (id: CategoryFilterId, checked: boolean) => {
    onSelectedIdsChange(
      checked ? [...selectedIds, id] : selectedIds.filter((selectedId) => selectedId !== id)
    );
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={buttonLabel}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-[#3d3d43] bg-[#252529] px-2.5 text-xs font-semibold text-white hover:bg-[#303034] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mod-focus,#bf94ff)]"
        >
          <Filter size={14} aria-hidden="true" />
          {t("moderation.filters", { defaultValue: "Filters" })}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-platform={platform}
          aria-label={t("moderation.filterModActionsByType", {
            defaultValue: "Filter Mod Actions by Type",
          })}
          align="end"
          sideOffset={6}
          className="mod-workspace-menu z-50 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto rounded-md border border-[#53535f] bg-[#252529] p-1 text-sm text-[#efeff1] shadow-[0_4px_20px_#0008]"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold text-white">
            {t("moderation.filterModActionsByType", {
              defaultValue: "Filter Mod Actions by Type",
            })}
          </DropdownMenu.Label>
          <DropdownMenu.CheckboxItem
            checked={allSelected}
            className="flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--mod-accent,#9146ff)] data-[highlighted]:text-[var(--mod-on-accent,#fff)]"
            onCheckedChange={(checked) =>
              onSelectedIdsChange(checked ? [...ALL_MOD_ACTION_FILTER_IDS] : [])
            }
            onSelect={(event) => event.preventDefault()}
          >
            <DropdownMenu.ItemIndicator aria-hidden="true" className="mr-2 w-3">
              ✓
            </DropdownMenu.ItemIndicator>
            {t("moderation.all", { defaultValue: "All" })}
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator className="my-1 h-px bg-[#3d3d43]" />
          {categoryFilters.map((filter) => (
            <DropdownMenu.CheckboxItem
              key={filter.id}
              checked={selected.has(filter.id)}
              className="flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--mod-accent,#9146ff)] data-[highlighted]:text-[var(--mod-on-accent,#fff)]"
              onCheckedChange={(checked) => updateCategory(filter.id, checked)}
              onSelect={(event) => event.preventDefault()}
            >
              <DropdownMenu.ItemIndicator aria-hidden="true" className="mr-2 w-3">
                ✓
              </DropdownMenu.ItemIndicator>
              {t(labelKeys[filter.id], { defaultValue: filter.label })}
            </DropdownMenu.CheckboxItem>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-[#3d3d43]" />
          <div className="px-1 pb-1 pt-1" onKeyDown={(event) => event.stopPropagation()}>
            <label className="sr-only" htmlFor="modlog-moderator-filter">
              {t("moderation.moderatorUsername")}
            </label>
            <input
              id="modlog-moderator-filter"
              type="text"
              placeholder={t("moderation.moderatorUsername", {
                defaultValue: "Filter by moderator",
              })}
              data-testid="modlog-moderator-filter"
              value={moderatorFilter}
              onChange={(event) => onModeratorFilterChange(event.target.value)}
              className="h-8 w-full rounded-md border border-[#3d3d43] bg-[#0e0e10] px-2 text-xs text-white outline-none placeholder:text-[#777780] focus:border-[var(--mod-focus,#bf94ff)]"
            />
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
