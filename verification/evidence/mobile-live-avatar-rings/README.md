# Mobile live avatar rings

Verified October 8, 2026 on Medium_Phone_API_36.1, emulator-5558, Android API 36.1. StreamFusion Development 0.1.4-alpha.1 loaded current source through Metro. Existing application data was preserved.

## Observed native behavior

- `home-live-rings.png`: live Twitch featured avatar has the desktop purple ring; live Kick catalog avatar has the desktop green ring. Outer avatar sizes remain 48dp and 40dp.
- `watch-kick-live-rings.png`: the live Kick channel has green rings on the 36dp Watch identity and 64dp Info avatar. Images remain circular and separated from the color band by a dark gap.
- `offline-neutral-avatar.png`: the inspected Twitch channel is offline, Watch is disabled, and its 64dp avatar retains a neutral border.

The shared avatar is used by media cards, Following channel rows, featured streams, Search channel results, channel headers, Watch identity, and Watch Info. Live color comes from existing current channel/stream status. Historical-only and unknown identities remain neutral. A recorded-Watch regression test confirms that a currently live channel still gets its ring while a recording is playing.

Screenshots are direct Android captures reviewed visually. The product-native device connector reported device access disabled, so verification used the repository ADB driver. Raw UI dumps and chat captures were excluded from this evidence set.

## Checks

- Mobile Node tests: 73 passed.
- Mobile Vitest: 180 files, 1,037 tests passed.
- Mobile feature architecture proof, TypeScript, ESLint, Prettier, and diff whitespace checks passed.
- React Doctor: 91/100, zero errors; two existing complexity warnings in WatchScreen and WatchTabs.
- Scoped comment review removed four narration blocks without changing application behavior. Source review found no casts, extra state, provider changes, or duplicated ring implementations.

## Decisions

Model the Domain: one optional livePlatform value represents confirmed live identity and platform together. Laziness Protocol: MobileAvatar owns the ring and image clipping. Prove It Works: native live and offline captures support the component tests. Architecture comparison selected the existing shared avatar over an extra wrapper that would repeat its size contract.
