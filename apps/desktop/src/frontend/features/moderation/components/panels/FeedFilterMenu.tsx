import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useId } from "react";

export interface FeedFilterOption {
  value: string;
  label: string;
}
export function FeedFilterMenu({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly FeedFilterOption[];
  selected: readonly string[] | null;
  onChange: (selected: string[] | null) => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const all = selected === null;
  const itemClass =
    "relative flex cursor-pointer items-center gap-2 rounded-sm py-1.5 pl-7 pr-2 text-xs outline-none data-[highlighted]:bg-[#9146ff] data-[highlighted]:text-white";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={`inline-flex h-7 items-center gap-1.5 rounded border px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf94ff] ${all ? "border-[#53535f] bg-[#252529] text-[#efeff1]" : "border-[#bf94ff] bg-[#9146ff]/20 text-[#bf94ff]"}`}
        >
          <Filter size={13} aria-hidden="true" />
          {t("moderation.workspacePanels.filter")}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          aria-labelledby={labelId}
          align="start"
          sideOffset={4}
          className="mod-workspace-menu z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 overflow-y-auto rounded border border-[#53535f] bg-[#252529] p-1 text-[#efeff1] shadow-lg"
        >
          <DropdownMenu.Label id={labelId} className="px-2 py-1 text-xs text-[#adadb8]">
            {label}
          </DropdownMenu.Label>
          <DropdownMenu.CheckboxItem
            className={itemClass}
            checked={all}
            onCheckedChange={() => onChange(all ? [] : null)}
            onSelect={(event) => event.preventDefault()}
          >
            <DropdownMenu.ItemIndicator className="absolute left-2">
              <Check size={13} aria-hidden="true" />
            </DropdownMenu.ItemIndicator>
            {t("moderation.workspacePanels.all")}
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator className="my-1 h-px bg-[#3d3d43]" />
          {options.map((option) => (
            <DropdownMenu.CheckboxItem
              key={option.value}
              className={itemClass}
              checked={all || selected.includes(option.value)}
              onCheckedChange={(checked) => {
                const current = selected ?? options.map((item) => item.value);
                const next = checked
                  ? [...current.filter((value) => value !== option.value), option.value]
                  : current.filter((value) => value !== option.value);
                onChange(next.length === options.length ? null : next);
              }}
              onSelect={(event) => event.preventDefault()}
            >
              <DropdownMenu.ItemIndicator className="absolute left-2">
                <Check size={13} aria-hidden="true" />
              </DropdownMenu.ItemIndicator>
              {option.label}
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
