import { useEffect, useRef } from "react";
import type { CommandSuggestion } from "../../utils/chat-command-registry";

interface CommandAutocompleteProps {
  readonly commands: readonly CommandSuggestion[];
  readonly selectedKey: string | null;
  readonly onSelect: (command: CommandSuggestion) => void;
  readonly onSelectedKeyChange: (key: string) => void;
}

export function CommandAutocomplete({
  commands,
  selectedKey,
  onSelect,
  onSelectedKeyChange,
}: CommandAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedKey) return;
    const selectedElement = containerRef.current?.querySelector(`[data-key="${selectedKey}"]`);
    selectedElement?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  if (commands.length === 0) return null;

  const platformLabel = commands[0].platform.toUpperCase();

  return (
    <div
      ref={containerRef}
      aria-label="Chat commands"
      className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-lg border border-[#333] bg-[#2d2d2d] shadow-[0_4px_16px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)]"
      role="listbox"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#333] px-3 py-1.5 text-xs text-[#a0a0a0]">
        <span className="font-semibold text-white">{platformLabel}</span>
        <span>Arrow keys, Tab, or Enter</span>
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {commands.map((command) => {
          const selected = command.key === selectedKey;
          return (
            <button
              key={command.key}
              data-key={command.key}
              aria-selected={selected}
              className={`flex w-full items-start gap-3 px-3 py-2 text-left transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white ${
                selected ? "bg-white/10" : "hover:bg-white/5"
              }`}
              onClick={() => onSelect(command)}
              onMouseEnter={() => onSelectedKeyChange(command.key)}
              role="option"
              type="button"
            >
              <span className="min-w-28 font-semibold text-white">{command.usage}</span>
              <span className="min-w-0 text-sm leading-5 text-[#a0a0a0]">
                {command.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
