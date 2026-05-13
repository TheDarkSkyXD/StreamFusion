# Settings page playbook

## Goal
Confirm Settings mounts the AccountConnect block, exposes a version string, and the playback-quality dropdown can be toggled.

## Steps

1. **Navigate**
   ```js
   window.location.hash = "/settings";
   ```

2. **Verify version is present somewhere**
   ```js
   /version/i.test(document.body.innerText)
   ```

3. **Verify accounts area**
   ```js
   /twitch|kick/i.test(document.body.innerText)
   ```

4. **Toggle ad-block switch** (if visible)
   ```js
   const sw = document.querySelector('button[role="switch"]');
   if (sw) sw.click();
   ({ clicked: !!sw, stateAfter: sw?.getAttribute("data-state") })
   ```

5. **Screenshot** → `settings.png`.

## Pass criteria
- [ ] Version string visible.
- [ ] AccountConnect/Twitch/Kick controls visible.
- [ ] Ad-block switch (if present) toggles `data-state` between checked/unchecked.
