const fs = require('node:fs');
const file='apps/desktop/scripts/desktop-parity-capabilities.json';
const ledger=JSON.parse(fs.readFileSync(file,'utf8'));
const move=new Map([
 ['packages/core/tests/auth.test.mjs','packages/core/src/features/auth/tests/auth.test.mjs'],
 ['packages/core/tests/chat.test.mjs','packages/core/src/features/chat/tests/chat.test.mjs'],
 ['packages/core/tests/follows.test.mjs','packages/core/src/features/follows/tests/follows.test.mjs'],
 ['packages/core/tests/notifications.test.mjs','packages/core/src/features/follows/tests/notifications.test.mjs'],
 ['apps/worker/tests/index.test.ts','apps/worker/src/features/kick-oauth/tests/worker.test.ts'],
]);
for(const capability of ledger.capabilities) capability.verification=capability.verification.map((value)=>move.get(value)??value);
fs.writeFileSync(file,JSON.stringify(ledger,null,2)+'\n');
