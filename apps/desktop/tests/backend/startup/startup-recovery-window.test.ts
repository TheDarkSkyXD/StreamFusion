import { describe, expect, it } from "vitest";

import { buildStartupRecoveryUrl } from "@backend/startup/startup-recovery-window";

// Guards: startup failures render a local, script-free recovery page without leaking raw error text.
// Guards: recovery markup carries the selected display language and RTL direction.
describe("startup recovery window", () => {
  it("builds a restrictive static recovery document with a sanitized diagnostic ID", () => {
    const url = buildStartupRecoveryUrl('safe-id<script>alert("x")</script>');
    const html = decodeURIComponent(url.slice(url.indexOf(",") + 1));

    expect(url).toMatch(/^data:text\/html/);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("safe-idscriptalertxscript");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("raw error");
  });

  it("marks Arabic recovery copy as right-to-left", () => {
    const url = buildStartupRecoveryUrl("diagnostic-id", "ar");
    const html = decodeURIComponent(url.slice(url.indexOf(",") + 1));

    expect(html).toContain('<html lang="ar" dir="rtl">');
  });
});
