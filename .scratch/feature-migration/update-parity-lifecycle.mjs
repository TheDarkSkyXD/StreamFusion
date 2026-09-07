import fs from 'node:fs';
const path='apps/desktop/scripts/desktop-parity-capabilities.json';
const ledger=JSON.parse(fs.readFileSync(path,'utf8'));
const chat=ledger.capabilities.find(entry=>entry.state.includes('state-store:store/chat-store'));
if(!chat)throw new Error('Chat capability not found');
const fact='state-store:store/chat-channel-lifecycle';
if(!chat.state.includes(fact))chat.state.push(fact);
fs.writeFileSync(path,JSON.stringify(ledger,null,2)+'\n');
