import { Link } from "@tanstack/react-router";
import { LuClapperboard, LuHouse, LuPlay } from "react-icons/lu";

export type SortOption = "recent" | "views";

interface ContentTabsProps {
  activeTab: string | undefined;
}

export function ContentTabs({ activeTab }: ContentTabsProps) {
  return (
    <div className="sticky top-0 z-30 bg-[var(--color-background)] pt-2 mb-4 flex items-center justify-between border-b border-[var(--color-border)]">
      <div className="flex items-center gap-4">
        <Link
          from="/stream/$platform/$channel"
          search={{ tab: "home" }}
          className={`pb-3 text-sm font-medium transition-colors relative ${
            !activeTab || activeTab === "home"
              ? "text-[var(--color-foreground)]"
              : "text-[var(--color-foreground-muted)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <span className="flex items-center gap-2">
            <LuHouse className="w-4 h-4" /> Home
          </span>
          {(!activeTab || activeTab === "home") && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-primary)]" />
          )}
        </Link>
        <Link
          from="/stream/$platform/$channel"
          search={{ tab: "videos" }}
          className={`pb-3 text-sm font-medium transition-colors relative ${
            activeTab === "videos"
              ? "text-[var(--color-foreground)]"
              : "text-[var(--color-foreground-muted)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <span className="flex items-center gap-2">
            <LuPlay className="w-4 h-4" /> Videos
          </span>
          {activeTab === "videos" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-primary)]" />
          )}
        </Link>
        <Link
          from="/stream/$platform/$channel"
          search={{ tab: "clips" }}
          className={`pb-3 text-sm font-medium transition-colors relative ${
            activeTab === "clips"
              ? "text-[var(--color-foreground)]"
              : "text-[var(--color-foreground-muted)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <span className="flex items-center gap-2">
            <LuClapperboard className="w-4 h-4" /> Clips
          </span>
          {activeTab === "clips" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-primary)]" />
          )}
        </Link>
      </div>
    </div>
  );
}
