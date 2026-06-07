---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions.
---

<what-to-do>

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

</what-to-do>

<supporting-info>

## Setup (do this BEFORE the first question)

1. **Create the capture file** at `grill-with-docs-designs/{YYYY-MM-DD}-{topic-slug}.md` (create the `grill-with-docs-designs/` folder if it doesn't exist). Every grilling session lives here, regardless of which context it touches. Polished outputs (CONTEXT.md updates, ADRs) land in their own files — the capture file is the raw audit trail.
   - Get today's date with `date +%F` (Bash) if you don't already know it.
2. **Create the file immediately** with a header: title, date, the goal of the session, and an empty "Open flags" section.
3. **Tell the user where you're saving**, in one line. Then ask Q1.

## The checkpoint rule (non-negotiable)

After EVERY user answer, BEFORE you ask the next question:
- Append a structured entry to the capture file: the question topic, the key facts and decisions from their answer (in their words where the wording matters), and any flags (things they couldn't answer plus who should).
- If the answer resolved a term, also update `CONTEXT.md` inline (see below). If it produced an ADR-worthy decision, write the ADR. The brainstorm file still gets the raw entry — CONTEXT.md/ADRs are distilled outputs, not replacements for the log.
- Update or correct earlier entries if a later answer changes them.
- Only then ask the next question.

Never batch multiple answers into one write. Checkpoint one answer at a time.

## Interview method

- Ask **one question at a time**. For each, provide your **recommended answer** (your best inference from context, code, CONTEXT.md, and existing ADRs) so the user can simply confirm, correct, or redirect.
- **Use the `AskUserQuestion` tool** whenever a question has identifiable options or trade-offs to choose between. Structure your recommended answer as the first option (with "(Recommended)" appended), and include 1–3 alternatives as the other options. The user can always pick "Other" for a custom answer. This makes decisions faster and forces you to think through the real alternatives before asking. If `AskUserQuestion` is not available (e.g. running in Codex or another non-Claude-Code environment), present the same options as a numbered list in text with your recommendation marked.
- For **open-ended questions** where there aren't clear options (e.g. "what's the business context for this?" or "walk me through how this works"), ask in regular text — don't force options where none naturally exist.
- Resolve dependencies in order: settle the upstream decision before the ones that depend on it.
- If a question can be answered by **exploring the codebase or reading a file/doc**, do that instead of asking. If the user hands you a doc (e.g. a Google Doc, a spec), read it and only surface what's net-new or contradicts existing CONTEXT/ADRs.
- When the user **can't answer** something, capture it as a flag with the right owner and move on. Don't stall.
- Keep going until the user says you're done, or you've covered every branch. Offer a completeness backstop near the end ("anything we haven't touched?").

## Capture file structure

```
# {Topic}: Grilling Session Notes
Date: {date} · Goal: {one line}

## Summary / key decisions
(running synthesis, updated as you go)

## Q&A log
### Q1 — {topic}
- Asked: {question}
- Captured: {facts, decisions, in their words where it matters}
- Doc updates: {CONTEXT.md term added/changed, ADR-NNNN created, or none}
- Flags: {open item -> owner}
...

## Open flags (pending input)
- {item} -> {who can answer}
```

## Domain awareness

During codebase exploration, also look for existing documentation:

### File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily — only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## Visual companion (for frontend/UI questions)

When a question involves UI layout, component design, navigation, or any visual/spatial decision, create an HTML prototype so the user can **see** the options instead of reading about them. Read [VISUAL-COMPANION.md](./VISUAL-COMPANION.md) for the full guide — it covers when to show vs. stay in text, how to write prototypes, the CSS toolkit, and design tips.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

## At the end

- Do a final read of the capture file for contradictions or gaps and reconcile them.
- Verify CONTEXT.md and any new ADRs match the final state in the capture file (the log is the source of truth during the session).
- Give the user a short recap: what's captured, what was added to CONTEXT.md / ADRs, what's still flagged, and the suggested next step.

</supporting-info>
