const fs=require('fs');
const source='apps/desktop/src/backend/features/moderation/adapters/kick/kick-mod-mutations.ts';
let body=fs.readFileSync(source,'utf8');
body=body.replace('import { logger } from "@shared/utils/cross-logger";\n','');
body=body.replace(/\/\*\*\n \* Kick moderation mutations\.[\s\S]*?\*\//,`/**
 * Official Kick ban/timeout mutations. Chat room modes use the separate legacy
 * operation below because the Public API does not expose room-mode updates.
 */`);
body=body.replace(/async function withOfficialFallback\([\s\S]*?(?=export interface OfficialBanKickUserArgs)/,'');
body=body.replace(/export function banKickUser\([\s\S]*?(?=export interface OfficialTimeoutKickUserArgs)/,'');
body=body.replace(/export function timeoutKickUser\([\s\S]*?(?=export interface OfficialUnbanKickUserArgs)/,'');
body=body.replace(/export function unbanKickUser\([\s\S]*?(?=export interface SetKickChatModeArgs)/,'');
fs.writeFileSync(source,body);
const test='apps/desktop/src/backend/features/moderation/tests/api/platforms/kick/kick-mod-mutations.test.ts';
body=fs.readFileSync(test,'utf8');
for(const name of ['banKickUser','timeoutKickUser','unbanKickUser','deleteKickMessage'])body=body.replace(`  ${name},\n`,'');
body=body.replace(/\/\/ Guards:.*\n/, '// Guards: official moderation success/error envelopes and single-attempt writes; room modes remain an explicitly separate legacy operation.\n');
body=body.replace(/describe\("banKickUser",[\s\S]*?(?=describe\("timeoutKickUserOfficial")/,'');
body=body.replaceAll('await banKickUser({','await banKickUserOfficial({');
body=body.replaceAll('      channelSlug: "ac7ionman",\n      username: "u",','      broadcasterUserId: 123,\n      userId: 456,');
body=body.replaceAll('banKickUser classification','banKickUserOfficial classification');
body+=`
const officialActions = [
  { name: "ban", method: "POST", body: { broadcaster_user_id: 123, user_id: 456, reason: "spam" }, run: () => banKickUserOfficial({ broadcasterUserId: 123, userId: 456, accessToken: "tok-1", reason: "spam" }) },
  { name: "timeout", method: "POST", body: { broadcaster_user_id: 123, user_id: 456, duration: 10, reason: "spam" }, run: () => timeoutKickUserOfficial({ broadcasterUserId: 123, userId: 456, accessToken: "tok-1", duration: 10, reason: "spam" }) },
  { name: "unban", method: "DELETE", body: { broadcaster_user_id: 123, user_id: 456 }, run: () => unbanKickUserOfficial({ broadcasterUserId: 123, userId: 456, accessToken: "tok-1" }) },
];

describe.each(officialActions)("official $name request ownership", ({ run, method, body }) => {
  it("sends one authenticated request with the exact official payload on success", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {}, message: "OK" }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    expect(await run()).toEqual({ ok: true });
    expect(request).toHaveBeenCalledExactlyOnceWith("https://api.kick.com/public/v1/moderation/bans", {
      method,
      headers: { Authorization: "Bearer tok-1", Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    { status: 401, kind: "unauthenticated" },
    { status: 403, kind: "forbidden" },
    { status: 404, kind: "not-found" },
    { status: 429, kind: "rate-limited" },
    { status: 500, kind: "network" },
  ])("preserves $status failure without a second write", async ({ status, kind }) => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: "rejected" }), { status, headers: { "Retry-After": "30" } })).mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);
    expect(await run()).toEqual({ ok: false, kind, message: String(status), ...(status === 429 ? { retryAfterSeconds: 30 } : {}) });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("https://api.kick.com/public/v1/moderation/bans");
  });

  it("does not retry after an ambiguous connection failure", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("Connection closed after write")).mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);
    expect(await run()).toEqual({ ok: false, kind: "network", message: "Connection closed after write" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
`;
fs.writeFileSync(test,body);
