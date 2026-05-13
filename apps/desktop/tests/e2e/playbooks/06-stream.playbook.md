# Stream (live) page playbook

## Goal
Confirm navigating to a live stream URL mounts the player container, chat panel, and stream info — or the offline state if the channel isn't live.

## Steps

1. **Navigate**
   ```js
   window.location.hash = "/stream/twitch/ninja";
   ```

2. **Wait for the page chrome**
   ```js
   !!document.querySelector('aside, [class*="chat"], video, [class*="player"]')
   ```

3. **Check player presence**
   - The player may or may not be playing depending on whether the channel is live and ad-block state. We only require the DOM hosts a player container OR an offline message.
   ```js
   const hasVideo = !!document.querySelector("video");
   const isOffline = /offline|not live/i.test(document.body.innerText);
   ({ hasVideo, isOffline })
   ```

4. **Verify chat panel container is present**
   ```js
   /chat/i.test(document.body.innerText) || !!document.querySelector('[class*="chat"]')
   ```

5. **Screenshot** → `stream.png`.

## Pass criteria
- [ ] Page mounted at `#/stream/twitch/ninja`.
- [ ] EITHER a `<video>` element OR an offline indicator is present.
- [ ] Chat-related DOM is present.
