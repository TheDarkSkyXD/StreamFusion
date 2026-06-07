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

- BEFORE writing any tests or implementation code, invoke the `/tdd` skill to drive the work test-first (red → green → refactor, one vertical slice at a time). Do not write tests in bulk up front or after the code is done.
- Tests are written first, drive the implementation, and are green by construction by the time the issue is finished — `/tdd` is a start-of-work skill, not a post-hoc verification step.
- All tests MUST pass with zero errors before you mark an issue as completed.
- Do NOT move to the next issue until the current issue's tests are green.
- If tests fail mid-cycle, get back to GREEN before refactoring or moving on.

## UI DESIGN

- Always follow the UI design system when creating or reviewing components or pages.
- Design System: @DESIGN.md
- If the project does NOT have a frontend ignore this.
- if the project has a frontend then make a DESIGN.md file if there is no DESIGN.md file.
