# Bundled ffmpeg for media downloads

StreamFusion downloads playable Clips and Videos for Twitch and Kick from media URLs that are often direct MP4 for Clips and HLS playlists for Videos. We will bundle ffmpeg for Video download assembly/remux while using direct HTTP downloads for Clips when a direct MP4 URL is available, because requiring users to install external tools would make the feature fragile and native HLS assembly would duplicate mature media-tooling behavior. This increases installer/package size and requires cross-platform binary packaging, but it gives users a working download path without manual setup.

**Considered Options**

- Require user-installed ffmpeg or yt-dlp: smaller app, but creates setup failures and hard-to-debug path/version issues.
- Implement native HLS segment downloading first: more control, but still needs a remux path and duplicates complex retry/assembly behavior.
- Use yt-dlp as the primary engine: broad support, but adds a larger external updater/dependency surface than the current need requires.
