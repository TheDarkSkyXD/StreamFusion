/**
 * RetentionCard — mod-log retention setting for a single scope.
 *
 * Extracted from the old PerChannelSettings page (which iterated this card
 * per moderated channel). Now reused by the per-channel mod pages
 * (`/mod/twitch/$channel`, `/mod/kick/$channel`) and the index's
 * GlobalRetention card.
 *
 * Number input ("days") + Forever toggle; persists via
 * `window.electronAPI.retention.set`. Initial values come from
 * `window.electronAPI.retention.get` — `undefined` means never set
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
        initial = await window.electronAPI.retention.get(scope);
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
        await window.electronAPI.retention.set(scope, null);
        toast.success(t("moderation.retentionSavedForever", { title }));
      } else {
        const parsed = parseInt(days, 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
          toast.error(t("moderation.positiveDaysError"));
          return;
        }
        await window.electronAPI.retention.set(scope, parsed);
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
      className="rounded border border-[var(--color-border)] bg-white/5 p-3"
      data-testid={`retention-card-${scope}`}
    >
      <div className="mb-2 text-sm font-medium text-white">{title}</div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-[var(--color-foreground-muted)]">
          <input
            type="number"
            min={1}
            value={days}
            disabled={forever}
            onChange={(e) => setDays(e.target.value)}
            aria-label={t("moderation.retentionDaysFor", { title })}
            className="w-24 rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white disabled:opacity-50"
          />
          {t("moderation.days")}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-foreground-muted)]">
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
          className="ml-auto rounded bg-[#9146FF] px-3 py-1 text-sm text-white hover:bg-[#9146FF]/90 disabled:opacity-50"
        >
          {saving ? t("moderation.saving") : t("moderation.save")}
        </button>
      </div>
    </div>
  );
}
