const fs = require('node:fs');
const file = 'apps/desktop/scripts/desktop-parity-capabilities.json';
let source = fs.readFileSync(file, 'utf8');
for (const [from, to] of JSON.parse(fs.readFileSync('.scratch/parity-path-changes.json', 'utf8'))) {
  source = source.replaceAll(JSON.stringify(from), JSON.stringify(to));
}
source = source.replace(
  '"state-store:store/chat-store",\n        "state-store:store/room-state-store",',
  '"state-store:store/chat-store",\n        "state-store:store/multi-chat-feed",\n        "state-store:store/room-state-store",'
);
source = source.replace(
  '"id": "live-playback",\n      "area": "Playback",\n      "outcome": "Open and watch live Twitch and Kick streams.",\n      "entry": ["/stream/$platform/$channel"],\n      "renderer": ["renderer-feature:playback", "route:/stream/$platform/$channel"],\n      "electronBoundary": ["ipc-feature:playback"],\n      "mainProcess": [],',
  '"id": "live-playback",\n      "area": "Playback",\n      "outcome": "Open and watch live Twitch and Kick streams.",\n      "entry": ["/stream/$platform/$channel"],\n      "renderer": ["renderer-feature:playback", "route:/stream/$platform/$channel"],\n      "electronBoundary": ["ipc-feature:playback"],\n      "mainProcess": ["ipc-handler:stream-playback-handlers"],'
);
source = source.replace(
  '"ipc-handler:timeout-moderation-handlers",\n        "ipc-handler:twitch-api-handlers"',
  '"ipc-handler:timeout-moderation-handlers",\n        "ipc-handler:twitch-eventsub-handlers",\n        "ipc-handler:twitch-api-handlers"'
);
source = source.replace(
  '"ipc-handler:storage-handlers",\n        "ipc-handler:system-handlers"',
  '"ipc-handler:storage-handlers",\n        "ipc-handler:system-handlers",\n        "ipc-handler:preferences-handlers"'
);
fs.writeFileSync(file, source);
