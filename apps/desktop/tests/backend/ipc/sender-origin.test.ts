import { describe, expect, it } from "vitest";

import { isAllowedSender, isAllowedSenderUrl } from "@backend/ipc/sender-origin";

describe("isAllowedSenderUrl", () => {
  it("allows the production file:// renderer bundle", () => {
    expect(isAllowedSenderUrl("file:///C:/Program%20Files/App/out/renderer/index.html")).toBe(true);
    expect(isAllowedSenderUrl("file:///opt/app/renderer/index.html")).toBe(true);
  });

  it("allows the loopback dev server (any port)", () => {
    expect(isAllowedSenderUrl("http://localhost:5173/")).toBe(true);
    expect(isAllowedSenderUrl("http://127.0.0.1:3000/index.html")).toBe(true);
    expect(isAllowedSenderUrl("http://[::1]:5173/")).toBe(true);
  });

  it("rejects remote origins even over https", () => {
    expect(isAllowedSenderUrl("https://www.twitch.tv/embed")).toBe(false);
    expect(isAllowedSenderUrl("http://evil.example.com/")).toBe(false);
    expect(isAllowedSenderUrl("https://gql.twitch.tv/")).toBe(false);
  });

  it("rejects data:, blob:, and unparseable URLs", () => {
    expect(isAllowedSenderUrl("data:text/html,<script>1</script>")).toBe(false);
    expect(isAllowedSenderUrl("blob:https://x/123")).toBe(false);
    expect(isAllowedSenderUrl("not a url")).toBe(false);
    expect(isAllowedSenderUrl("")).toBe(false);
    expect(isAllowedSenderUrl(undefined)).toBe(false);
    expect(isAllowedSenderUrl(null)).toBe(false);
  });

  it("rejects a non-loopback host that merely contains 'localhost'", () => {
    expect(isAllowedSenderUrl("http://localhost.evil.com/")).toBe(false);
    expect(isAllowedSenderUrl("http://notlocalhost/")).toBe(false);
  });
});

describe("isAllowedSender", () => {
  it("reads senderFrame.url off the event", () => {
    expect(isAllowedSender({ senderFrame: { url: "file:///app/index.html" } })).toBe(true);
    expect(isAllowedSender({ senderFrame: { url: "https://twitch.tv" } })).toBe(false);
    expect(isAllowedSender({ senderFrame: null })).toBe(false);
    expect(isAllowedSender({})).toBe(false);
  });
});
