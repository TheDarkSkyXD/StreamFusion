const baseUrl = process.env.WORKER_BASE_URL || "https://streamfusion.leveluptogetherbiz.workers.dev";

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${response.url}, got: ${text.slice(0, 200)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const tokenUrl = new URL("/auth/kick/token", baseUrl);
  const preflightResponse = await fetch(tokenUrl, { method: "OPTIONS" });

  assert(
    preflightResponse.status === 200,
    `/auth/kick/token preflight returned ${preflightResponse.status}; expected 200`
  );
  assert(
    preflightResponse.headers.get("Access-Control-Allow-Methods") === "POST, OPTIONS",
    "/auth/kick/token preflight did not return the auth-only method contract"
  );

  const invalidResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code: "missing-pkce-fields" }),
  });
  const invalidBody = await readJson(invalidResponse);

  assert(
    invalidResponse.status === 400,
    `/auth/kick/token invalid input returned ${invalidResponse.status}; expected 400. Body: ${JSON.stringify(invalidBody)}`
  );
  assert(
    invalidBody?.error === "invalid_request",
    `/auth/kick/token invalid input returned ${JSON.stringify(invalidBody)}`
  );

  const removedDataUrl = new URL("/kick/channels", baseUrl);
  const removedDataResponse = await fetch(removedDataUrl);
  assert(
    removedDataResponse.status === 404,
    `/kick/channels returned ${removedDataResponse.status}; expected 404`
  );

  const removedPreflightResponse = await fetch(removedDataUrl, { method: "OPTIONS" });
  assert(
    removedPreflightResponse.status === 404,
    `/kick/channels preflight returned ${removedPreflightResponse.status}; expected 404`
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        auth_preflight_status: preflightResponse.status,
        invalid_auth_status: invalidResponse.status,
        removed_data_status: removedDataResponse.status,
        removed_data_preflight_status: removedPreflightResponse.status,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
