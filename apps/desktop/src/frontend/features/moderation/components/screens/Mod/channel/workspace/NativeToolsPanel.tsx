import { useTranslation } from "react-i18next";
import { NativeModViewLink } from "./ToolAccessGate";

export function NativeToolsPanel({ channel }: { channel: string }) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-[var(--color-border)]">
      {(["batchReports", "permittedTerms", "viewerHistory", "sharedBans"] as const).map((tool) => (
        <section key={tool} className="space-y-3 p-3">
          <h3 className="text-sm font-semibold">{t(`moderation.tools.native.${tool}`)}</h3>
          <p className="text-xs text-[var(--color-foreground-muted)]">
            {t(`moderation.tools.native.${tool}Detail`)}
          </p>
          <NativeModViewLink channel={channel} />
        </section>
      ))}
    </div>
  );
}
