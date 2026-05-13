# Clip page playbook

## Goal
Confirm a clip route mounts with the mock clip data, Follow/Share buttons, and that toggling Follow flips state.

## Steps

1. **Navigate**
   ```js
   window.location.hash = "/clip/twitch/clip-0";
   ```

2. **Verify clip title text is rendered**
   ```js
   /Playing Clip:/i.test(document.body.innerText)
   ```

3. **Click "Follow"**
   ```js
   const btn = Array.from(document.querySelectorAll("button"))
     .find(b => /^\s*Follow\s*$/i.test(b.textContent));
   btn?.click();
   ```

4. **Verify the button text is no longer exactly "Follow"** (it now shows an icon-only state):
   ```js
   !Array.from(document.querySelectorAll("button"))
     .some(b => /^\s*Follow\s*$/i.test(b.textContent))
   ```

5. **Screenshot** → `clip.png`.

## Pass criteria
- [ ] Clip page mounted with title text.
- [ ] Share button visible.
- [ ] Follow toggles into an icon-only state on click.
