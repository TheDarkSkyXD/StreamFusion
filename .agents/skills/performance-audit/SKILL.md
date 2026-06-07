---
name: Performance Audit
description: "Audit and optimize application, database, and infrastructure performance. Profiles code, identifies bottlenecks, analyzes load patterns, tunes databases and infrastructure, implements caching strategies, runs load tests, and delivers before/after metrics with capacity planning recommendations."
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

# Performance Audit

Systematic performance audit covering application profiling, database optimization, infrastructure tuning, caching, load testing, scalability, and monitoring. Measure first, optimize second, verify third.

## When to Use

- Response times or throughput are below targets or SLAs
- Users report slowness, timeouts, or degraded experience
- Preparing for traffic spikes, launches, or scaling events
- Reviewing performance before a major release
- Investigating resource exhaustion (CPU, memory, I/O, connections)
- Establishing performance baselines for a new system
- Capacity planning for growth projections

## Workflow

### Step 1 — Gather Context

Before measuring anything, understand the system:

1. Ask the user for SLAs, performance targets, and known pain points
2. Review the system architecture — services, databases, caches, queues, CDNs
3. Identify the critical paths and user-facing operations to focus on
4. Determine current load patterns — peak hours, request volume, growth rate
5. Check what monitoring and profiling tools are already in place

### Step 2 — Establish Baselines

Measure current performance before changing anything:

1. Capture response times (p50, p95, p99) for key endpoints and operations
2. Measure throughput (requests per second, transactions per second)
3. Record error rates and timeout frequencies
4. Document resource utilization — CPU, memory, disk I/O, network bandwidth
5. Check connection pool usage, queue depths, and cache hit ratios
6. Record the measurement methodology so results are reproducible
7. Report baseline numbers to the user before proceeding

### Step 3 — Identify Bottlenecks

Work through each layer systematically. Investigate every hit before moving on:

**Application Profiling**

| Check | What to Look For |
|-------|-----------------|
| Code hotspots | Functions consuming disproportionate CPU time |
| Method timing | Slow methods in the critical path |
| Memory allocation | Excessive object creation, large allocations per request |
| Garbage collection | Long GC pauses, high GC frequency, memory pressure |
| Thread analysis | Thread contention, deadlocks, thread pool saturation |
| Async operations | Blocking calls on async threads, unresolved promises, callback storms |
| Library performance | Third-party code dominating profiles |

**Database Analysis**

| Check | What to Look For |
|-------|-----------------|
| Query analysis | Slow queries via `EXPLAIN ANALYZE`, missing WHERE clauses |
| Index optimization | Full table scans, unused indexes, missing composite indexes |
| Execution plans | Nested loops where hash joins would be faster, sort spills |
| Connection pooling | Pool exhaustion, connection churn, idle connection waste |
| Cache utilization | Query cache hit ratio, prepared statement reuse |
| Lock contention | Row locks, table locks, deadlock frequency |
| Partitioning | Large tables without partitioning, hot partitions |
| Replication lag | Stale reads from replicas, replication queue depth |

**Infrastructure**

| Check | What to Look For |
|-------|-----------------|
| CPU profiling | Sustained high utilization, CPU steal (VMs), scheduling delays |
| Memory analysis | Swap usage, OOM kills, memory fragmentation |
| I/O investigation | Disk IOPS limits, write-ahead log bottlenecks, storage latency |
| Network latency | DNS resolution time, TCP connection overhead, cross-region calls |
| OS kernel parameters | File descriptor limits, TCP buffer sizes, connection tracking |
| Container limits | CPU throttling, memory limits too tight, noisy neighbors |
| VM tuning | Instance type mismatch, NUMA awareness, storage type |
| Cloud instance sizing | Over-provisioned (wasting money) or under-provisioned (throttling) |

**Caching**

| Check | What to Look For |
|-------|-----------------|
| Application cache | Missing in-memory cache for repeated computations |
| Database cache | Query cache disabled or misconfigured |
| CDN utilization | Static assets not cached, low CDN hit ratio |
| Redis/Memcached | Eviction rate, memory fragmentation, connection overhead |
| Browser caching | Missing Cache-Control headers, no ETags, no versioned URLs |
| API caching | Repeated identical API calls without caching layer |
| Cache invalidation | Stale data served, over-aggressive invalidation |

**Concurrency & Resource Contention**

| Check | What to Look For |
|-------|-----------------|
| Thread contention | Lock waits, synchronized bottlenecks, mutex starvation |
| Resource locks | File locks, distributed locks held too long |
| Connection pools | HTTP client pools, DB pools, Redis pools exhausted |
| Queue depths | Message queues backing up, consumer lag |
| Async bottlenecks | Event loop blocking, threadpool starvation |

### Step 4 — Implement Optimizations

For each bottleneck found, fix and verify:

1. Explain the problem and expected impact to the user
2. Implement the optimization
3. Re-measure the same baseline metric
4. Record the before/after delta

**Optimization techniques to apply as needed:**

| Category | Techniques |
|----------|-----------|
| **Algorithm** | Better time complexity, early exits, reduced iterations |
| **Data structures** | HashMap over linear search, Set for membership, sorted structures for range queries |
| **Batching** | Batch DB writes, batch API calls, bulk inserts |
| **Lazy loading** | Defer expensive initialization, load on demand |
| **Connection pooling** | Reuse DB connections, HTTP keep-alive, Redis pipelining |
| **Resource pooling** | Thread pools, worker pools, object pools for expensive allocations |
| **Compression** | Gzip/Brotli responses, compressed storage, protocol buffers |
| **Protocol optimization** | HTTP/2 multiplexing, WebSocket for streaming, gRPC for internal services |
| **Async processing** | Move work to background queues, async I/O, event-driven processing |
| **Code optimization** | Hoist invariants out of loops, reduce allocations, cache computed values |
| **Query tuning** | Add indexes, rewrite joins, denormalize hot paths, use covering indexes |
| **Caching implementation** | Add Redis/Memcached layer, in-memory LRU, CDN for static assets |

### Step 5 — Load Test

Validate optimizations under realistic load:

**Test Types**

| Test | Purpose | How |
|------|---------|-----|
| **Load test** | Verify performance under expected peak traffic | Ramp to expected peak, sustain for 10+ minutes |
| **Stress test** | Find the breaking point | Ramp beyond peak until errors or degradation appear |
| **Spike test** | Validate behavior under sudden traffic bursts | Jump from normal to 5-10x load instantly |
| **Soak test** | Catch memory leaks and resource exhaustion | Sustain moderate load for hours |
| **Volume test** | Test with large datasets | Fill databases to projected 12-month size |
| **Scalability test** | Verify horizontal/vertical scaling works | Add/remove instances under load, measure throughput linearity |

**Load Test Checklist**

- [ ] Test environment matches production (or scale ratios documented)
- [ ] Realistic user scenarios with think time between requests
- [ ] Gradual ramp-up — don't spike from 0 to max
- [ ] Monitor both client-side metrics AND server-side resources during the test
- [ ] Test beyond expected peak (2-3x) to find the breaking point
- [ ] Run soak tests (sustained load over hours) to catch leaks
- [ ] Document results with timestamps, configuration, and environment details
- [ ] Compare results against baselines from Step 2

### Step 6 — Scalability Verification

Confirm the system can handle growth:

| Question | If No, Then |
|----------|-------------|
| Can you add instances behind a load balancer? | Identify and remove sticky state, session affinity |
| Does the database handle 3x current write volume? | Plan read replicas, sharding, or write batching |
| Are background jobs decoupled from request handling? | Move to async queues (SQS, RabbitMQ, Redis streams) |
| Can the system degrade gracefully under overload? | Add circuit breakers, rate limiting, bulkheads |
| Are hot paths stateless? | Move state to external stores (Redis, DB) |
| Do auto-scaling policies respond fast enough? | Tune scaling triggers, add predictive scaling |
| Is the load balancer distributing traffic evenly? | Check algorithm, health checks, sticky sessions |
| Can the system shard data across nodes? | Design partition keys, implement consistent hashing |

### Step 7 — Set Up Monitoring

Ensure ongoing visibility:

| Monitoring Type | What It Covers |
|----------------|---------------|
| **Real user monitoring (RUM)** | Actual user experience — page loads, interactions, errors |
| **Synthetic monitoring** | Proactive checks from external locations on a schedule |
| **APM integration** | Distributed tracing, transaction breakdown, error tracking |
| **Custom metrics** | Business-specific KPIs — checkout time, search latency, upload speed |
| **Alert thresholds** | Alerts on p95 latency, error rate, resource saturation |
| **Dashboards** | At-a-glance view of SLIs, resource usage, traffic patterns |
| **Trend analysis** | Week-over-week comparisons to catch gradual degradation |
| **Capacity planning** | Projected resource needs based on growth rate |

### Step 8 — Report Results

Always deliver a structured report:

**1. Summary** — What was audited, overall health assessment, key numbers

**2. Findings Table**

```
| Issue Found              | Fix Applied                | Before   | After    | Improvement |
|--------------------------|----------------------------|----------|----------|-------------|
| N+1 query in /api/list   | Batch query with IN()      | 340ms    | 45ms     | 87%         |
| No index on orders.uid   | Added composite index      | 1.2s     | 18ms     | 98%         |
| Sync file read in loop   | Switched to async stream   | 890ms    | 120ms    | 87%         |
```

**3. Load Test Results** — Peak throughput, breaking point, resource usage at peak

**4. Remaining Risks** — Issues that couldn't be fixed now, with severity ratings

**5. Capacity Plan** — Growth projections, when scaling actions are needed, cost estimates

**6. Recommendations** — Monitoring to add, follow-up optimizations, architectural changes for the roadmap

## Common Anti-Patterns Reference

Check for these first — they account for the majority of performance issues:

| Anti-Pattern | Symptom | Fix |
|-------------|---------|-----|
| **N+1 queries** | DB call count scales with result size | Batch with IN(), use JOINs, eager load |
| **Missing indexes** | Slow queries with full table scans | Add indexes on filtered/joined/sorted columns |
| **Synchronous blocking** | Event loop or main thread stalls | Move to async I/O, offload to workers |
| **No connection pooling** | New connection per request, high latency | Configure pools for DB, HTTP, Redis |
| **Unbounded queries** | `SELECT *` without LIMIT, fetching entire tables | Paginate, project only needed columns |
| **Memory leaks** | Growing heap, eventual OOM | Close resources, remove listener accumulation, add cache eviction |
| **Cache misses** | Same expensive computation repeated | Add caching layer with appropriate TTL |
| **Excessive serialization** | Large objects serialized on every request | Serialize once and cache, reduce payload size |
| **Uncompressed responses** | Large payloads, high bandwidth usage | Enable gzip/brotli compression |
| **Cold starts** | First request slow, no connection warming | Pre-warm pools, eager init in startup |
| **Connection pool exhaustion** | Requests queuing, timeouts under load | Tune pool size, add connection timeout, fix leaks |
| **Inefficient algorithms** | O(n²) or worse in hot paths | Replace with better data structures or algorithms |
| **Resource contention** | Threads waiting on locks, throughput plateaus | Reduce lock scope, use lock-free structures, partition work |
| **Network chattiness** | Many small round trips instead of batched calls | Batch APIs, use multiplexing, co-locate services |

## Caching Strategy Reference

| Cache Layer | Best For | Invalidation Strategy |
|-------------|---------|----------------------|
| **Browser** (Cache-Control) | Static assets, infrequently changing API responses | TTL-based, versioned URLs, ETags |
| **CDN** | Public content, geographic distribution | Purge API, surrogate keys, stale-while-revalidate |
| **Application** (in-memory LRU) | Computed values reused within a process | TTL, LRU eviction, size limits |
| **Redis/Memcached** | Shared cache across instances, sessions, rate limits | TTL, explicit delete on write, pub/sub invalidation |
| **Database** (query cache) | Repeated identical read queries | Automatic on table write, manual flush |
| **API gateway** | Rate-limited external API responses | TTL matching API rate limits |

## Capacity Planning Reference

| Input | How to Gather | What It Tells You |
|-------|--------------|-------------------|
| Current traffic volume | APM, load balancer logs, analytics | Baseline for projections |
| Growth rate | Month-over-month metrics, business forecasts | When you'll hit limits |
| Resource headroom | Current utilization vs. provisioned capacity | How much runway you have |
| Cost per unit | Cloud billing, resource pricing | Scaling cost curve |
| Performance budgets | SLA targets, user experience goals | When to act (thresholds) |
| Seasonal patterns | Historical traffic data, marketing calendar | When to pre-scale |
