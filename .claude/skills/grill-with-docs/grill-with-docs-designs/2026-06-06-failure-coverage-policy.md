# Failure-coverage policy: Grilling Session Notes
Date: 2026-06-06 · Goal: stress-test a plan to make negative-path test coverage stronger (UI components, pages, E2E) and decide whether/how it lands as a policy in `apps/desktop/tests/AGENTS.md`.

## Summary / key decisions
- **Policy shape**: sharpen the existing Keep/Rewrite/Delete bar in `tests/AGENTS.md`. No new section header, no separate ADR. Tighter language + concrete failure-path examples added inline to the existing Verdicts + `// Guards:` sections.
- **Failure buckets in scope**: (1) **Async lifecycle** — loading + error + empty (the React Query trifecta). (2) **Failure injection** — explicit HTTP error / timeout / abort at the service/hook/IPC layer. Edge-input tests stay out of scope (typecheck + existing schema-pin tests cover). Concurrency/race stays under the existing R7 regression-on-bug rule, not a blanket requirement.
- **Minimum bar per layer**: **same bar for components + pages** — if the layer observably renders distinct UI for loading/error/empty, assert each one. Pages mock a deeper hook stack (React Query, electronAPI, route params) but the bar matches. Backend services keep their existing strong bar. Hooks assert the **consumer-visible side effect** of failure (toast queued, retry scheduled, state flipped), not just "hook returned error".
- **Enforcement scope**: **Forward + critical-path backfill**. New PRs that add/touch a component or page in the affected layers must meet the bar. Backfill the bar for components + pages on the five locked critical flows (Login + auth state, Watching followed streams, Chat with emotes, Multistream, Search→category→stream) by folding into the existing planned **U18** batch. Non-critical components get the bar only when next touched. Mirrors the audit's R11 critical-path routing rule.
- **Enforcement mechanism**: **reviewer attention + extended `// Guards:` convention.** No CI gate, no vitest reporter threshold. The existing `// Guards:` rule extends so each guarded async state gets its own line (e.g. `// Guards: loading state renders skeleton, not blank`, `// Guards: error state surfaces toast on Helix 5xx`). Greppable for audits without adding lint infrastructure that bit-rots. Same precedent as the existing PR-touch rule on `// Guards:` comments.
- **Trigger**: bar applies to any component/page that **observably renders distinct UI for any of {loading, error, empty}**. Source-readable behavior, not hook-specific. A `<Button>` with no such branch is exempt. A leaf card that receives `isLoading` via prop and renders a skeleton is in scope (catches the prop-driven case that "only `useQuery`" rules miss).
- **E2E (playbook) layer**: each U18 playbook extension already in the audit's punch list (02-following, 05-search-results, 06-stream, 09-multistream, 12-settings) must include **one failure-injection scenario** in addition to its existing happy-path deepening — e.g., "06-stream: while watching, kill the network; assert chat reconnect banner and player retry". Stays inside debug-electron-mcp; no Playwright re-introduction (would contradict U0).
- **Prioritization list home**: AGENTS.md stays timeless (bar + trigger + guards convention only). The ranked per-component / per-page list lives in two places: (1) this session's capture file as the canonical artifact, (2) a new U18 subsection appended to `docs/test-audit/2026-05-19-audit-log.md` so the U18 executor has a definitive punch list.

## Q&A log

### Q1 — Policy shape
- Asked: should the failure-coverage policy be a sharpening of the existing Keep/Rewrite/Delete bar, a parallel new rule, or an ADR?
- Captured: **Sharpen the existing bar.** Lowest friction; aligns with file's current structure. New rule writing extends the existing Verdicts + Guards sections rather than creating a parallel one.
- Doc updates: none yet — wait until the *content* of the sharpening is decided (Q2 onward), then edit `tests/AGENTS.md` in one inline pass.
- Flags: none.

### Q2 — Failure buckets in policy scope
- Asked: which categories should the sharpened bar treat as "failure paths"?
- Captured: in scope = **Async lifecycle (loading + error + empty)** + **Failure injection (HTTP error / timeout / abort)**. Out of scope = edge inputs (already covered by typecheck + GQL-shape pinning) and concurrency/race (stays under the existing R7 regression-on-bug rule).
- Doc updates: pending — will be reflected in the AGENTS.md sharpening once the minimum bar per layer is settled.
- Flags: none.

### Q3 — Minimum bar per layer
- Asked: should component + page have the same loading/error/empty bar, an asymmetric bar, or a behavior-counted bar?
- Captured: **same bar for component + page** — both must assert loading + error + empty when those states render distinct UI. Backend services keep their existing bar. Hooks must assert the consumer-visible side effect (toast, retry, state flip), not just "hook returned error".
- Doc updates: pending — folds into the AGENTS.md sharpening.
- Flags: none.

### Q4 — Enforcement scope
- Asked: forward-only, forward + critical-path backfill, separate backfill batch, or opportunistic-on-touch?
- Captured: **Forward + critical-path backfill, folded into the existing planned U18 batch.** Non-critical components get the bar when next touched. Aligns with the audit's R11 critical-path routing rule. Avoids the multi-week "fix every card/grid/dialog" yak-shave.
- Doc updates: AGENTS.md sharpening will reference U18 + the five locked critical flows already pinned in the audit log.
- Flags: U18 is currently outside this session's scope per the audit log — confirm with the user later that "fold failure-coverage backfill into U18" is acceptable scope expansion to that batch (vs splitting out a U20).

### Q5 — Enforcement mechanism
- Asked: pure reviewer attention, prose-only, vitest reporter check, or grep-based CI check?
- Captured: **Reviewer attention + extended `// Guards:` convention.** One Guards line per async state guarded. Mirrors the existing PR-touch convention; no new CI infrastructure. Greppable for audits.
- Doc updates: AGENTS.md sharpening will add concrete `// Guards:` examples covering the three async states + a failure-injection example, plus extend the existing PR-touch rule to mention failure-state guards.
- Flags: none.

### Q6 — Trigger / scope of applicability
- Asked: when does the bar apply to a given component or page?
- Captured: **bar applies when the component/page observably renders distinct UI for any of {loading, error, empty}.** Behavior-based, source-readable. Catches prop-driven children (StreamCard/StreamGrid pattern) the "only useQuery" rule misses. Pure `<Button>`-style components are exempt.
- Doc updates: AGENTS.md sharpening will include this trigger definition verbatim as the "When the bar applies" line.
- Flags: none.

### Q7 — E2E (playbook) layer
- Asked: address E2E in this policy, stay silent, or re-introduce Playwright?
- Captured: **each U18 playbook extension must include one failure-injection scenario** in addition to its happy-path deepening. Stays under debug-electron-mcp; preserves U0's Playwright-removal decision.
- Doc updates: AGENTS.md sharpening references U18 playbook extensions; the playbook layer of the policy is a one-line clause, not a section.
- Flags: list of the five extension-targeted playbooks is already in the audit log; no new flag.

### Q8 — Prioritization list home
- Asked: where does the per-component blast-radius ranking live?
- Captured: **capture file + audit-log U18 subsection**. AGENTS.md stays timeless. U18 executor gets a definitive punch list in the audit log; the capture file is the artifact of record.
- Doc updates: this session's capture file will get a ranked list (next section); the audit log gets a new U18 punch list appended.
- Flags: none.

## U18 punch list — blast-radius ranking (session artifact)

Canonical per-component table lives in [`docs/test-audit/2026-05-19-audit-log.md`](../../../../docs/test-audit/2026-05-19-audit-log.md) under "Failure-coverage punch list (U18)". The summary below is the ranking rationale.

| Tier | Surface | Why this rank | Components / pages |
|------|---------|---------------|--------------------|
| 1 | Chat | Silent fail = streamer looks silent. No bug report; user leaves. Highest blast. | ChatPanel, ChatMessageList, EmoteImage, ChatEmote, ChatBadge, PinnedMessageBanner, PredictionBanner, KickChat, TwitchChat |
| 2 | Followed streams | Silent fail = "you follow no one" when you actually do — user panic / account-distrust. | Following page, SidebarFollows, stream-grid, stream-card, featured-stream |
| 3 | Discovery (Search→category→stream) | Silent fail blurs "no results" with "search broke". Includes Stream-page offline-vs-error distinction. | SearchResults page, UnifiedSearchInput, Categories page, CategoryDetail page, category-grid, category-card, Stream page |
| 4 | Login + auth state | User actively triggers — failure usually visible. Still in critical-flow lock. | AuthProvider, LoginDialog, AccountConnect, ReconnectForModDialog |
| 5 | Multistream | Optional power feature, lowest blast. Cross-slot isolation is the load-bearing assertion. | MultiStream page, add-stream-dialog, stream-slot, grid-layout |

Playbook failure-injection list (5 entries) lives in the same audit-log section. Forward-enforcement on non-tier components starts under the AGENTS.md sharpening — this list is for backfill only.

## Deliverables produced this session

1. **`apps/desktop/tests/AGENTS.md`** — sharpened in 4 places:
   - "THE QUALITY BAR" intro: added the "Failure paths count as regression classes" paragraph (trigger + per-layer bar + hook side-effect rule + forward+backfill scope).
   - `// Guards:` examples: added an async-state example block (Following page).
   - PR-touch rule for `// Guards:`: extended to cover failure-state guard lines.
   - "Don't" section: added a bullet against shipping a Keep test for an async-state component without asserting each branch.
2. **`docs/test-audit/2026-05-19-audit-log.md`** — appended `## Failure-coverage punch list (U18) — added 2026-06-06` between the Critical Flow Triage and Batches sections. 5 tiers (chat, followed streams, discovery, login, multistream) + playbook layer + execution notes.
3. **This capture file** — full Q&A log + ranking summary.

## Open flags (pending input)
- Confirm that **U18** is the right host for the critical-path failure-coverage backfill (vs spawning a U20). → owner: DarkSkyXD.
- Confirm prioritization order (Chat → Following → Discovery → Login → Multistream) matches the user's intuition of "what breaks if it silently fails". → owner: DarkSkyXD.
