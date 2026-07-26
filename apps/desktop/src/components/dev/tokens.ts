/**
 * Design tokens shared by the dev DebugPanel and its tools. Lives in its own
 * module so DebugPanel ↔ tool imports don't form a circular dependency
 * (DebugPanel.tsx imports the tools, the tools import these tokens — if they
 * imported them from DebugPanel.tsx they'd hit a TDZ ReferenceError).
 *
 * Mirrors the StreamFusion app theme (apps/desktop/src/global.css): dark
 * backgrounds (#0f0f0f / #252525 / #2d2d2d), crimson brand accent (#dc143c),
 * white foreground. Surfaces use rgba so backdrop-filter blur reads through.
 */

export const DEBUG_TOKENS = {
  surface: "rgba(15, 15, 15, 0.92)", // --color-background #0f0f0f + alpha
  surfaceRaised: "rgba(37, 37, 37, 0.88)", // --color-background-tertiary #252525
  surfaceSubtle: "rgba(45, 45, 45, 0.45)", // --color-background-elevated #2d2d2d
  border: "rgba(51, 51, 51, 0.6)", // --color-border #333333
  borderStrong: "rgba(80, 80, 80, 0.7)",
  textPrimary: "#ffffff", // --color-foreground
  textSecondary: "#a0a0a0", // --color-foreground-secondary
  textMuted: "#666666", // --color-foreground-muted
  // Brand accent — crimson, matches --color-storm-accent. State communication
  // still uses success/warning/danger tokens below.
  accent: "#dc143c",
  accentSoft: "rgba(220, 20, 60, 0.15)",
  success: "rgb(74, 222, 128)", // green-400
  successSoft: "rgba(74, 222, 128, 0.15)",
  warning: "rgb(250, 204, 21)", // yellow-400
  warningSoft: "rgba(250, 204, 21, 0.15)",
  danger: "#dc143c", // --color-destructive
  dangerSoft: "rgba(220, 20, 60, 0.15)",
  fontUi: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontMono: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
  shadow: "0 12px 32px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.35)",
  // Used for scrollbarColor (Chromium supports the CSS standard property in inline style).
  scrollbarThumb: "rgba(80, 80, 80, 0.5) transparent",
} as const;
