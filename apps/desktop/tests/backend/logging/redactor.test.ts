import { describe, expect, it } from "vitest";

import { redactObject, redactString } from "@/backend/logging/redactor";

// Guards: the log redactor is the last line of defence before OAuth tokens,
// refresh tokens, client secrets, OAuth `code` values, JWTs, and reversible
// Twitch clip media wrappers hit the disk.
// Users routinely share bug-report log files. Every case below is a class of
// leak we have either seen in the wild or expect to see; loosening any of these
// assertions without a documented reason is a regression.

describe("redactString", () => {
  describe("Bearer tokens", () => {
    it("redacts a Bearer token in the middle of a string", () => {
      const out = redactString(
        "GET /helix/users headers={Authorization: Bearer abc123XYZ.token-value_42} status=200"
      );
      expect(out).toContain("Bearer [REDACTED]");
      expect(out).not.toContain("abc123XYZ.token-value_42");
      expect(out).toContain("status=200");
    });

    it("redacts a lowercase `bearer` token", () => {
      const out = redactString("authorization: bearer abc.def.ghi");
      expect(out).toContain("[REDACTED]");
      expect(out).not.toContain("abc.def.ghi");
    });
  });

  describe("OAuth query params", () => {
    it("redacts access_token query param", () => {
      const out = redactString(
        "https://id.twitch.tv/oauth2/token?access_token=oauth2_abc_DEF-123&scope=user:read"
      );
      expect(out).toContain("access_token=[REDACTED]");
      expect(out).toContain("scope=user:read");
      expect(out).not.toContain("oauth2_abc_DEF-123");
    });

    it("redacts refresh_token query param", () => {
      const out = redactString("refresh_token=rt_abc-DEF_123&grant_type=refresh_token");
      expect(out).toContain("refresh_token=[REDACTED]");
      expect(out).toContain("grant_type=refresh_token");
      expect(out).not.toContain("rt_abc-DEF_123");
    });

    it("redacts client_secret query param", () => {
      const out = redactString("client_id=public_abc&client_secret=shh_secret-VALUE_42&x=1");
      expect(out).toContain("client_secret=[REDACTED]");
      expect(out).toContain("x=1");
      expect(out).not.toContain("shh_secret-VALUE_42");
    });

    it("redacts oauth `code` query param in an oauth2/callback URL", () => {
      const out = redactString("streamfusion://oauth2/callback?code=auth_code-XYZ_42&state=abc");
      expect(out).toContain("code=[REDACTED]");
      expect(out).toContain("state=abc");
      expect(out).not.toContain("auth_code-XYZ_42");
    });

    it("does NOT redact `code=` outside an oauth callback context", () => {
      const out = redactString("HTTP error: code=429 message=rate limited");
      expect(out).toContain("code=429");
    });

    it("stops at & boundary so it does not over-redact later params", () => {
      const out = redactString("?access_token=secret_token-VALUE&user=alice&x=y");
      expect(out).toContain("access_token=[REDACTED]");
      expect(out).toContain("user=alice");
      expect(out).toContain("x=y");
    });
  });

  describe("reversible media wrappers", () => {
    it("redacts the complete Twitch clip media wrapper", () => {
      const reversiblePayload = "SENTINEL_REVERSIBLE_CLIP_PAYLOAD";
      const out = redactString(
        `Player init twitch-clip-media://media?u=${reversiblePayload} status=starting`
      );

      expect(out).toContain("twitch-clip-media://[REDACTED]");
      expect(out).not.toContain(reversiblePayload);
      expect(out).toContain("status=starting");
    });
  });

  describe("JSON-shaped strings", () => {
    it('redacts "access_token":"..." JSON field', () => {
      const out = redactString('{"access_token":"oauth_secret-ABC_123","expires_in":3600}');
      expect(out).toContain('"access_token":"[REDACTED]"');
      expect(out).toContain('"expires_in":3600');
      expect(out).not.toContain("oauth_secret-ABC_123");
    });

    it('redacts "refresh_token":"..." JSON field', () => {
      const out = redactString('{"refresh_token":"rt_secret_ABC-123"}');
      expect(out).toContain('"refresh_token":"[REDACTED]"');
      expect(out).not.toContain("rt_secret_ABC-123");
    });

    it('redacts "client_secret":"..." JSON field', () => {
      const out = redactString('{"client_secret":"shhh_value-ABC_42"}');
      expect(out).toContain('"client_secret":"[REDACTED]"');
      expect(out).not.toContain("shhh_value-ABC_42");
    });

    it('redacts "client_id":"..." JSON field', () => {
      const out = redactString('{"client_id":"abcd1234efgh"}');
      expect(out).toContain('"client_id":"[REDACTED]"');
      expect(out).not.toContain("abcd1234efgh");
    });

    it("tolerates whitespace around the colon in JSON", () => {
      const out = redactString('{"access_token" : "tok_VAL-1"}');
      expect(out).toContain("[REDACTED]");
      expect(out).not.toContain("tok_VAL-1");
    });
  });

  describe("JWT-style tokens", () => {
    it("redacts a standalone JWT (three base64url parts, > 40 chars)", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const out = redactString(`session token = ${jwt} status=ok`);
      expect(out).toContain("[REDACTED]");
      expect(out).toContain("status=ok");
      expect(out).not.toContain(jwt);
    });

    it("does NOT redact short dotted strings (e.g. version numbers)", () => {
      const out = redactString("electron 35.7.5 build 1.2.3-beta.1");
      expect(out).toBe("electron 35.7.5 build 1.2.3-beta.1");
    });

    it("does NOT redact dotted module paths", () => {
      const out = redactString("loaded module foo.bar.baz successfully");
      expect(out).toBe("loaded module foo.bar.baz successfully");
    });
  });

  describe("non-secret strings", () => {
    it("returns innocuous English unchanged", () => {
      const s = "Connecting to channel xqc; viewers=42000; latency=150ms";
      expect(redactString(s)).toBe(s);
    });

    it("returns an empty string unchanged", () => {
      expect(redactString("")).toBe("");
    });

    it("does NOT redact a normal alphanumeric ID", () => {
      const s = "user_id=12345 channel=darkskyxd";
      expect(redactString(s)).toBe(s);
    });
  });
});

describe("redactObject", () => {
  describe("primitives and non-string types", () => {
    it("returns numbers unchanged", () => {
      expect(redactObject(42)).toBe(42);
    });

    it("returns booleans unchanged", () => {
      expect(redactObject(true)).toBe(true);
      expect(redactObject(false)).toBe(false);
    });

    it("returns null unchanged", () => {
      expect(redactObject(null)).toBe(null);
    });

    it("returns undefined unchanged", () => {
      expect(redactObject(undefined)).toBe(undefined);
    });

    it("passes Date instances through (does not deep-walk)", () => {
      const d = new Date("2026-06-07T00:00:00Z");
      const out = redactObject(d);
      expect(out).toBeInstanceOf(Date);
      expect((out as Date).getTime()).toBe(d.getTime());
    });

    it("passes Buffer instances through", () => {
      const buf = Buffer.from("access_token=should_not_walk_inside_buffers");
      const out = redactObject(buf);
      expect(Buffer.isBuffer(out)).toBe(true);
    });

    it("passes typed arrays through", () => {
      const arr = new Uint8Array([1, 2, 3, 4]);
      const out = redactObject(arr);
      expect(out).toBeInstanceOf(Uint8Array);
      expect((out as Uint8Array).length).toBe(4);
    });
  });

  describe("key-based redaction", () => {
    it("redacts `access_token` regardless of case", () => {
      const out = redactObject({ Access_Token: "abc.def.ghi", expires_in: 3600 });
      expect(out).toEqual({ Access_Token: "[REDACTED]", expires_in: 3600 });
    });

    it("redacts refresh_token, client_secret, client_id, password, authorization, token", () => {
      const out = redactObject({
        refresh_token: "rt-value",
        client_secret: "cs-value",
        client_id: "ci-value",
        password: "pw-value",
        authorization: "Bearer xyz",
        token: "tok-value",
        public: "fine",
      });
      expect(out).toEqual({
        refresh_token: "[REDACTED]",
        client_secret: "[REDACTED]",
        client_id: "[REDACTED]",
        password: "[REDACTED]",
        authorization: "[REDACTED]",
        token: "[REDACTED]",
        public: "fine",
      });
    });

    it("does NOT redact a sensitive key when the value is empty / non-string", () => {
      const out = redactObject({ access_token: "", refresh_token: 0, password: null });
      expect(out).toEqual({ access_token: "", refresh_token: 0, password: null });
    });

    it("does NOT redact innocuous keys", () => {
      const out = redactObject({ username: "alice", channel: "xqc", title: "stream" });
      expect(out).toEqual({ username: "alice", channel: "xqc", title: "stream" });
    });
  });

  describe("nested structures", () => {
    it("recurses into nested objects", () => {
      const out = redactObject({
        platform: "twitch",
        auth: { access_token: "secret-A", refresh_token: "secret-B" },
      });
      expect(out).toEqual({
        platform: "twitch",
        auth: { access_token: "[REDACTED]", refresh_token: "[REDACTED]" },
      });
    });

    it("recurses into arrays", () => {
      const out = redactObject([
        { access_token: "tok1" },
        { access_token: "tok2" },
        "Bearer abc.def.ghi-long-enough",
      ]);
      expect(out).toEqual([
        { access_token: "[REDACTED]" },
        { access_token: "[REDACTED]" },
        "Bearer [REDACTED]",
      ]);
    });

    it("handles deeply nested mixed structures", () => {
      const out = redactObject({
        a: {
          b: {
            c: [{ access_token: "deep-secret" }, { harmless: "value" }],
          },
        },
      });
      expect(out).toEqual({
        a: { b: { c: [{ access_token: "[REDACTED]" }, { harmless: "value" }] } },
      });
    });
  });

  describe("string-value redaction inside objects", () => {
    it("runs redactString on string values that aren't matched by key", () => {
      const out = redactObject({
        message: "got back access_token=tok_SECRET-VAL from server",
      });
      expect(out).toEqual({
        message: "got back access_token=[REDACTED] from server",
      });
    });

    it("redacts an inline secret inside a URL inside a value", () => {
      const out = redactObject({
        request: { url: "https://api.example.com/x?access_token=tok-SECRET" },
      });
      expect(out).toEqual({
        request: { url: "https://api.example.com/x?access_token=[REDACTED]" },
      });
    });
  });

  describe("immutability", () => {
    it("does not mutate the input object", () => {
      const input = { access_token: "secret", nested: { refresh_token: "also-secret" } };
      const snapshot = JSON.parse(JSON.stringify(input));
      redactObject(input);
      expect(input).toEqual(snapshot);
    });

    it("does not mutate input arrays", () => {
      const input = [{ access_token: "tok" }];
      const snapshot = JSON.parse(JSON.stringify(input));
      redactObject(input);
      expect(input).toEqual(snapshot);
    });
  });

  describe("circular references", () => {
    // Not a security concern, but logger callers occasionally pass cyclic
    // structures (errors with `cause` chains, IPC payloads). We must not
    // throw RangeError on infinite recursion.
    it("does not throw on circular references", () => {
      const obj: Record<string, unknown> = { access_token: "secret" };
      obj.self = obj;
      expect(() => redactObject(obj)).not.toThrow();
    });
  });
});
