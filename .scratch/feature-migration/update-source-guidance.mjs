import fs from 'node:fs';
const hooks='apps/desktop/src/frontend/hooks/AGENTS.md';
fs.writeFileSync(hooks,`# Shared renderer hooks

This directory owns only capability-neutral React hooks: \`useAfterFirstPaint\`,
\`useDebounce\`, \`useInterval\`, \`useManagedTimeout\`, \`useMediaQuery\`, and \`useTimeout\`.
Feature presentation hooks belong in \`frontend/features/<feature>/components/\`.
Runtime APIs belong in the owning feature's adapters, behind typed capabilities.

- Store the latest timer callback in a ref so callback changes do not restart timers.
- Unsubscribe listeners and cancel timers when a hook unmounts or its resource changes.
- Cancel asynchronous work, or ignore stale results before updating state.
- Use narrow Zustand selectors. Avoid allocating a new selected object every render.
- Keep provider/network queries and their keys with the feature. Shared hooks must not
  import a feature merely to supply a default dependency.
- Do not recreate the deleted hooks barrel or feature forwarding modules here.
`);
const chat='apps/desktop/src/frontend/features/chat/components/chat/AGENTS.md';
let text=fs.readFileSync(chat,'utf8');
text=text.replace('Does NOT own WebSocket/IRC connections (`backend/services/chat/`), emote fetching (`backend/services/emotes/` + `store/emote-store`), platform API calls (`backend/api/platforms/`), or global state stores (`store/`).','Browser transports and emote integrations belong in this feature’s `adapters/`; main-owned HTTP and credential integrations belong in backend features. View stores live under `components/state/`, and pure message rules live in `domain/`.');
text=text.replace('Keep backend calls inside `KickChat.tsx` or `TwitchChat.tsx` event handlers, not in shared components.','The orchestrators invoke typed feature capabilities wired by composition. Keep provider and preload operations in adapters.');
text=text.replace('- Never import from `backend/api/` or `backend/services/` in shared components (`ChatMessage`, `ChatBadge`, etc.) — only in `KickChat.tsx` and `TwitchChat.tsx`','- Never import backend implementations in renderer components, including `KickChat.tsx` and `TwitchChat.tsx`.');
text=text.slice(0,text.indexOf('## Related Context'))+`## Related Context

- \`../../../../AGENTS.md\` — renderer feature responsibility boundaries
- \`../../state/\` — chat and emote view state
- \`../../../adapters/browser/\` — browser chat transports and emote providers
- \`../../../capabilities/\` — provider-neutral operation contracts
`;
fs.writeFileSync(chat,text);
const tests='apps/desktop/tests/AGENTS.md';
text=fs.readFileSync(tests,'utf8');
const start=text.indexOf('## STRUCTURE');const end=text.indexOf('## RUNNING',start);
text=text.slice(0,start)+`## STRUCTURE

Feature unit, component, route, and service tests live with their owning runtime:
\`src/{frontend,backend}/features/<feature>/tests/\`. Feature fixtures and Storybook
stories live there too. Test location does not change its execution environment:
the Node/jsdom projects in \`vitest.config.ts\` preserve explicit DOM exceptions.

This directory retains shared test setup, helpers, policy/build-script checks,
shared-contract tests, and cross-feature or cross-process integration tests.
Use \`setup-node.ts\`, \`setup.ts\`, and \`test-utils.tsx\` for shared infrastructure.
E2E instructions remain in \`tests/e2e/README.md\`.

`+text.slice(end);
fs.writeFileSync(tests,text);
