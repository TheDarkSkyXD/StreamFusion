const baseUrl = process.env.WORKER_BASE_URL || "https://streamfusion.leveluptogetherbiz.workers.dev";
const probeSlug = process.env.KICK_PROBE_SLUG || "hennytingzz";

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
  const healthUrl = new URL("/health", baseUrl);
  const healthResponse = await fetch(healthUrl);
  const health = await readJson(healthResponse);

  assert(
    healthResponse.status === 200,
    `/health returned ${healthResponse.status}; expected 200. Body: ${JSON.stringify(health)}`
  );
  assert(health?.status === "ok", `/health status was ${health?.status}; expected ok`);
  assert(
    health?.kick_official_api?.probe === "/public/v1/channels?slug[]=hennytingzz",
    "/health did not report the hennytingzz Kick official API probe"
  );
  assert(
    health?.kick_official_api?.status === "healthy",
    `/health Kick official API was ${health?.kick_official_api?.status}; expected healthy`
  );
  assert(
    health?.kick_official_api?.http_status === 200,
    `/health Kick official API probe returned ${health?.kick_official_api?.http_status}; expected 200`
  );

  const channelUrl = new URL("/kick/channels", baseUrl);
  channelUrl.searchParams.append("slug[]", probeSlug);
  const channelResponse = await fetch(channelUrl, {
    headers: {
      Accept: "application/json",
      "X-StreamFusion-Auth": "app",
    },
  });
  const channel = await readJson(channelResponse);

  assert(
    channelResponse.status === 200,
    `/kick/channels returned ${channelResponse.status}; expected 200. Body: ${JSON.stringify(channel)}`
  );
  assert(Array.isArray(channel?.data), "/kick/channels response did not include a data array");
  assert(channel.data.length > 0, `/kick/channels returned no rows for ${probeSlug}`);
  assert(
    channel.data.some((row) => row?.slug?.toLowerCase() === probeSlug.toLowerCase()),
    `/kick/channels did not include slug ${probeSlug}`
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        health_status: health.status,
        kick_probe_status: health.kick_official_api.http_status,
        channel_rows: channel.data.length,
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
