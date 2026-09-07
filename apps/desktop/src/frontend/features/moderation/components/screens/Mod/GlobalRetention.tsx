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
    <section
      data-testid="global-retention"
      className="overflow-hidden rounded-md border border-[#303034] bg-[#18181b]"
    >
      <header className="flex h-10 items-center bg-[#252529] px-3">
        <h2 className="text-sm font-semibold text-white">{t("moderation.globalRetention")}</h2>
      </header>
      <div className="space-y-2 p-3">
        <p className="text-xs leading-5 text-[#adadb8]">
          {t("moderation.defaultRetentionDescription")}
        </p>
        <RetentionCard scope="global" title={t("moderation.globalDefault")} />
      </div>
    </section>
  );
}
