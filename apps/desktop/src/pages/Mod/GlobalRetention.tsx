/**
 * GlobalRetention — wraps the shared RetentionCard for the "global" scope
 * with a section heading. Rendered on the /mod index so users see the
 * default that per-channel cards override.
 */

import { RetentionCard } from "./channel/RetentionCard";

export function GlobalRetention() {
  return (
    <section data-testid="global-retention">
      <h2 className="text-xl font-semibold mb-3 text-white">Global retention</h2>
      <p className="mb-2 text-xs text-[var(--color-foreground-muted)]">
        Default mod-log retention. Per-channel pages override this.
      </p>
      <RetentionCard scope="global" title="Global (default)" />
    </section>
  );
}
