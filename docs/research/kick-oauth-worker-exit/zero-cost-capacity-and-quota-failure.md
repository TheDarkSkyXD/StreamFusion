# Zero-cost Kick auth capacity and quota failure

Research date: 2026-08-30

## Result

Unlimited secure Kick OAuth at a guaranteed owner cost of $0 is not possible with the documented services in this study. A confidential service has to spend finite compute and shared-state quota for every accepted token operation. Abuse and retries spend some of that quota without producing a token. A hard $0 cap can prevent a bill only by stopping authentication when a free quota runs out.

Vercel Hobby plus Upstash Redis Free can satisfy the no-charge and no-automatic-overage rule if StreamFusion never attaches a payment method or enables an upgrade. Its practical ceiling is much lower than the headline quotas suggest. One efficient atomic two-key limiter costs five Upstash commands for each allowed token operation. The 500,000-command monthly quota therefore permits at most 100,000 successful exchanges and refreshes, before rejected attempts and operational headroom. Upstash is the first normal-traffic limit, not Vercel's one million monthly Function invocations.

The existing Cloudflare Workers Free deployment is the largest credible $0 baseline in this comparison. It permits 100,000 Worker requests each UTC day and fails closed after that. AWS and Google can serve much more traffic, but neither meets the hard $0 contract. AWS has a paid secret and time-limited API Gateway grant. Google's required load balancer has a fixed hourly charge. Their budget controls also do not guarantee that spend stops at exactly $0.

This report does not select a runtime. It supplies the cost and capacity evidence for [issue 118](https://github.com/TheDarkSkyXD/StreamFusion/issues/118).

## What the model counts

The unit is one hosted token operation:

- one authorization-code exchange after the user completes the built-in Desktop popup or the planned Android browser flow; or
- one refresh performed by either installed client.

One active person on Desktop and Android counts as two active installations when both clients refresh. Monthly active users, daily active users, active installations, simultaneous sessions, token operations, and peak requests per second are different quantities. MAU alone cannot size this service.

The model uses three explicit activity profiles. They are workload assumptions, not measured StreamFusion telemetry.

| Profile | DAU as share of MAU | Active hours per active day | Exchanges or re-authorizations per MAU-month | Uniform concurrent sessions |
| ------- | ------------------: | --------------------------: | -------------------------------------------: | --------------------------: |
| Light   |                 10% |                           1 |                                           2% |                  `DAU / 24` |
| Typical |                 20% |                           2 |                                           5% |                  `DAU / 12` |
| Heavy   |                 40% |                           8 |                                          10% |                   `DAU / 3` |

The model assumes 30 active days in a month and one installation per MAU. The concurrent-session column spreads usage uniformly across the day. Real peaks will be higher.

### Kick token lifetime is not fixed in the published contract

Kick's current [OAuth guide](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/generating-tokens-oauth2-flow.md) returns `expires_in` but does not publish a fixed value or minimum. The rest of the official documentation at that revision also gives no access-token lifetime. This report does not invent one. It models 1, 4, 8, and 24-hour lifetimes.

Desktop refreshes five minutes before `expires_at`. It schedules a refresh on startup and again on system resume when the token is near expiry. There is no startup or resume jitter. For a lifetime `L` in hours, the proactive interval is `L - 5/60`. The model conservatively assumes that every returning daily user needs one startup refresh, then adds in-session refreshes with `floor(active_hours / interval)`.

| Profile |             1-hour token |      4-hour token |      8-hour token |     24-hour token |
| ------- | -----------------------: | ----------------: | ----------------: | ----------------: |
| Light   |  2/day, 2.00/active hour |  1/day, 1.00/hour |  1/day, 1.00/hour |  1/day, 1.00/hour |
| Typical |  3/day, 1.50/active hour |  1/day, 0.50/hour |  1/day, 0.50/hour |  1/day, 0.50/hour |
| Heavy   | 9/day, 1.125/active hour | 3/day, 0.375/hour | 2/day, 0.250/hour | 1/day, 0.125/hour |

This assumption can overcount users whose valid token survives until the next day. It can undercount installations left running around the clock and people active on both platforms. The sensitivity table makes that uncertainty visible.

### Monthly token operations

Monthly operations are:

```text
DAU * 30 * refreshes_per_active_day
+ MAU * monthly_exchange_rate
```

The values below include both initial exchange and ongoing refresh. They are also the Vercel Function invocation counts for valid requests that reach the handler.

| Profile and MAU  |    DAU | Uniform concurrent sessions |     1-hour |    4-hour |    8-hour |   24-hour |
| ---------------- | -----: | --------------------------: | ---------: | --------: | --------: | --------: |
| Light, 1,000     |    100 |                           4 |      6,020 |     3,020 |     3,020 |     3,020 |
| Light, 10,000    |  1,000 |                          42 |     60,200 |    30,200 |    30,200 |    30,200 |
| Light, 100,000   | 10,000 |                         417 |    602,000 |   302,000 |   302,000 |   302,000 |
| Typical, 1,000   |    200 |                          17 |     18,050 |     6,050 |     6,050 |     6,050 |
| Typical, 10,000  |  2,000 |                         167 |    180,500 |    60,500 |    60,500 |    60,500 |
| Typical, 100,000 | 20,000 |                       1,667 |  1,805,000 |   605,000 |   605,000 |   605,000 |
| Heavy, 1,000     |    400 |                         133 |    108,100 |    36,100 |    24,100 |    12,100 |
| Heavy, 10,000    |  4,000 |                       1,333 |  1,081,000 |   361,000 |   241,000 |   121,000 |
| Heavy, 100,000   | 40,000 |                      13,333 | 10,810,000 | 3,610,000 | 2,410,000 | 1,210,000 |

The average request rate can look harmless while the monthly quota is already lost. Typical 100,000 MAU with a one-hour token averages only 0.70 token requests per second, but it needs 1.805 million requests per month. Heavy 100,000 MAU at the same lifetime averages 4.17 requests per second and needs 10.81 million per month.

## Vercel Hobby plus Upstash Redis Free

### One allowed token operation uses five Upstash commands

The proposed limiter runs one Lua script over the source-address key and the hashed OAuth-subject key for the current minute. A minimal script reads both counts before making a decision. For an allowed request it writes each count with `SET ... PX` when the window is new or `INCR` when it already exists.

Upstash bills the script's operations separately. Its official [rate-limit cost table](https://upstash.com/docs/redis/sdks/ratelimit-ts/costs) counts `EVAL` and the Redis commands called inside the script. Upstash's general pricing is also [per command](https://upstash.com/pricing/redis). The exact count for this script is:

| Outcome                    | Operations                                | Billed commands |
| -------------------------- | ----------------------------------------- | --------------: |
| Allowed                    | `EVAL`, two `GET`, two `SET PX` or `INCR` |               5 |
| Rejected after both checks | `EVAL`, two `GET`                         |               3 |

Using `INCR` followed by `PEXPIRE` for a new key would raise the first request in a window to seven commands. The `SET PX` branch avoids those two extra commands while preserving atomic expiry. This report's capacity uses the five-command form.

The script should begin with Upstash's `allow-key-locking` flag and receive both final key names through `KEYS`. Upstash documents that ordinary Lua scripts take a database-wide lock, while [key-based locking](https://upstash.com/docs/redis/features/key-locking) lets scripts on disjoint keys execute in parallel. Requests that share a source address or OAuth subject still serialize on that hot key. A carrier NAT, campus, or corporate proxy can therefore create both a contention point and a false-positive 30-per-minute source limit.

### Free quota and exhaustion

[Vercel Hobby](https://vercel.com/docs/plans/hobby) includes one million Function invocations, four active CPU hours, and 360 GB-hours of provisioned memory in a 30-day usage period. Vercel says Hobby resources pause at the free limit and that most limits require waiting for the 30-day period to reset. Hobby has no paid spend-management control because it has no automatic paid overage. Upgrading requires choosing a paid plan and payment method. Hobby is limited to personal, non-commercial use under Vercel's [fair-use rules](https://vercel.com/docs/limits/fair-use-guidelines) and [terms](https://vercel.com/legal/terms). A free open-source project qualifies only while its actual use remains non-commercial under those rules.

[Upstash Redis Free](https://upstash.com/pricing/redis) is $0, needs no credit card, and includes 500,000 commands, 10 GB bandwidth, 256 MB data, and 10,000 commands per second. Free has no uptime SLA, multi-zone high availability, access logging, or paid monitoring integrations. Adding a payment method [automatically changes the database to pay as you go](https://upstash.com/docs/redis/howto/upgrade-database), so the owner must not add one. Auto-upgrade must remain disabled. When the monthly request limit is exhausted, commands return [`ERR max requests limit exceeded`](https://upstash.com/docs/redis/troubleshooting/max_requests_limit). The auth handler must translate that failure to a stable `503` before calling Kick.

Upstash describes the quota as monthly and its dashboard as the current billing month, but its public documentation does not state the exact reset timestamp or time zone. That is an operational unknown. It should not be replaced with an assumed UTC reset.

Normal successful traffic reaches the Upstash ceiling at 100,000 token operations because `500,000 / 5 = 100,000`. The same traffic uses only 100,000 of Vercel's one million invocations. Rejected limiter attempts make the ceiling lower because each costs three commands. A mix with `A` allowed and `R` rejected attempts must satisfy:

```text
5A + 3R <= 500,000 Upstash commands per month
A + R + invalid_handler_requests <= 1,000,000 Vercel invocations
```

At 100,000 allowed operations there is no capacity left for a single rejected attempt, a health check that touches Redis, or a manual test. Planning to the published maximum is not operable.

### User capacity at the ceiling

This table converts the model to MAU. The theoretical column spends every Upstash command on successful token operations. The planning column reserves 50% for traffic peaks, limiter rejections, retries, tests, and forecast error. The 50% reserve is an engineering assumption, not a provider guarantee.

| Profile |    Token lifetime | Theoretical MAU at 100,000 operations | Planning MAU at 50,000 operations |
| ------- | ----------------: | ------------------------------------: | --------------------------------: |
| Light   |            1 hour |                                16,611 |                             8,306 |
| Light   | 4, 8, or 24 hours |                                33,113 |                            16,556 |
| Typical |            1 hour |                                 5,540 |                             2,770 |
| Typical | 4, 8, or 24 hours |                                16,529 |                             8,264 |
| Heavy   |            1 hour |                                   925 |                               463 |
| Heavy   |           4 hours |                                 2,770 |                             1,385 |
| Heavy   |           8 hours |                                 4,149 |                             2,075 |
| Heavy   |          24 hours |                                 8,264 |                             4,132 |

Against the required 1,000, 10,000, and 100,000 MAU cases:

- Light traffic fits at 1,000 and 10,000 MAU. It never fits at 100,000 MAU.
- Typical traffic fits at 1,000 MAU. At 10,000 MAU it fits only for the modeled 4-hour or longer lifetimes, and it leaves little room for abuse. It never fits at 100,000 MAU.
- Heavy traffic at 1,000 MAU narrowly exceeds the quota for a 1-hour lifetime and fits the longer sensitivities. It does not fit at 10,000 or 100,000 MAU.

These are service-wide ceilings. Desktop plus Android, multiple devices, forced re-authorization, revoked tokens, and a provider-side lifetime reduction all consume the same quota.

### Burst concurrency is a separate limit

Vercel's published [Function limits](https://vercel.com/docs/functions/limitations) allow up to 30,000 concurrent executions on Hobby. The Hobby plan's configurable maximum duration is [60 seconds](https://vercel.com/docs/plans/hobby). Vercel's [scaling documentation](https://vercel.com/docs/functions/concurrency-scaling) describes a regional ramp of 1,000 concurrent executions per ten seconds. Upstash advertises 10,000 commands per second. At five commands per allowed operation, the database's advertised command rate corresponds to at most 2,000 allowed token requests per second before hot-key contention and latency.

Those technical limits are far above the average rates in the workload table. Synchronized clients can still reach them or spend the monthly quota quickly. For typical 100,000 MAU, 10% of DAU refreshing inside one minute is 33 requests per second. All DAU in that minute is 333 requests per second. Heavy 100,000 MAU produces 67 or 667 requests per second under the same assumptions.

Desktop creates this risk today. Startup and system resume schedule near-expiry refresh immediately, with no random delay. An operating-system wake, application update, or provider outage can align thousands of installations. Vercel can add instances horizontally and Upstash can run disjoint-key scripts concurrently, but neither mechanism spreads the traffic over time. Client-side jitter and server `Retry-After` handling are the controls that reduce the peak. They do not increase monthly free quota.

Cold starts add latency during scale-out. Vercel's paid production prewarming is not part of Hobby, and Hobby runs this service in one region without automatic regional failover. A short token handler should stay far below the duration limit, but it still needs an explicit Kick request timeout. Long provider waits consume concurrent executions and CPU or memory quota even when invocation count is low.

### Retry amplification

Desktop retries transient refresh failures after 30 seconds, 2 minutes, 10 minutes, 45 minutes, and 1 hour, then repeats the one-hour delay. One affected client can make five failed attempts in the first hour and about 28 in the first 24 hours. Ten thousand affected clients can therefore create about 280,000 first-day Function invocations.

This is especially damaging at the Upstash ceiling. After Upstash starts returning its quota error, each retry still enters Vercel before the handler can fail closed. A Redis quota incident can become a Vercel invocation incident. The clients' identical schedule creates repeat waves because it has no jitter. A stable `503`, a bounded `Retry-After`, randomized client backoff, and a circuit breaker before Redis can reduce amplification. A circuit breaker must fail closed and must not call Kick.

### Abuse before application limiting

The application limiter runs inside the Function. These requests consume a Vercel invocation before the two-key check:

- invalid paths or methods routed to the deployment;
- oversized or malformed bodies that reach the handler;
- spoofed requests rejected during schema or redirect validation;
- every request rejected by the application source or subject limit;
- retries after Upstash is unavailable or out of quota.

Vercel WAF can block coarse source-address abuse before a Function invocation. Hobby supports one rate-limit rule, and Vercel's [WAF rate-limit keys](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) include IP address but not the hashed JSON subject. Vercel says denied, challenged, and rate-limited WAF traffic has its [execution charges waived](https://vercel.com/changelog/web-application-firewall-mitigated-traffic-is-free-on-vercel). Requests allowed by that edge rule still spend the Function quota. A source allowed at 30 requests per minute can send 1.296 million requests in 30 days. By rotating the OAuth subject, those allowed requests consume 150 Upstash commands per minute and exhaust the free database in about 2.3 days. The same source exhausts one million Vercel invocations in about 23.1 days.

The handler must derive the address from Vercel's provider-authenticated value. Vercel overwrites [`X-Forwarded-For` with the public client address](https://vercel.com/docs/headers/request-headers#x-forwarded-for), and `ipAddress(request)` exposes parsed geolocation and address data. It must not trust a caller-supplied forwarding prefix. Equivalent provider-authenticated fields are mandatory on any other runtime.

## Existing Cloudflare Workers baseline

[Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) includes 100,000 incoming Worker requests per day. Cloudflare documents no general requests-per-second ceiling. At the daily limit, requests fail with error 1027 until the quota [resets at 00:00 UTC](https://developers.cloudflare.com/workers/platform/limits/). The Free plan requires no card and cannot create paid overages unless the owner upgrades. It also has a 10 ms CPU limit, 128 MB memory, six simultaneous outgoing connections, and 50 subrequests per invocation. Network wait does not count as CPU time.

The daily quota is about three million requests in a smooth 30-day month, but unused capacity does not carry into a burst day. Under the model, it fits light and typical 100,000 MAU for 4-hour or longer tokens. Typical 100,000 MAU with a 1-hour token needs about 60,167 operations per day and also fits. Heavy 100,000 MAU needs about 360,333 per day at 1 hour, 120,333 at 4 hours, 80,333 at 8 hours, and 40,333 at 24 hours. Only the 8-hour and 24-hour cases fit.

Cloudflare's current Rate Limiting binding does not protect that Worker request quota because the Worker must start before calling it. Cloudflare also documents the binding as [local to each data center and eventually consistent](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). It is fast and scales with the edge, but it is not an exact global 30-per-minute or 6-per-minute budget. `CF-Connecting-IP` is the trusted source field at this boundary.

Cloudflare's edge execution and lack of cold starts reduce regional and startup latency. Its limiter's data-center locality is the tradeoff. Moving away from Cloudflare can strengthen the limiter's global atomicity while cutting free request capacity by roughly 30 times in the Vercel and Upstash design.

## AWS capacity and cost baseline

AWS can scale this design well beyond the modeled free traffic. API Gateway's default regional account quota is [10,000 requests per second with a 5,000-request burst](https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html) in most regions. Lambda's default account concurrency is 1,000, one function can add [1,000 execution environments every ten seconds](https://docs.aws.amazon.com/lambda/latest/dg/scaling-behavior.html), and the [maximum invocation duration is 900 seconds](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html). The service must use API Gateway's provider-populated [`requestContext.http.sourceIp`](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html), not a caller's forwarding header. DynamoDB can atomically update the two limiter items. Distinct keys distribute horizontally, while a shared NAT address or attacked subject becomes a hot partition and a product-level 30-per-minute bottleneck.

It does not meet the hard $0 contract:

- Lambda's [one million requests and 400,000 GB-seconds](https://aws.amazon.com/lambda/pricing/) are an ongoing free grant, but usage above them is billed.
- API Gateway's [one-million HTTP API call grant](https://aws.amazon.com/api-gateway/pricing/) is limited to new customers and the introductory period described on the pricing page. It then charges per request.
- Secrets Manager costs [$0.40 per secret-month plus API calls](https://aws.amazon.com/secrets-manager/pricing/), so the credential boundary is not free even at zero traffic.
- AWS Budgets data can lag by [8 to 12 hours](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html). A budget is not a real-time hard cap. AWS's newer project spend limits require a paid-plan limit above $0 and still do not erase already incurred spend.

AWS can throttle or reserve concurrency to contain technical load, but those controls trade away availability and do not turn every dependent service into a permanent free service. CloudWatch ingestion and retention can also bill when detailed logs grow. The stack asks an open-source maintainer to own IAM, infrastructure as code, alarms, quotas, region selection, DynamoDB capacity, secret policy, and rollback.

## Google capacity and cost baseline

Cloud Run's request-based free tier includes [two million requests, 180,000 vCPU-seconds, and 360,000 GiB-seconds](https://cloud.google.com/run/pricing) per billing account each month. Cloud Run supports [up to 1,000 concurrent requests per instance](https://docs.cloud.google.com/run/docs/about-concurrency) and scales instances horizontally. The request timeout can be configured to [60 minutes](https://docs.cloud.google.com/run/docs/configuring/request-timeout), though this service should use a much shorter Kick deadline. Scale-to-zero introduces cold starts. Minimum instances reduce them but can incur cost.

The trusted client-address design from the runtime comparison requires an external Application Load Balancer that [replaces the untrusted forwarding chain](https://docs.cloud.google.com/load-balancing/docs/https#x-forwarded-for_header) and blocks direct service ingress. Its global forwarding rule costs [$0.025 per hour](https://cloud.google.com/load-balancing/pricing), about $18.25 in a 730-hour month before data processing. This alone breaks the $0 rule.

Firestore adds a second free-capacity cliff. Its free quota is [50,000 reads and 20,000 writes per day](https://cloud.google.com/firestore/pricing), reset at midnight Pacific. A transaction that reads and writes both limiter documents uses two reads and two writes for an allowed attempt. The write grant therefore permits at most 10,000 allowed attempts per day before other database work and retries. A shared address or subject also creates transaction contention on one document.

Google Cloud budgets are alerts, not hard caps. The newer [spend cap](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps) can pause eligible Cloud Run workloads after reported spend crosses a target, but reporting delay can produce overage and it does not remove the load balancer's fixed charge. Cloud Logging can also charge beyond its grants. Google is a high-capacity paid baseline, not a guaranteed-zero option.

## Operations at adoption scale

### Regional latency and availability

Vercel Hobby places the Function in one region. The Upstash primary should be in or near that region, otherwise each request crosses regions for the atomic limiter before it calls Kick. A global user still traverses the ingress, Function region, Redis region, and Kick token endpoint. Cloudflare runs near the user, but Kick's undocumented token-endpoint location can still dominate latency. AWS and Google can choose a region, but multi-region state, ingress, and failover add cost and operating work.

Free tiers carry no service-level guarantee for this whole path. Vercel plus Upstash has two independent providers whose outage or quota failure must stop auth. No client secret is exposed, but users cannot connect or refresh until the path recovers.

### Logs and quota visibility

Vercel Hobby retains runtime logs for [one hour and up to 4,000 rows](https://vercel.com/docs/plans/hobby). Upstash Free has dashboard metrics but no access logging or paid monitoring integrations. That is not enough history to reconstruct a night-long refresh storm after the fact. Cloudflare Free includes [200,000 log events per day with three-day retention](https://developers.cloudflare.com/workers/observability/logs/workers-logs/). AWS and Google offer deeper logging, but high-volume ingestion and retention can create charges.

A $0 deployment should emit bounded counters, not one detailed log per request. Required aggregates include allowed, IP-limited, subject-limited, invalid, Redis failure, Kick timeout, Kick error class, handler latency, Redis latency, and deployment version. Logs and traces must never contain an authorization code, refresh token, access token, client secret, request body, or upstream token response.

### Secret rotation and rollback

The owner still has to custody one Kick client secret. At high adoption, rotation can invalidate every token operation at once if deployment and provider changes are sequenced incorrectly. The runbook must stage a tested release, update the hosted secret, verify exchange and refresh, and retain a known-good code deployment. It must never roll back to a revoked secret value merely because it rolls code back.

Vercel environment changes create a new deployment. Hobby can roll production back only to the immediately previous deployment. AWS aliases and Cloud Run revisions have richer traffic controls, but they add configuration and operator work. None of these services rotates the Kick credential automatically or guarantees that Kick accepts an overlap between old and new secrets. That provider behavior needs a controlled runbook assumption, not a guess.

### Maintainer load

The $0 design transfers money risk into availability and operator work. A maintainer must watch two quota systems, keep payment and auto-upgrade settings safe, respond to abuse, rotate credentials, test rollback, manage an outage without support or an SLA, and tell users why auth is unavailable at a quota ceiling. With one-hour Vercel logs, delayed incident discovery may leave little evidence.

At enough adoption the product has four honest choices: stop accepting Kick auth until quotas reset, reduce refresh demand and rate limits with user-visible compromises, keep the higher-capacity Cloudflare Free baseline, or fund a paid service. There is no provider setting that delivers unlimited secure token exchange, an exact global limiter, high availability, and a guaranteed $0 bill.

## What scales and what does not

| Control or component       | Horizontal behavior                                  | Bottleneck or ceiling                                                                                           |
| -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Vercel Functions           | Adds instances and supports concurrent work          | Monthly invocations and compute, regional scale ramp, cold starts, one Hobby region                             |
| Upstash key-locked Lua     | Disjoint IP and subject key pairs run concurrently   | Five commands per allowed request, 500,000 commands/month, 10,000 commands/second, hot shared keys, no Free SLA |
| Client jitter and backoff  | Spreads startup, resume, and retry traffic over time | Does not reduce the number of successful refreshes or raise monthly quota                                       |
| Vercel WAF IP rule         | Blocks coarse abuse before Function execution        | Cannot derive the hashed OAuth subject; one Hobby rule; allowed traffic still consumes quota                    |
| Cloudflare Workers         | Global edge execution, no general RPS limit          | 100,000 requests/day; in-Worker limiter is local and eventually consistent                                      |
| AWS Lambda and API Gateway | High regional request and concurrency quotas         | Paid dependencies and overage, account quotas, DynamoDB hot keys, operator surface                              |
| Cloud Run and Firestore    | Instance concurrency and autoscaling                 | Paid load balancer, daily Firestore writes, transaction hot documents, cold starts                              |

## Evidence for the runtime decision

The runtime choice in issue 118 should use these facts rather than a promised user count:

1. The secure service cannot be unlimited and guaranteed free. Every option has a quota, charge, or both.
2. Vercel Hobby plus Upstash Redis Free can be configured to fail closed without a paid overage. Its theoretical normal-traffic ceiling is 100,000 successful token operations per month, not 500,000 and not one million. A workable ceiling must be lower.
3. That Vercel and Upstash ceiling covers 10,000 light MAU, 10,000 typical MAU only if the token lifetime is at least four hours under this model, and fewer than 10,000 heavy MAU under every lifetime sensitivity.
4. The existing Cloudflare Free service has much more request capacity at $0, about three million smooth monthly requests with a 100,000 daily cliff. Its application limiter is weaker because it is data-center local and eventually consistent.
5. AWS and Google are credible technical scaling paths only after the $0 requirement changes. They must not be described as free production solutions.
6. The owner must choose the failure at the free ceiling. The safe failure is unavailable exchange and refresh, never distributing the Kick secret or bypassing the limiter.

## Audit notes

The Kick documentation was checked at commit [`61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1`](https://github.com/KickEngineering/KickDevDocs/tree/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1). The repository contains no published fixed access-token lifetime at that revision. Workload calculations use 2,592,000 seconds for a 30-day month and round concurrent sessions to the nearest whole session for display. MAU ceilings use the unrounded operations-per-MAU values.

All provider facts above come from first-party pricing, limit, billing, security, or product documentation current on the research date. Promotional credits, temporary open-source grants, and free trials were excluded because they cannot guarantee an owner cost of $0 as adoption grows.
