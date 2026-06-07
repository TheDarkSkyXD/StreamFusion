/**
 * Kick Player Components
 *
 * Kick-specific video players:
 * - KickLivePlayer: For live streams (no progress bar)
 * - KickVodPlayer: For VODs (with green progress bar)
 */

// Live Stream Player (no progress bar)
export { KickLivePlayer } from "./kick-live-player";
// Progress Bar (for VODs)
// Legacy exports (for backward compatibility)
// VOD Player (with green progress bar)
export { KickVodPlayer } from "./kick-vod-player";
