import vm from "node:vm";
import { afterEach, describe, it, expect } from "vitest";

import { HEADER_RENDERED_PREDICATE } from "@backend/auth/auth-header-predicate";

function evaluate(predicate: string): boolean {
  return vm.runInThisContext(predicate) as boolean;
}

// Guards: anonymous, avatar-based, and icon-only Kick headers all release the authentication readiness wait.
// Guards: channel images and an incomplete app shell cannot impersonate an authenticated Kick header.
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

  it("is true for Kick's current icon-only authenticated navigation", () => {
    document.body.innerHTML = `<nav><button><svg /></button><button><svg /></button><button><svg data-account-icon /></button></nav>`;
    expect(evaluate(HEADER_RENDERED_PREDICATE)).toBe(true);
  });

  it("does not mistake channel-card profile images for an authenticated header", () => {
    document.body.innerHTML = `<main><img alt="streamer" src="/profile/channel.webp" /></main>`;
    expect(evaluate(HEADER_RENDERED_PREDICATE)).toBe(false);
  });

  it("is false before the header has rendered", () => {
    document.body.innerHTML = `<div id="app"></div>`;
    expect(evaluate(HEADER_RENDERED_PREDICATE)).toBe(false);
  });
});
