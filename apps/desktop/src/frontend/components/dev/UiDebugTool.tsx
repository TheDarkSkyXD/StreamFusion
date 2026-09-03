import type React from "react";
import { useTranslation } from "react-i18next";

import { setNetworkStatusOverrideForDebug } from "@/features/settings/data/useNetworkStatus";

import { DEBUG_TOKENS } from "./tokens";

const buttonBase: React.CSSProperties = {
  border: `1px solid ${DEBUG_TOKENS.borderStrong}`,
  borderRadius: 8,
  cursor: "pointer",
  font: `12.5px/1.2 ${DEBUG_TOKENS.fontUi}`,
  fontWeight: 700,
  padding: "9px 10px",
  transition: "background 0.12s, border-color 0.12s, color 0.12s",
};

export function UiDebugTool() {
  const { t } = useTranslation();
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "grid",
          gap: 6,
          padding: 10,
          borderRadius: 8,
          background: DEBUG_TOKENS.surfaceSubtle,
          border: `1px solid ${DEBUG_TOKENS.border}`,
        }}
      >
        <strong style={{ color: DEBUG_TOKENS.textPrimary, fontSize: 12.5 }}>
          {t("dev.ui.networkBanner")}
        </strong>
        <p style={{ margin: 0, color: DEBUG_TOKENS.textSecondary, fontSize: 12 }}>
          {t("dev.ui.networkBannerDescription")}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button
          type="button"
          onClick={() => setNetworkStatusOverrideForDebug(false)}
          style={{
            ...buttonBase,
            background: DEBUG_TOKENS.warningSoft,
            color: DEBUG_TOKENS.warning,
          }}
        >
          {t("dev.ui.showOfflineBanner")}
        </button>
        <button
          type="button"
          onClick={() => setNetworkStatusOverrideForDebug(null)}
          style={{
            ...buttonBase,
            background: DEBUG_TOKENS.surfaceRaised,
            color: DEBUG_TOKENS.textPrimary,
          }}
        >
          {t("dev.ui.useRealNetworkState")}
        </button>
      </div>
    </div>
  );
}
