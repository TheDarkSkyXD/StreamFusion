# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## 5. Use Compound Engineering For The Development Process

**The compound-engineering plugin is the default workflow for non-trivial work on this repo.**

Route work through the `/ce-*` slash commands rather than hand-rolling each step:

- **Set product direction:** `/ce-strategy`
- **Generate / evaluate ideas:** `/ce-ideate`
- **Explore and shape scope into requirements:** `/ce-brainstorm`
- **Turn an idea into a detailed plan:** `/ce-plan`
- **Execute the plan with task tracking + worktrees:** `/ce-work` (or `/lfg` for the full hands-off plan → work → review → commit → PR → CI loop)
- **Debug failures by root cause:** `/ce-debug`
- **Multi-agent code review before merging:** `/ce-code-review`
- **Capture learnings after solving something tricky:** `/ce-compound`
- **Usage / performance pulse over a time window:** `/ce-product-pulse`
- **Initialize the plugin in a new project:** `/ce-setup`

Trivial one-line fixes, lookups, and questions do not need to route through these commands — use judgment.

### If the plugin is missing

If the `/ce-*` commands are not available in the current session, the user does not have the plugin installed. Tell them:

> The compound-engineering plugin isn't installed. It's at https://github.com/EveryInc/compound-engineering-plugin. In Claude Code, run:
>
> ```
> /plugin marketplace add EveryInc/compound-engineering-plugin
> /plugin install compound-engineering
> ```
>
> Want me to walk you through it?

If they're on a different harness (Cursor, Codex, GitHub Copilot CLI, Factory Droid, Qwen Code), fetch the README at the repo URL and follow the documented install steps for that environment — don't guess install commands.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
