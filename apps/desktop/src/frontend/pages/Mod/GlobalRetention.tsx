/**
 * GlobalRetention — wraps the shared RetentionCard for the "global" scope
 * with a section heading. Rendered on the /mod index so users see the
 * default that per-channel cards override.
 */

import { RetentionCard } from "./channel/RetentionCard";
import { useTranslation } from "react-i18next";

export function GlobalRetention() {
  const { t } = useTranslation();
  return (
    <section data-testid="global-retention">
      <h2 className="text-xl font-semibold mb-3 text-white">{t("moderation.globalRetention")}</h2>
      <p className="mb-2 text-xs text-[var(--color-foreground-muted)]">
        {t("moderation.defaultRetentionDescription")}
      </p>
      <RetentionCard scope="global" title={t("moderation.globalDefault")} />
    </section>
  );
}
