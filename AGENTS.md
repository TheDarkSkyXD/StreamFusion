# CRITICAL RULES - MUST FOLLOW

## RESPONSES

- Keep responses concise and to the point - unless the user asks otherwise

## PLANNING MODE

- Always ask clarifying questions
- Never assume design, tech stack or features
- Use deep-dive sub-agents to assist with research
- Use deep-dive sub-agents to review the different aspects of your plan before presenting to the user
- Grill the user on design and requirements, do not make any assumptions.

## CHANGE / EDIT MODE

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

- Never implement features yourself when possible - use sub-agents!
- Identify changes from the plan that can be implemented in parallel, and use sub-agents to implement the features efficiently
- When using sub-agents to implement features, act as a coordinator only
- Use the best model for the task - premium models for complex tasks (like coding) and mid-tier models for simpler tasks, like documentation
- After completing features (large or small), always run commands like lint, type check and next build to check code quality
- ALWAYS Use the deslop skill before committing any code to github.


## DATABASE SCHEMA CHANGES


## TESTING

- Use any testing tools, libraries available to the project for testing your changes
- Never assume your changes simply work, always test!
- If the project does not have any testing tools, scripts, MCP tools, skills, etc. available for testing, ask the user whether testing should be skipped.

## ISSUE WORKFLOW

A complete issue lifecycle is five stages. Don't skip stages or merge them — each one has a distinct purpose.

### 1. Pick up an issue

- Read the project's issue tracker (per `docs/agents/issue-tracker.md`, set by `/setup-skills`). Filter by the `ready-for-agent` triage label (GitHub: `gh issue list --label ready-for-agent`; local-markdown: look for `Status: ready-for-agent` near the top of issue files under `.scratch/<feature-slug>/` or `.scratch/grill-with-docs/<session>/issues/`).
- Respect `Blocked by` dependencies — only pick issues whose blockers are closed/done.
- Honor the AFK vs HITL classification. AFK issues can be implemented end-to-end autonomously. HITL issues require a human decision before starting — ask the user before proceeding.

### 2. Read the issue

- The `What to build` section is the scope. Stay inside it.
- The `Acceptance criteria` checkbox list IS the test list — `/tdd` will drive each criterion as a behavior, one at a time.
- Each issue is a vertical slice (a thin end-to-end path through all integration layers). Do NOT subdivide it into horizontal layers (schema first, then API, then UI).

### 3. Drive the implementation with `/tdd`

- BEFORE writing any tests or implementation code, invoke the `/tdd` skill. It drives the work test-first (red → green → refactor) one acceptance criterion at a time.
- One criterion → one test → minimal implementation to pass → next criterion. Never write tests in bulk up front or after the code is done.
- Never refactor while RED. Get to GREEN first.
- After all tests are green, run `/tdd`'s Refactor phase (extract duplication, deepen modules, apply SOLID where natural). Re-run tests after each refactor step.

### 4. Quality gates before marking done

- All tests MUST pass with zero errors.
- Run `/deslop` on the diff (already mandated by Change/Edit Mode, repeated here for the issue lifecycle).
- Lint, type-check, and build all pass.
- UI/frontend issues: verified manually in a browser. Type-checking and tests are not sufficient for UI work.

### 5. Close the issue

- Update the tracker: GitHub → `gh issue close <number>` referencing the commit; local-markdown → set `Status: done` near the top of the issue file and append closing notes under the `## Comments` heading.
- Commit with a reference to the issue (`Closes #123` for GitHub, or the issue file path for local-markdown).
- Only then pick the next `ready-for-agent` issue and return to Stage 1.

## UI DESIGN

- Always follow the UI design system when creating or reviewing components or pages.
- Design System: @DESIGN.md
- If the project does NOT have a frontend ignore this.
- if the project has a frontend then make a DESIGN.md file if there is no DESIGN.md file.
