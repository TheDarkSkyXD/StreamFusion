/**
 * Re-export from the new modular location for backward compatibility
 *
 * The RelatedContent component has been split into smaller, more maintainable files:
 * - related-content/index.tsx - Main component
 * - related-content/types.ts - TypeScript interfaces
 * - related-content/utils.ts - Utility functions
 * - related-content/ClipPlayer.tsx - Custom video player for clips
 * - related-content/VideoCard.tsx - Video thumbnail card component
 * - related-content/ClipCard.tsx - Clip thumbnail card component
 * - related-content/ContentTabs.tsx - Tab navigation component
 * - related-content/ClipDialog.tsx - Modal dialog for viewing clips
 */

export { RelatedContent } from "./related-content/index";
export type { RelatedContentProps, VideoOrClip } from "./related-content/types";
