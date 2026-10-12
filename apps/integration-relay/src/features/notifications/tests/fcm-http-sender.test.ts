import { beforeAll, describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";

import {
  createFcmHttpSender,
  parseFcmServiceAccount
} from "../adapters/fcm-http-sender";

const now = Date.parse("2026-09-15T12:00:00.000Z");
const nativeToken = "fixture-fcm-registration-token";
const payload = {
  schemaVersion: 1 as const,
  eventId: "live:kick:channel-1:1",
  sourceId: "relay:live-alert:v1",
  channel: "live" as const,
  title: "Fixture streamer is live",
  body: "Fixture category",
  destination: {
    kind: "watch-channel" as const,
    platform: "kick" as const,
    channelId: "channel-1",
    channelLogin: "fixturechannel",
    streamState: "live" as const
  },
  occurredAt: "2026-09-15T12:00:00.000Z"
};

let privateKey: string;
let publicKey: Awaited<ReturnType<typeof generateKeyPair>>["publicKey"];

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

function serviceAccount() {
  return {
    projectId: "fixture-firebase-project",
    clientEmail: "fixture@fixture-firebase-project.iam.gserviceaccount.com",
    privateKey
  };
}

function sendInput(silent = false) {
  return { nativeToken, payload, silent, ttlSeconds: 120 };
}

describe("FCM HTTP sender", () => {
  it("parses only complete service account credentials without echoing secrets", () => {
    expect(
      parseFcmServiceAccount(
        JSON.stringify({
          project_id: "fixture-firebase-project",
          client_email:
            "fixture@fixture-firebase-project.iam.gserviceaccount.com",
          private_key: privateKey
        })
      )
    ).toEqual(serviceAccount());
    expect(parseFcmServiceAccount(undefined)).toBeNull();
    expect(parseFcmServiceAccount("{malformed")).toBeNull();
    expect(
      parseFcmServiceAccount(JSON.stringify({ project_id: "fixture" }))
    ).toBeNull();
  });

  it("signs an OAuth assertion and sends one data-only direct message", async () => {
    const requests: Request[] = [];
    const sender = createFcmHttpSender({
      serviceAccount: serviceAccount(),
      now: () => now,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url === "https://oauth2.googleapis.com/token") {
          const form = new URLSearchParams(await request.text());
          expect(form.get("grant_type")).toBe(
            "urn:ietf:params:oauth:grant-type:jwt-bearer"
          );
          const assertion = form.get("assertion");
          expect(assertion).not.toBeNull();
          const { payload: claims, protectedHeader } = await jwtVerify(
            assertion ?? "",
            publicKey,
            {
              audience: "https://oauth2.googleapis.com/token",
              currentDate: new Date(now)
            }
          );
          expect(protectedHeader).toMatchObject({ alg: "RS256", typ: "JWT" });
          expect(claims).toMatchObject({
            iss: serviceAccount().clientEmail,
            scope: "https://www.googleapis.com/auth/firebase.messaging",
            iat: now / 1000,
            exp: now / 1000 + 3600
          });
          return Response.json({
            access_token: "fixture-access-token",
            expires_in: 3600
          });
        }
        expect(request.url).toBe(
          "https://fcm.googleapis.com/v1/projects/fixture-firebase-project/messages:send"
        );
        expect(request.headers.get("authorization")).toBe(
          "Bearer fixture-access-token"
        );
        expect(await request.json()).toEqual({
          message: {
            token: nativeToken,
            data: { payload: JSON.stringify(payload), silent: "false" },
            android: { priority: "HIGH", ttl: "120s" }
          }
        });
        return Response.json({ name: "projects/fixture/messages/1" });
      }
    });

    expect(await sender.sendDirect(sendInput())).toEqual({ kind: "accepted" });
    expect(requests).toHaveLength(2);
  });

  it("coalesces token exchange and reuses the token for concurrent sends", async () => {
    let oauthCalls = 0;
    let sendCalls = 0;
    const silentValues: string[] = [];
    const sender = createFcmHttpSender({
      serviceAccount: serviceAccount(),
      now: () => now,
      fetch: async (input, init) => {
        if (String(input).includes("oauth2.googleapis.com")) {
          oauthCalls += 1;
          await Promise.resolve();
          return Response.json({
            access_token: "fixture-access-token",
            expires_in: 3600
          });
        }
        sendCalls += 1;
        const body: unknown = await new Request(input, init).json();
        if (
          isRecord(body) &&
          isRecord(body.message) &&
          isRecord(body.message.data)
        ) {
          silentValues.push(String(body.message.data.silent));
        }
        return Response.json({
          name: `projects/fixture/messages/${sendCalls}`
        });
      }
    });

    expect(
      await Promise.all([
        sender.sendDirect(sendInput()),
        sender.sendDirect(sendInput(true))
      ])
    ).toEqual([{ kind: "accepted" }, { kind: "accepted" }]);
    expect(await sender.sendDirect(sendInput())).toEqual({ kind: "accepted" });
    expect(oauthCalls).toBe(1);
    expect(sendCalls).toBe(3);
    expect(silentValues.slice(0, 2).sort()).toEqual(["false", "true"]);
    expect(silentValues[2]).toBe("false");
  });

  it("refreshes a cached token before its expiry margin", async () => {
    let currentTime = now;
    let oauthCalls = 0;
    const sender = createFcmHttpSender({
      serviceAccount: serviceAccount(),
      now: () => currentTime,
      fetch: async (input) => {
        if (String(input).includes("oauth2.googleapis.com")) {
          oauthCalls += 1;
          return Response.json({
            access_token: `fixture-access-${oauthCalls}`,
            expires_in: 120
          });
        }
        return Response.json({ name: "projects/fixture/messages/1" });
      }
    });

    expect(await sender.sendDirect(sendInput())).toEqual({ kind: "accepted" });
    currentTime += 59_000;
    expect(await sender.sendDirect(sendInput())).toEqual({ kind: "accepted" });
    currentTime += 2_000;
    expect(await sender.sendDirect(sendInput())).toEqual({ kind: "accepted" });
    expect(oauthCalls).toBe(2);
  });

  it("refreshes once after an FCM 401 and retries with the new access token", async () => {
    let oauthCalls = 0;
    const bearerTokens: string[] = [];
    const sender = createFcmHttpSender({
      serviceAccount: serviceAccount(),
      now: () => now,
      fetch: async (input, init) => {
        if (String(input).includes("oauth2.googleapis.com")) {
          oauthCalls += 1;
          return Response.json({
            access_token: `fixture-access-${oauthCalls}`,
            expires_in: 3600
          });
        }
        bearerTokens.push(
          new Request(input, init).headers.get("authorization") ?? ""
        );
        return bearerTokens.length === 1
          ? Response.json(
              { error: { status: "UNAUTHENTICATED" } },
              { status: 401 }
            )
          : Response.json({ name: "projects/fixture/messages/2" });
      }
    });

    expect(await sender.sendDirect(sendInput())).toEqual({ kind: "accepted" });
    expect(oauthCalls).toBe(2);
    expect(bearerTokens).toEqual([
      "Bearer fixture-access-1",
      "Bearer fixture-access-2"
    ]);
  });

  it.each([
    [404, "UNREGISTERED", { kind: "unregistered" }],
    [403, "SENDER_ID_MISMATCH", { kind: "credential-mismatch" }],
    [400, "INVALID_ARGUMENT", { kind: "rejected" }],
    [503, "UNAVAILABLE", { kind: "retryable", retryAfterMs: 0 }]
  ])("maps FCM %i %s", async (status, code, expected) => {
    const sender = createFcmHttpSender({
      serviceAccount: serviceAccount(),
      now: () => now,
      fetch: async (input) =>
        String(input).includes("oauth2.googleapis.com")
          ? Response.json({
              access_token: "fixture-access-token",
              expires_in: 3600
            })
          : Response.json({ error: { status: code } }, { status })
    });

    expect(await sender.sendDirect(sendInput())).toEqual(expected);
  });

  it("uses the FCM error detail code when Google's status is generic", async () => {
    const sender = createFcmHttpSender({
      serviceAccount: serviceAccount(),
      now: () => now,
      fetch: async (input) =>
        String(input).includes("oauth2.googleapis.com")
          ? Response.json({
              access_token: "fixture-access-token",
              expires_in: 3600
            })
          : Response.json(
              {
                error: {
                  status: "NOT_FOUND",
                  details: [
                    {
                      "@type":
                        "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                      errorCode: "UNREGISTERED"
                    }
                  ]
                }
              },
              { status: 404 }
            )
    });

    expect(await sender.sendDirect(sendInput())).toEqual({
      kind: "unregistered"
    });
  });

  it("stops after one unauthorized retry", async () => {
    let oauthCalls = 0;
    let sendCalls = 0;
    const sender = createFcmHttpSender({
      serviceAccount: serviceAccount(),
      now: () => now,
      fetch: async (input) => {
        if (String(input).includes("oauth2.googleapis.com")) {
          oauthCalls += 1;
          return Response.json({
            access_token: `fixture-access-${oauthCalls}`,
            expires_in: 3600
          });
        }
        sendCalls += 1;
        return Response.json(
          { error: { status: "UNAUTHENTICATED" } },
          { status: 401 }
        );
      }
    });

    expect(await sender.sendDirect(sendInput())).toEqual({
      kind: "credential-mismatch"
    });
    expect(oauthCalls).toBe(2);
    expect(sendCalls).toBe(2);
  });

  it("honors numeric and HTTP-date Retry-After and treats fetch failures as retryable", async () => {
    const retryAfterValues = ["12", "Tue, 15 Sep 2026 12:00:05 GMT"];
    const sender = createFcmHttpSender({
      serviceAccount: serviceAccount(),
      now: () => now,
      fetch: async (input) =>
        String(input).includes("oauth2.googleapis.com")
          ? Response.json({
              access_token: "fixture-access-token",
              expires_in: 3600
            })
          : Response.json(
              { error: { status: "RESOURCE_EXHAUSTED" } },
              {
                status: 429,
                headers: { "Retry-After": retryAfterValues.shift() ?? "0" }
              }
            )
    });

    expect(await sender.sendDirect(sendInput())).toEqual({
      kind: "retryable",
      retryAfterMs: 12_000
    });
    expect(await sender.sendDirect(sendInput())).toEqual({
      kind: "retryable",
      retryAfterMs: 5_000
    });

    const failingSender = createFcmHttpSender({
      serviceAccount: serviceAccount(),
      now: () => now,
      fetch: async () => {
        throw new Error("fixture network failure");
      }
    });
    expect(await failingSender.sendDirect(sendInput())).toEqual({
      kind: "retryable",
      retryAfterMs: 0
    });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
