# Kick API Documentation - Master Endpoint List

This document is a comprehensive reference for **all known Kick API endpoints**, including the official Public API, the undocumented Internal/Legacy APIs used by the website, and Mobile App credentials.

> **⚠️ WARNING**: Internal/Private APIs (`api/v1`, `api/v2`, `api/internal`) are undocumented and subject to change at any time. Use them at your own risk.

## 📚 Base URLs

| API Type | Base URL | Auth Requirement |
| :--- | :--- | :--- |
| **Public API** | `https://api.kick.com/public/v1` | `Authorization: Bearer <token>` |
| **Internal V2** | `https://kick.com/api/v2` | Cookie / Cloudflare Bypass |
| **Internal V1** | `https://kick.com/api/v1` | Cookie / Cloudflare Bypass |
| **Mobile API** | `https://kick.com/api/mobile` | Mobile Token |
| **Private/Internal** | `https://kick.com/api/internal` | Session Cookie |

---

## 1️⃣ Public API (Official)
**Docs**: [docs.kick.com](https://docs.kick.com/)

### Users & Channels
- `GET /users` - Get authenticated user
- `GET /users/{id}` - Get user by ID
- `GET /channels/{channel}` - Get channel info
- `PATCH /channels` - Update channel settings

### Livestreams
- `GET /livestreams` - Get livestreams (filter by channel, etc.)
- `GET /livestreams/stats` - Get livestream statistics

### Chat
- `POST /chat` - Send a chat message (Scope: `chat:write`)

### Categories
- `GET /categories` - List categories
- `GET /categories/{id}` - Get category details

---

## 2️⃣ Internal API v2 (Frontend Core)
These endpoints power most of the `kick.com` website functionality.

### 👤 User & Profile
- `GET /api/v2/user` - Get current user (with sophisticated metadata)
- `GET /api/v2/user/payment-profile` - Get payment settings
- `POST /api/v2/user/payment-methods` - Add payment method
- `GET /api/v2/user/subscriptions` - Get user's active subscriptions
- `GET /api/v2/user/verified-status` - Check verification status
- `POST /api/v2/users/{userId}/messages` - Send private message (?)

### 📺 Channels
- `GET /api/v2/channels/{slug}` - **Full Channel Data** (Livestream, Bio, Subs, etc.)
- `POST /api/v2/channels/{channel}/follow` - Follow channel
- `DELETE /api/v2/channels/{channel}/follow` - Unfollow channel
- `GET /api/v2/channels/{channel}/chatroom` - Get chatroom info (ID, rules)
- `GET /api/v2/channels/{channel}/leaderboards` - Get Gift Leaderboards
- `GET /api/v2/channels/{channel}/videos/latest` - Get latest VODs
- `GET /api/v2/channels/{channel}/polls` - Get active polls
- `GET /api/v2/channels/{slug}/clips` - Get channel clips
- `GET /api/v2/channels/{channel}/subscribers/last` - Get recent subscribers

### 💬 Chat
- `POST /api/v2/messages/send/{chatroomId}` - **Send Chat Message** (Web internal)
- `DELETE /api/v2/chatrooms/{chatroomId}/messages/{messageId}` - Delete message (Mod)
- `POST /api/v2/channels/{channel}/chat-commands` - Create/Update chat commands
- `GET /api/v2/channels/{channel}/chatroom/rules` - Get chat rules
- `PUT /api/v2/channels/{channel}/chatroom/rules` - Update chat rules
- `GET /api/v2/channels/{channel}/chatroom/banned-words` - Get blocked terms

### 🎬 Clips
- `GET /api/v2/clips` - Browse clips
- `GET /api/v2/clips/{clipId}` - Get specific clip
- `GET /api/v2/clips/{clipId}/info` - Get clip metadata
- `PUT /api/v2/clips/{clipId}/like` - Like a clip
- `DELETE /api/v2/clips/{clipId}/like` - Unlike a clip
- `PUT /api/v2/clips/{clipId}/private` - Toggle clip privacy
- `DELETE /api/v2/clips/{clipId}` - Delete clip

### 🛡️ Moderation
- `GET /api/v2/channels/{channel}/bans` - List banned users
- `POST /api/v2/channels/{channel}/bans` - Ban user
- `DELETE /api/v2/channels/{channel}/bans/{username}` - Unban user

---

## 3️⃣ Internal API v1 (Legacy / Specialized)
Older endpoints, some still used for specific functions.

### 🎥 Stream & Search
- `GET /api/v1/livestreams` - Get active livestreams
- `GET /api/search` - **Global Search** (Channels, Categories)
    - Query param: `?term={keyword}`
- `GET /api/v1/video/{videoId}` - Get VOD details
- `GET /api/v1/categories/top` - Get top categories

### ⚙️ Channel Settings
- `GET /api/v1/channels/{channel}/stats` - Channel statistics
- `POST /api/v1/channels/{channel}/mute-user` - Timeout/Mute user
- `GET /api/v1/channels/{channel}/banned-users` - Get banned users (Legacy)

### 💰 Subscriptions & Payments
- `GET /api/v1/subscriptions` - Get subscription plans
- `POST /api/v1/channels/{channel}/subscribe` - Subscribe to channel
- `POST /api/v1/channels/{channel}/gift-subscriptions` - Gift subs

---

## 4️⃣ Mobile API
Endpoints used specifically by the Kick iOS/Android apps.

- `POST /api/mobile/token` - Get mobile access token
- `POST /api/mobile/channels/{channel}/subscriptions` - Sub via mobile
- `POST /api/mobile/channels/{channel}/gift` - Gift sub via mobile

---

## 5️⃣ Private / Internal (Admin & Dashboard)
Endpoints used by the creator dashboard (`kick.com/dashboard`).

- `GET /api/internal/v1/channels/{channel}/chatroom` - Dashboard chat settings
- `GET /api/internal/v1/user/moderators` - Get my moderators
- `POST /api/internal/v1/channels/{channel}/community/moderators` - Add Moderator
- `DELETE /api/internal/v1/channels/{channel}/community/moderators/{username}` - Remove Mod
- `POST /api/internal/v1/channels/{channel}/community/vips` - Add VIP
- `GET /api/internal/v1/livestreams/{livestream}/events` - Stream events log
- `POST /api/internal/v1/channels/{channel}/chatroom/poll` - Create Poll
- `POST /api/internal/v1/channels/{channel}/chatroom/poll/vote` - Vote in Poll

---

## 6️⃣ CDN & Media Guidelines (Hotlinking Protection)

### 🛑 Hotlinking Protection Enforced
Kick enforces strict hotlinking protection on its media CDNs. Browsers/Electron apps requesting images directly will receive **403 Forbidden**.

| Domain | Content | Protection | Bypass Header |
| :--- | :--- | :--- | :--- |
| `files.kick.com` | Profile Pics, Banners, Emotes | **Strict** | `Referer: https://kick.com/` |
| `images.kick.com` | Video Thumbnails, VOD Previews | **Strict** | `Referer: https://kick.com/` |
| `m3u8.kick.com` | HLS Manifests | CORS | Normal CORS handling |

### ✅ How to Access Media
In StreamFusion, use the **Image Proxy**:

```typescript
// Renderer
const url = await ipcRenderer.invoke('image:proxy', { url: 'https://images.kick.com/...' });
// Returns: data:image/webp;base64,....
```

The Main Process performs the fetch with:
```http
GET /resource HTTP/1.1
Host: images.kick.com
Referer: https://kick.com/
User-Agent: Mozilla/5.0 ...
```
