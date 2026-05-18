import type React from "react";
import { type ReactNode, useState } from "react";

/** U19 — Identifiers for the four possible chat-panel tabs. The visible set
 *  is platform- and role-dependent: viewers see no strip at all; Twitch mods
 *  see chat/automod/modlog; Twitch broadcasters add engagement; Kick caps at
 *  chat/automod/modlog. */
export type ChatPanelTabId = "chat" | "automod" | "modlog" | "engagement";

const TAB_LABELS: Record<ChatPanelTabId, string> = {
  chat: "Chat",
  automod: "AutoMod",
  modlog: "Mod log",
  engagement: "Engagement",
};

export interface ChatPanelTabsProps {
  /** Which tab IDs to show. Always includes "chat" at minimum. */
  visibleTabs: ChatPanelTabId[];
  /** Optional badge count per tab (e.g. AutoMod queue length). undefined = no badge. */
  badges?: Partial<Record<ChatPanelTabId, number>>;
  /** Panel content per tab. Required entries match visibleTabs. */
  children: Partial<Record<ChatPanelTabId, ReactNode>>;
  /** Initial active tab. Default = "chat". */
  initialTab?: ChatPanelTabId;
  /** Called when the user switches tabs. */
  onTabChange?: (tab: ChatPanelTabId) => void;
}

/**
 * U19 — Tabbed shell wrapping the chat panel. Inactive tabs are rendered
 * with `display: none` (NOT unmounted) so the Chat tab keeps its IRC stream
 * alive while a mod is reviewing AutoMod / Mod log / Engagement panels.
 *
 * When `visibleTabs.length === 1`, the tab strip is omitted entirely and
 * the single panel renders raw — that's the viewer / AE5 path.
 *
 * Tab state is component-local: no router integration, no query string.
 */
export const ChatPanelTabs: React.FC<ChatPanelTabsProps> = ({
  visibleTabs,
  badges,
  children,
  initialTab = "chat",
  onTabChange,
}) => {
  // Pick an initial tab that's actually visible. If the caller passes an
  // initialTab that got filtered out (e.g. broadcaster lost a role), fall
  // back to "chat", which is guaranteed to be present.
  const safeInitial = visibleTabs.includes(initialTab) ? initialTab : "chat";
  const [activeTab, setActiveTab] = useState<ChatPanelTabId>(safeInitial);

  const handleClick = (tab: ChatPanelTabId) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  // Single-tab path (AE5: non-mod viewer) — no chrome, just the chat body.
  if (visibleTabs.length <= 1) {
    return <>{children.chat}</>;
  }

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <div
        role="tablist"
        className="flex border-b border-[var(--color-border)] bg-[var(--color-background-tertiary,#1a1a1a)] flex-shrink-0"
      >
        {visibleTabs.map((tab) => {
          const isActive = tab === activeTab;
          const badge = badges?.[tab];
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-tab-id={tab}
              onClick={() => handleClick(tab)}
              className={`px-3 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                isActive
                  ? "bg-[#9146FF]/20 text-purple-300 border-b-2 border-purple-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <span>{TAB_LABELS[tab]}</span>
              {typeof badge === "number" && badge > 0 ? (
                <span className="bg-red-500 text-white rounded-full px-1.5 text-xs">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 relative">
        {visibleTabs.map((tab) => (
          <div
            key={tab}
            role="tabpanel"
            data-tab-panel={tab}
            // Inactive panels keep their DOM but are hidden. This is critical
            // for the Chat tab: unmounting would drop the IRC subscription
            // and force a reconnect on the next switch back.
            style={{ display: tab === activeTab ? undefined : "none" }}
            className="h-full w-full"
          >
            {children[tab]}
          </div>
        ))}
      </div>
    </div>
  );
};
