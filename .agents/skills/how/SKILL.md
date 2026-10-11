---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Each spawn below names a role line in `.agents/superdev-models.md` and a default. Use only high-reasoning, standard-speed model variants. Set `model` to that line's value, or to the default if the map or line is missing. Leave `model` unset for `auto` or `inherit-parent` only when the parent uses high reasoning at standard speed. If the delegation interface rejects a configured slug, use the default and say so. If it rejects the default, use a detected high-reasoning, standard-speed slug; if none is available, report that the role cannot run under the configured policy.

## Step 1. Assess Complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. One explainer explores and explains in a single pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): spawn parallel explorers first, then hand off to the explainer. Go to Step 2a.

When in doubt, take the simple path.

## Step 2a. Explore (complex questions only)

Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem. Spawn all explorers in a single message:

- Worker: general-purpose subagent through the active harness's delegation interface
- `model`: the `how explorer` line, default `grok-4.7-high`
- `readonly`: `true`

Each explorer gets the prompt in `references/explorer-prompt.md` with its angle filled in. Then go to Step 3.

## Step 2b. Direct Explain (simple questions)

Spawn one general-purpose subagent through the active harness's delegation interface that explores and explains in one pass:

- Worker: general-purpose subagent through the active harness's delegation interface
- `model`: the `how explainer` line, default `claude-opus-5-5-high`
- `readonly`: `true`

Build its prompt from `references/explainer-prompt.md` without the explorer-findings section. Go to Step 4.

## Step 3. Synthesize (complex questions only)

Once all explorers have returned, spawn one general-purpose subagent through the active harness's delegation interface to synthesize their findings into one explanation:

- Worker: general-purpose subagent through the active harness's delegation interface
- `model`: the `how explainer` line, default `claude-opus-5-5-high`
- `readonly`: `true`

Build its prompt from `references/explainer-prompt.md` with every explorer's findings filled in.

## Step 4. Present

Present the explainer's output to the user. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output Format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
