# Video (VOD) page playbook

## Goal
Confirm a VOD route mounts with metadata passed via search params and a VOD player container.

## Steps

1. **Navigate with metadata in the URL**
   ```js
   const p = new URLSearchParams({
     title: "Playbook VOD Title",
     channelName: "ninja",
     channelDisplayName: "Ninja",
     duration: "1:23:45",
   });
   window.location.hash = `/video/twitch/vod-playbook?${p.toString()}`;
   ```

2. **Verify title is rendered**
   ```js
   document.body.innerText.includes("Playbook VOD Title")
   ```

3. **Verify VOD player container is present**
   ```js
   !!document.querySelector('video, [class*="vod-player"], [class*="player"]')
   ```

4. **Screenshot** → `video.png`.

## Pass criteria
- [ ] Passed `title` from URL is visible in the DOM.
- [ ] A video / VOD-player container is rendered.
