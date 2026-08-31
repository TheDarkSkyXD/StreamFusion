# Chat emote rendering in KickTalk and Chatterino

Research date: 2026-08-30

This note compares StreamFusion's Kick and Twitch chat renderer with these pinned upstream revisions:

- [KickTalk `a3570be`](https://github.com/KickTalkOrg/KickTalk/tree/a3570be165618f70449257bbb70df7cd16b66efe)
- [Chatterino `a52fbc7`](https://github.com/Chatterino/chatterino2/tree/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9)

The sources are pinned because both projects change independently of StreamFusion.

## Finding

StreamFusion loses emote geometry before rendering, then forces every chat emote into a square. The CDN image is not the root cause.

[`Emote`](../../apps/desktop/src/backend/services/emotes/emote-types.ts) has URLs and behavior flags but no logical width or height. The [7TV adapter](../../apps/desktop/src/backend/services/emotes/7tv-emotes.ts) constructs density URLs without retaining the dimensions in `data.host.files`. The [third-party enrichment step](../../apps/desktop/src/backend/services/chat/third-party-emote-enrich.ts) flattens that record to one `url2x` URL. Finally, [`ChatEmote`](../../apps/desktop/src/frontend/features/chat/components/chat/ChatEmote.tsx) sets both the button and image to `emoteSizePx`. That square box stretches or compresses wide and tall images.

"Original size" must mean the provider's logical 1x dimensions, not the raw pixels in a 2x or 4x file. A 112 by 28 1x emote should occupy four times the width of a 28 by 28 emote. A 448 by 112 4x file for the same emote must occupy the same layout space and only improve image sharpness.

## What KickTalk does

KickTalk keeps a 7TV emote's width and height from the first image descriptor when it maps GraphQL results. It passes those values to the message parser instead of reducing an emote to an ID and URL. See [`stvAPI.js` lines 218-236](https://github.com/KickTalkOrg/KickTalk/blob/a3570be165618f70449257bbb70df7cd16b66efe/utils/services/seventv/stvAPI.js#L218-L236) and [`MessageParser.jsx` lines 120-157](https://github.com/KickTalkOrg/KickTalk/blob/a3570be165618f70449257bbb70df7cd16b66efe/src/renderer/src/utils/MessageParser.jsx#L120-L157).

Its render wrapper uses those dimensions for 7TV emotes. The image uses a 1x source plus a 1x through 4x density `srcSet`, so Chromium can fetch an appropriate resolution without changing layout size. Kick-native emotes use a 32 by 32 fallback. See [`Emote.jsx` lines 7-30 and 46-78](https://github.com/KickTalkOrg/KickTalk/blob/a3570be165618f70449257bbb70df7cd16b66efe/src/renderer/src/components/Cosmetics/Emote.jsx#L7-L78).

KickTalk groups a zero-width 7TV emote with the preceding emote and renders both in one grid cell. Whitespace does not break the group, but non-whitespace text does. Multiple overlays attach to the same base. See [`MessageParser.jsx` lines 231-315](https://github.com/KickTalkOrg/KickTalk/blob/a3570be165618f70449257bbb70df7cd16b66efe/src/renderer/src/utils/MessageParser.jsx#L231-L315), [`Emote.jsx` lines 71-91](https://github.com/KickTalkOrg/KickTalk/blob/a3570be165618f70449257bbb70df7cd16b66efe/src/renderer/src/components/Cosmetics/Emote.jsx#L71-L91), and [`Message.scss` lines 419-460](https://github.com/KickTalkOrg/KickTalk/blob/a3570be165618f70449257bbb70df7cd16b66efe/src/renderer/src/assets/styles/components/Chat/Message.scss#L419-L460).

KickTalk also uses `React.memo`, `loading="lazy"`, `decoding="async"`, and low fetch priority for chat images. Those choices are useful, but its zero-width test is not a safe model for StreamFusion: it treats every nonzero base-emote flag as zero-width in [`MessageParser.jsx` lines 139-151](https://github.com/KickTalkOrg/KickTalk/blob/a3570be165618f70449257bbb70df7cd16b66efe/src/renderer/src/utils/MessageParser.jsx#L139-L151). Different 7TV flag fields have different meanings.

## What Chatterino does

Chatterino separates logical geometry from image quality. Its 7TV adapter reads every WebP descriptor, derives each density's scale from the first file's width, and supplies expected width and height before the image loads. It prefers 4x and falls back to 3x. See [`SeventvEmotes.cpp` lines 461-546](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/providers/seventv/SeventvEmotes.cpp#L461-L546). `ImageSet` chooses a density for the current UI scale and can temporarily use an already-loaded density while the preferred one loads. See [`ImageSet.cpp` lines 68-125](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/messages/ImageSet.cpp#L68-L125).

The message layout multiplies both intrinsic dimensions by one scale value, preserving aspect ratio. The line box grows to the tallest element, while normal wrapping uses the rendered width. See [`MessageElement.cpp` lines 256-280](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/messages/MessageElement.cpp#L256-L280) and [`MessageLayoutContainer.cpp` lines 673-749](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/messages/layouts/MessageLayoutContainer.cpp#L673-L749). Wide emotes therefore stay wide. Large emotes make the message row taller instead of being squeezed into the text line.

Chatterino represents overlays as a layered message element rather than positioning an unrelated element with a negative margin. The parser replaces the preceding emote with a layered element and appends later overlays to it. See [`MessageBuilder.cpp` lines 2636-2681](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/messages/MessageBuilder.cpp#L2636-L2681). The layout uses the largest layer as the group's box and bottom-centers each layer within it. This also works when a narrow overlay follows a wide base. See [`MessageElement.cpp` lines 342-419](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/messages/MessageElement.cpp#L342-L419) and [`MessageLayoutElement.cpp` lines 251-319](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/messages/layouts/MessageLayoutElement.cpp#L251-L319).

7TV has two relevant flag domains. The active emote-set entry uses bit `1 << 0` to say that this alias is zero-width. The base emote uses bit `1 << 8` only as a recommendation. Chatterino defines both and renders from the active flag. See [`SeventvEmotes.hpp` lines 33-56](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/providers/seventv/SeventvEmotes.hpp#L33-L56) and [`SeventvEmotes.cpp` lines 63-108](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/providers/seventv/SeventvEmotes.cpp#L63-L108). StreamFusion currently checks only `data.flags & (1 << 8)`, so it can disagree with the channel's active set.

BTTV does not provide dimensions in its emote-list response. Chatterino reserves 28 by 28 until the file loads, then uses the decoded image's real dimensions. It also recognizes a small named set of BTTV global overlays, while StreamFusion marks every BTTV emote as non-overlay. See [`BttvEmotes.cpp` lines 37-51 and 82-96](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/providers/bttv/BttvEmotes.cpp#L37-L96).

Chatterino lazily loads on paint, caches images by URL, uses expected dimensions to prevent pre-load layout collapse, and expires decoded frames. It rejects a single image whose decoded `width * height * frameCount * 4` exceeds 20 MiB. See [`Image.hpp` lines 76-105](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/messages/Image.hpp#L76-L105) and [`Image.cpp` lines 315-329 and 448-705](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/messages/Image.cpp#L315-L705). Its view repaints only the visible region that contains animated elements. See [`ChannelView.cpp` lines 1649-1688](https://github.com/Chatterino/chatterino2/blob/a52fbc7e2b1eaf94ae161bcd0fbf2956b78e4aa9/src/widgets/helper/ChannelView.cpp#L1649-L1688).

## Recommended StreamFusion model

Add geometry and source variants before changing CSS. A useful provider-neutral shape is:

```ts
interface EmoteGeometry {
  width: number;
  height: number;
}

interface EmoteImageVariant extends EmoteGeometry {
  density: 1 | 2 | 3 | 4;
  url: string;
  staticUrl?: string;
}
```

`Emote` should carry `geometry` in logical 1x pixels plus validated image variants. `ContentFragment` must retain that geometry, the provider, and enough source data to render `srcSet` and a real static image. Do not infer the provider from a URL in `ChatEmote`.

For a standard 28-pixel preference, calculate `scale = emoteSizePx / 28`, then render `width * scale` by `height * scale`. This keeps the existing setting meaningful while preserving wide and large emotes. Let the message row grow to the rendered height. If an emote is wider than the chat viewport, shrink that one image to the available width while preserving its aspect ratio. That is a container constraint, not an emote-count cap.

Normalize 7TV data from `data.host.files` at the provider boundary. Choose logical geometry from the lowest-density valid WebP descriptor. Keep all available 1x through 4x variants and their `static_name` values. Validate positive finite dimensions and reject malformed descriptors with a text fallback.

BTTV needs a different path because its list response has no geometry. Render the 1x source at intrinsic dimensions, record `naturalWidth` and `naturalHeight` in a bounded URL-keyed geometry cache, and reuse that ratio after virtualization remounts. Do not issue a separate request for every emote. Add Chatterino's known global zero-width names unless BTTV exposes a stronger signal in the response StreamFusion already receives.

## Recommended overlay model

Replace negative-margin overlay positioning with an explicit emote stack. A pure composition pass should turn a base emote followed by one or more zero-width emotes into one fragment:

```ts
type EmoteStackFragment = {
  type: "emote-stack";
  base: EmoteFragment;
  overlays: EmoteFragment[];
};
```

Whitespace may separate the base and overlay without breaking the stack. Non-whitespace text breaks it. A zero-width emote without a preceding emote renders inline. The stack box uses the largest width and height, and every layer is bottom-centered. Keep all names in copy text and tooltip details.

For 7TV, evaluate `activeEmote.flags & (1 << 0)` first. Treat `data.flags & (1 << 8)` only as a fallback recommendation when the active field is absent. Tests need both fields with conflicting values because that is the bug the current model cannot express.

## Performance and verification

The sizing fix can reduce work. Known dimensions stop cumulative layout shifts and avoid repeated Virtuoso height corrections. `srcSet` avoids fetching 4x data for every display. Keep chat virtualization, async decoding, visible-image lazy loading, and failed-image text fallback.

Use a bounded, URL-keyed cache for decoded geometry and image failure state. Deduplicate concurrent loads. This is resource management, not a user-visible cap on emotes or messages. Keep animation work limited to mounted chat rows, and prefer provider static variants when the viewer disables animation.

Verify the implementation with fixtures that cover:

- 28 by 28, 112 by 28, 28 by 56, and 112 by 56 logical images at 1x, 2x, and 4x density;
- a wide base with narrow and wide overlays, including an animated layer;
- active 7TV zero-width on and off while the base recommendation says the opposite;
- BTTV `SoSnowy` or `cvMask` after a normal emote;
- malformed dimensions, a failed density URL, and a static fallback;
- Kick and Twitch live chat under sustained emote traffic, checking row height, wrapping, scroll anchoring, decoded memory, and frame time.

The runtime proof should include at least one real wide or large 7TV emote in Kick chat and one real BTTV or 7TV emote in Twitch chat. Confirm the rendered aspect ratio from `naturalWidth / naturalHeight`, confirm the row grows for large emotes, and confirm that an overlay consumes no extra horizontal space.
