import { getModerationServices } from "@/features/moderation/composition/moderation-services";
/**
 * RetentionCard — mod-log retention setting for a single scope.
 *
 * Extracted from the old PerChannelSettings page (which iterated this card
 * per moderated channel). Now reused by the per-channel mod pages
 * (`/mod/twitch/$channel`, `/mod/kick/$channel`) and the index's
 * GlobalRetention card.
 *
 * Number input ("days") + Forever toggle; persists via
 * `getModerationServices().retention.set`. Initial values come from
 * `getModerationServices().retention.get` — `undefined` means never set
 * (treated as Forever / blank), `null` is the explicit Forever override.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { RetentionScope } from "@shared/mod-log-types";

interface RetentionCardProps {
  scope: RetentionScope;
  title: string;
}

export function RetentionCard({ scope, title }: RetentionCardProps) {
  const { t } = useTranslation();
  const [days, setDays] = useState<string>("");
  const [forever, setForever] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let initial: number | null | undefined;
      try {
        initial = await getModerationServices().retention.get(scope);
      } catch {
        initial = undefined;
      }
      if (cancelled) return;
      if (initial === undefined) {
        setDays("");
        setForever(false);
      } else if (initial === null) {
        setDays("");
        setForever(true);
      } else {
        setDays(String(initial));
        setForever(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (forever) {
        await getModerationServices().retention.set(scope, null);
        toast.success(t("moderation.retentionSavedForever", { title }));
      } else {
        const parsed = parseInt(days, 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
          toast.error(t("moderation.positiveDaysError"));
          return;
        }
        await getModerationServices().retention.set(scope, parsed);
        toast.success(t("moderation.retentionSavedDays", { title, count: parsed }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("moderation.saveFailed", { error: msg }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-md border border-[#303034] bg-[#0e0e10] p-2.5"
      data-testid={`retention-card-${scope}`}
    >
      <div className="mb-2 text-xs font-semibold text-white">{title}</div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-[#adadb8]">
          <input
            type="number"
            min={1}
            value={days}
            disabled={forever}
            onChange={(e) => setDays(e.target.value)}
            aria-label={t("moderation.retentionDaysFor", { title })}
            className="h-8 w-20 rounded-md border border-[#3d3d43] bg-[#18181b] px-2 text-sm text-white outline-none focus:border-[var(--mod-focus,#bf94ff)] disabled:opacity-50"
          />
          {t("moderation.days")}
        </label>
        <label className="flex h-8 items-center gap-1.5 rounded-md border border-[#3d3d43] bg-[#18181b] px-2 text-xs text-[#efeff1]">
          <input
            type="checkbox"
            checked={forever}
            onChange={(e) => {
              setForever(e.target.checked);
              if (e.target.checked) setDays("");
            }}
            aria-label={t("moderation.foreverToggleFor", { title })}
          />
          {t("moderation.forever")}
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="ml-auto h-8 rounded-md bg-[var(--mod-accent,#9147ff)] px-3 text-xs font-semibold text-[var(--mod-on-accent,#fff)] hover:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mod-focus,#bf94ff)] disabled:opacity-50"
        >
          {saving ? t("moderation.saving") : t("moderation.save")}
        </button>
      </div>
    </div>
  );
}
