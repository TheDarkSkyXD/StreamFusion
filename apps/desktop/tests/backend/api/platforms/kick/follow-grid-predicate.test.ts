import vm from "node:vm";
import { afterEach, describe, it, expect } from "vitest";

import { GRID_READY_PREDICATE } from "@backend/api/platforms/kick/endpoints/follow-endpoints";

// The predicate string is the exact JS executed in the page; run it against
// fixture DOM in jsdom (the default Vitest environment for this repo).
function evaluate(predicate: string): boolean {
  return vm.runInThisContext(predicate) as boolean;
}

// Guards: the Kick following-page readiness check accepts one-card and explicit-empty accounts without requiring an arbitrary link count.
// Guards: recommendation-only Live Channels content never qualifies as the authenticated followed-channel section.
describe("GRID_READY_PREDICATE", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is true once the followed-channels grid has rendered at least one card", () => {
    document.body.innerHTML = `
      <section>
        <h2>Followed Channels</h2>
        <div>
          <a href="/streamerone"><img alt="StreamerOne" src="/a.png" /></a>
          <a href="/streamertwo"><img alt="StreamerTwo" src="/b.png" /></a>
        </div>
      </section>`;
    expect(evaluate(GRID_READY_PREDICATE)).toBe(true);
  });

  it("accepts the dedicated page's Following heading with a single followed channel", () => {
    document.body.innerHTML = `
      <main>
        <h1>Following</h1>
        <a href="/onlychannel"><img alt="OnlyChannel" src="/only.png" /></a>
      </main>`;
    expect(evaluate(GRID_READY_PREDICATE)).toBe(true);
  });

  it("does not mistake a Live Channels recommendation card for a followed channel", () => {
    document.body.innerHTML = `
      <main>
        <section><h1>Following</h1><p>Channels you follow will appear here.</p></section>
        <section>
          <h2>Live Channels</h2>
          <a href="/recommended"><img alt="Recommended" src="/recommended.png" /></a>
        </section>
      </main>`;
    expect(evaluate(GRID_READY_PREDICATE)).toBe(false);
  });

  it("is ready when the Following section explicitly says the account follows no channels", () => {
    document.body.innerHTML = `
      <main>
        <section>
          <h1>Following</h1>
          <p>You aren't following any channels yet.</p>
        </section>
      </main>`;
    expect(evaluate(GRID_READY_PREDICATE)).toBe(true);
  });

  it("is false before the grid has rendered (heading present, no cards yet)", () => {
    document.body.innerHTML = `
      <section>
        <h2>Followed Channels</h2>
        <div><span>Loading…</span></div>
      </section>`;
    expect(evaluate(GRID_READY_PREDICATE)).toBe(false);
  });

  it("is false on a bare page with no following heading", () => {
    document.body.innerHTML = `<main><div class="spinner"></div></main>`;
    expect(evaluate(GRID_READY_PREDICATE)).toBe(false);
  });
});
