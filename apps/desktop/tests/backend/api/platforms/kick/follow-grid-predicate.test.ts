import { afterEach, describe, it, expect } from "vitest";

import { GRID_READY_PREDICATE } from "@/backend/api/platforms/kick/endpoints/follow-endpoints";

// The predicate string is the exact JS executed in the page; run it against
// fixture DOM in jsdom (the default Vitest environment for this repo).
function evaluate(predicate: string): boolean {
  return new Function(`return ${predicate}`)() as boolean;
}

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
