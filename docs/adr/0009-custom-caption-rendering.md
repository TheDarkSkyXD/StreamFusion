# StreamFusion owns timed text rendering

StreamFusion will render subtitle and closed-caption cues in its own player overlay rather than delegating in-app presentation to Chromium's native text-track renderer. This provides consistent cross-Platform styling and enables StreamFusion-owned caption preferences, at the cost of owning cue positioning, overlap, accessibility, and fullscreen behavior. Native Picture-in-Picture is the deliberate exception: while PiP is active, StreamFusion temporarily delegates the selected track to Chromium because DOM overlays cannot enter the operating system's PiP video window.

**Considered Options**

- Use Chromium's native text-track renderer: standards-based and lower maintenance, but offers limited control over appearance and cross-surface consistency.
