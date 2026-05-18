/**
 * Design tokens shared by the dev DebugPanel and its tools. Lives in its own
 * module so DebugPanel ↔ tool imports don't form a circular dependency
 * (DebugPanel.tsx imports the tools, the tools import these tokens — if they
 * imported them from DebugPanel.tsx they'd hit a TDZ ReferenceError).
 *
 * Monochrome dark surface, soft text, white accent. State colors (success /
 * warning / danger) are reserved for semantic feedback only.
 */

export const DEBUG_TOKENS = {
  surface: "rgba(17, 24, 39, 0.92)", // gray-900 with alpha for backdrop blur
  surfaceRaised: "rgba(31, 41, 55, 0.85)", // gray-800
  surfaceSubtle: "rgba(55, 65, 81, 0.4)", // gray-700 with low alpha
  border: "rgba(75, 85, 99, 0.4)", // gray-600 with alpha
  borderStrong: "rgba(107, 114, 128, 0.5)", // gray-500 with alpha
  textPrimary: "rgb(243, 244, 246)", // gray-100
  textSecondary: "rgb(156, 163, 175)", // gray-400
  textMuted: "rgb(107, 114, 128)", // gray-500
  // "accent" is now monochrome — points at white/gray for any decorative
  // emphasis. State communication uses the success/warning/danger tokens
  // below; nothing else should introduce hue.
  accent: "rgb(243, 244, 246)", // gray-100 (was cyan-400)
  accentSoft: "rgba(243, 244, 246, 0.08)", // subtle white ghost (was cyan tint)
  success: "rgb(74, 222, 128)", // green-400
  successSoft: "rgba(74, 222, 128, 0.15)",
  warning: "rgb(250, 204, 21)", // yellow-400
  warningSoft: "rgba(250, 204, 21, 0.15)",
  danger: "rgb(248, 113, 113)", // red-400
  dangerSoft: "rgba(248, 113, 113, 0.15)",
  fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontMono: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
  shadow: "0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.25)",
  // Used for scrollbarColor (Chromium supports the CSS standard property in inline style).
  scrollbarThumb: "rgba(107, 114, 128, 0.45) transparent",
} as const;
