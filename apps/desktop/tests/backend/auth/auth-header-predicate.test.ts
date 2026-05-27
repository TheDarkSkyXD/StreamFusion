import { afterEach, describe, it, expect } from "vitest";

import { HEADER_RENDERED_PREDICATE } from "@/backend/auth/auth-window";

function evaluate(predicate: string): boolean {
  return new Function(`return ${predicate}`)() as boolean;
}

describe("HEADER_RENDERED_PREDICATE", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is true when the anonymous header (Sign In button) has rendered", () => {
    document.body.innerHTML = `<header><button>Sign In</button></header>`;
    expect(evaluate(HEADER_RENDERED_PREDICATE)).toBe(true);
  });

  it("is true when the logged-in header (avatar / user menu) has rendered", () => {
    document.body.innerHTML = `<header><button aria-haspopup="menu"><img alt="me" src="/x.png" /></button></header>`;
    expect(evaluate(HEADER_RENDERED_PREDICATE)).toBe(true);
  });

  it("is false before the header has rendered", () => {
    document.body.innerHTML = `<div id="app"></div>`;
    expect(evaluate(HEADER_RENDERED_PREDICATE)).toBe(false);
  });
});
