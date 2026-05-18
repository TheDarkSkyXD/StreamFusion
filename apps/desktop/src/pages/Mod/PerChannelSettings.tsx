/**
 * U30 — Per-channel retention settings (slim version).
 *
 * Original U30 was the AutoMod editor; with AutoMod removed (commit b15bdec)
 * what's left is the mod-log retention setting. One card per scope:
 *
 *   • Global  — applies to all channels that don't have a per-channel override.
 *   • Channel — overrides for each Twitch channel the signed-in user moderates.
 *
 * Each card has a number input ("days") + a "Forever" toggle. Save persists
 * via `dbService.setRetentionSetting`. Initial values come from
 * `dbService.getRetentionSetting`, which returns `undefined` for "never set"
 * (treated as Forever / blank) and `null` for the explicit Forever override.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  dbService,
  type RetentionScope,
} from "@/backend/services/database-service";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

interface RetentionCardProps {
  scope: RetentionScope;
  title: string;
}

function RetentionCard({ scope, title }: RetentionCardProps) {
  // The DB read happens synchronously inside the renderer-side singleton.
  // Wrap it in a try/catch — when running in a context without an initialized
  // DB (e.g. unit-test renders), surface the empty state rather than crashing.
  const [days, setDays] = useState<string>("");
  const [forever, setForever] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    let initial: number | null | undefined;
    try {
      initial = dbService.getRetentionSetting(scope);
    } catch {
      initial = undefined;
    }
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
  }, [scope]);

  const handleSave = () => {
    setSaving(true);
    try {
      if (forever) {
        dbService.setRetentionSetting(scope, null);
        toast.success(`Retention saved for ${title}: Forever`);
      } else {
        const parsed = parseInt(days, 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
          toast.error("Days must be a positive integer (or enable Forever)");
          return;
        }
        dbService.setRetentionSetting(scope, parsed);
        toast.success(`Retention saved for ${title}: ${parsed} days`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Save failed: ${msg}`);
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
            aria-label={`Retention days for ${title}`}
            className="w-24 rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white disabled:opacity-50"
          />
          days
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-foreground-muted)]">
          <input
            type="checkbox"
            checked={forever}
            onChange={(e) => {
              setForever(e.target.checked);
              if (e.target.checked) setDays("");
            }}
            aria-label={`Forever toggle for ${title}`}
          />
          Forever
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="ml-auto rounded bg-[#9146FF] px-3 py-1 text-sm text-white hover:bg-[#9146FF]/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export function PerChannelSettings() {
  const channelIds = useModeratedChannelsStore((s) =>
    Array.from(s.twitchModeratedChannelIds),
  );

  return (
    <section data-testid="per-channel-settings">
      <h2 className="text-xl font-semibold mb-3 text-white">Per-channel retention</h2>
      <div className="space-y-3">
        <RetentionCard scope="global" title="Global (default)" />
        {channelIds.map((id) => (
          <RetentionCard
            key={id}
            scope={`channel:${id}` as RetentionScope}
            title={`Channel ${id}`}
          />
        ))}
        {channelIds.length === 0 ? (
          <p className="text-gray-400">You don't moderate any channels yet.</p>
        ) : null}
      </div>
    </section>
  );
}
