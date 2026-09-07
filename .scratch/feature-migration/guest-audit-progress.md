# Guest public browsing evidence

Compiled isolated run `compiled-audit-20260906` has no copied account tokens or cookies. Doctor is healthy with no uncaught errors or account-storage errors.

- Twitch BobRoss channel Videos returned real VOD cards. Opening Presidents Day Weekend Marathon navigated to video 2382884661, loaded an image and replay messages, and played beyond 40 seconds after Play. Ready state 4, no media error. Evidence: guest-vod-loaded.png, guest-vod-final-assert.log.
- Following Twitch Clips returned 1652 clips from the isolated local follow list. The retained screenshot has Twitch/Clips selected. All visible image elements subsequently completed with nonzero natural width. This covers local follows, not authenticated provider-follow synchronization.
- Previous compiled checks proved a public clip moving through 15 seconds, Kick live video, and real Twitch live messages in MultiView. Visibility-sensitive reads resume when the Electron window is foregrounded.
- Independent public-read gate audit covered routes, discovery, watch, local Following, MultiView and downloads, with 250 tests passing. No additional avoidable sign-in gate was found outside category media.
- Guest composer review confirms contentEditable=false, removed input handlers and blocked send paths. The controller's disabled:false role summary does not measure contentEditable. 376 focused chat, authentication, Kick-batch and caller tests passed.

Category Videos/Clips were reproduced failing because the reader required a Twitch user token. The owner is replacing the public read strategy and separating failed reads from true empty results. Final rebuilt Electron proof remains pending.
