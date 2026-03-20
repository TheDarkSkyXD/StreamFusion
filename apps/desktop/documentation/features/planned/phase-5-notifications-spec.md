# Phase 5: Notifications & Alerts

**Document Name:** Notifications Implementation Plan  
**Date:** December 7, 2025  
**Version:** 1.0  
**Status:** Planning  
**Priority:** Medium  
**Prerequisites:** Phase 4 Complete

---

## Executive Summary

This phase implements the notification system for StreamFusion, allowing users to receive desktop notifications when followed channels go live, as well as in-app alerts for various events.

---

## Functional Requirements Covered

| Requirement | Description |
|-------------|-------------|
| FR-5.1 | Stream Notifications |
| FR-5.2 | In-App Alerts |

---

## Implementation Phases

### Phase 5.1: Live Status Monitoring (2 days)

- [ ] Create LiveStatusService in main process
- [ ] Poll followed channels every 60 seconds
- [ ] Detect when channels go live (compare with previous status)
- [ ] Batch API requests (100 IDs per request)
- [ ] Handle rate limiting with exponential backoff

### Phase 5.2: Desktop Notifications (2 days)

- [ ] Use Electron's native Notification API
- [ ] Show channel avatar, title, and game
- [ ] Click to open stream
- [ ] Handle macOS permission requests
- [ ] Optional notification sound

### Phase 5.3: Notification Settings (2 days)

- [ ] Global enable/disable
- [ ] Per-channel notification settings
- [ ] Do Not Disturb mode (scheduled quiet hours)
- [ ] Custom notification sounds
- [ ] Quick mute (1h, 2h, until tomorrow)

### Phase 5.4: In-App Toast Notifications (2 days)

- [ ] Install `sonner` for toast notifications
- [ ] StreamLiveToast component
- [ ] System notification toasts
- [ ] Toast queue management
- [ ] Auto-dismiss timing

### Phase 5.5: Notification Center (2 days)

- [ ] Notification history store
- [ ] NotificationCenter popover component
- [ ] Unread count badge
- [ ] Mark as read / Mark all as read
- [ ] Filter by type/platform

### Phase 5.6: Sound Alerts (1 day)

- [ ] SoundManager service
- [ ] Default notification sounds
- [ ] Custom sound upload
- [ ] Volume controls

---

## Success Criteria

1. ✅ Desktop notifications appear when channels go live
2. ✅ Clicking notification opens the stream
3. ✅ In-app toasts display correctly
4. ✅ Notification center tracks history
5. ✅ Per-channel settings work
6. ✅ Do Not Disturb mode functions

---

## Next Phase

→ **[Phase 6: Settings & Preferences](./phase-6-settings-spec.md)**

